import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transform2D } from './transform2d.js';
import { Mat2D } from './mat2d.js';
import { computeLayerToScreenMatrix } from './map.js';
import type { MapWidget } from './map.js';
import {
  VECTOR_LAYER_FILL_COLOR,
  VECTOR_LAYER_LABEL_COLOR,
  VECTOR_LAYER_LINE_COLOR,
  VECTOR_LAYER_POINT_COLOR
} from './defines.js';
import {
  VectorLayer,
  transformCoordinate,
  transformRing,
  getPolygonRingsScreenPoints,
  distanceToSegment,
  pointInRings,
  computeLabelAnchor
} from './vector_layer.js';
import type {
  Feature,
  FeatureStyle,
  LineStringGeometry,
  MultiPolygonGeometry,
  PointGeometry,
  PolygonGeometry
} from './vector_layer.js';

/// Test helpers ///////////////////////////////////////////////////////////////////////////////////

// A minimal CanvasRenderingContext2D stand-in: records every call it receives instead of drawing
// anything, so VectorLayer.draw's behavior can be asserted DOM-free (no jsdom/real canvas). This
// project has no existing canvas-mocking test to follow the shape of (no layers.test.ts exists —
// see map.test.ts/mat2d.test.ts/transform2d.test.ts, all of which stay entirely DOM-free by
// testing pure functions instead), so this is a fresh, minimal mock built for this file. Notably,
// it deliberately has NO `setTransform` — see the "never uses ctx.setTransform" test below, which
// relies on that: if VectorLayer.draw ever called it, this mock would throw "not a function"
// rather than silently accept it.
//
// VEC-2 addition: `lineWidth`/`dash` are recorded the same way `fillStyle`/`strokeStyle` already
// were — snapshotted onto the fill()/stroke() RecordedCall at the moment it happens, not as their
// own separate entries in `calls`. That's deliberate: `ctx.lineWidth = ...` is a plain property
// set (same as fillStyle/strokeStyle always were) and `ctx.setLineDash(...)` updates internal mock
// state rather than pushing its own `calls` entry — so every VEC-1 test asserting the exact
// sequence of recorded method names (e.g. the LineString "emits moveTo followed by..." test below)
// keeps passing completely unchanged, while new VEC-2 tests can still read the lineWidth/dash that
// were actually in effect at each fill()/stroke() by reading them off that call's record.
interface RecordedCall {
  method: string;
  args: unknown[];
  fillStyle?: string;
  strokeStyle?: string;
  lineWidth?: number;
  dash?: number[];
  font?: string;
  textAlign?: CanvasTextAlign;
  textBaseline?: CanvasTextBaseline;
}

function createMockCtx(): { ctx: CanvasRenderingContext2D; calls: RecordedCall[]; getDash: () => number[] } {
  const calls: RecordedCall[] = [];
  let currentDash: number[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    beginPath: () => { calls.push({ method: 'beginPath', args: [] }); },
    moveTo: (x: number, y: number) => { calls.push({ method: 'moveTo', args: [x, y] }); },
    lineTo: (x: number, y: number) => { calls.push({ method: 'lineTo', args: [x, y] }); },
    closePath: () => { calls.push({ method: 'closePath', args: [] }); },
    arc: (x: number, y: number, r: number, start: number, end: number) => {
      calls.push({ method: 'arc', args: [x, y, r, start, end] });
    },
    // Deliberately does NOT push its own `calls` entry (see interface comment above) — it just
    // updates the mock's internal "current dash" state, exactly like a real
    // CanvasRenderingContext2D would update its internal line-dash-list state. The bleed-regression
    // test below relies on this being real, sticky state that persists across draw() calls within
    // the same mock ctx, same as the real canvas API.
    setLineDash: (segments: number[]) => { currentDash = segments.slice(); },
    drawImage: (image: CanvasImageSource, dx: number, dy: number, dWidth?: number, dHeight?: number) => {
      calls.push({ method: 'drawImage', args: [image, dx, dy, dWidth, dHeight] });
    },
    fill: (rule?: CanvasFillRule) => {
      calls.push({ method: 'fill', args: [rule], fillStyle: ctx.fillStyle, lineWidth: ctx.lineWidth, dash: currentDash.slice() });
    },
    stroke: () => {
      calls.push({ method: 'stroke', args: [], strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth, dash: currentDash.slice() });
    },
    // VEC-6: same snapshot-onto-the-call convention fill()/stroke() already use above — font/
    // fillStyle/textAlign/textBaseline are plain property sets (like fillStyle always was), so the
    // call record captures whatever they were set to at the moment fillText actually ran.
    fillText: (text: string, x: number, y: number) => {
      calls.push({
        method: 'fillText',
        args: [text, x, y],
        fillStyle: ctx.fillStyle,
        font: ctx.font,
        textAlign: ctx.textAlign,
        textBaseline: ctx.textBaseline
      });
    }
  };
  // Reads the mock's live internal dash state directly (not off a recorded call) — used by the
  // cross-layer-leak test below, which checks ctx state *after* draw() returns, when there is no
  // further fill()/stroke() call to snapshot it onto.
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, getDash: () => currentDash.slice() };
}

/** A DOM-free CanvasImageSource stand-in for icon tests: in vitest's default (node) environment,
 * `HTMLImageElement`/`HTMLCanvasElement`/etc. don't exist at all, so `getNaturalIconSize`'s
 * instanceof checks all fall through to its final generic `{width, height}` fallback branch —
 * this object is shaped exactly to hit that branch, deliberately, the same way this whole file
 * avoids jsdom/a real canvas everywhere else. */
function fakeIcon(width: number, height: number): CanvasImageSource {
  return { width, height } as unknown as CanvasImageSource;
}

function fakeMap(ctx: CanvasRenderingContext2D, camera: Transform2D, width: number, height: number): MapWidget {
  return { canvas: { width, height }, camera, ctx } as unknown as MapWidget;
}

function cameraFor(position: XY, zf: number, rotation = 0): Transform2D {
  const camera = new Transform2D();
  camera.setTranslation(position.x, position.y);
  camera.setScale(1 / zf);
  camera.rotation = rotation;
  return camera;
}

/** A DOM-free `map.canvas` stand-in for VectorLayer.enableFeatureEvents tests: a plain
 * `Map<string, Set<Function>>` registry instead of a real `EventTarget`/`HTMLCanvasElement` (this
 * project has no jsdom dependency — see createMockCtx's own comment on why every mock in this file
 * is hand-built rather than reaching for a real DOM). `dispatch` calls every listener registered
 * for a given event type synchronously, with whatever plain object stands in for the event (e.g.
 * `{ offsetX, offsetY }` — a real MouseEvent's other fields are never read by enableFeatureEvents). */
function fakeCanvas(width: number, height: number) {
  const listeners = new Map<string, Set<(e: any) => void>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    width,
    height,
    addEventListener(type: string, cb: (e: any) => void): void { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: (e: any) => void): void { // eslint-disable-line @typescript-eslint/no-explicit-any
      listeners.get(type)?.delete(cb);
    },
    dispatch(type: string, event: unknown): void {
      listeners.get(type)?.forEach((cb) => cb(event));
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0;
    }
  };
}

function fakeMapWithCanvas(ctx: CanvasRenderingContext2D, camera: Transform2D, canvas: ReturnType<typeof fakeCanvas>): MapWidget {
  return { canvas, camera, ctx } as unknown as MapWidget;
}

/// Pure coordinate-math functions ////////////////////////////////////////////////////////////////

describe('transformCoordinate / transformRing (DOM-free)', () => {
  it('transformCoordinate applies the matrix to a single [x, y] pair', () => {
    const matrix = Mat2D.translation(10, 20);
    expect(transformCoordinate([5, 7], matrix)).toEqual({ x: 15, y: 27 });
  });

  it('transformRing maps every coordinate in order, preserving length', () => {
    const matrix = Mat2D.scaling(2, 3);
    const ring: [number, number][] = [[1, 1], [2, 2], [3, 3]];
    expect(transformRing(ring, matrix)).toEqual([
      { x: 2, y: 3 },
      { x: 4, y: 6 },
      { x: 6, y: 9 }
    ]);
  });

  it('transformRing on an empty ring returns an empty array', () => {
    expect(transformRing([], Mat2D.identity())).toEqual([]);
  });
});

describe('getPolygonRingsScreenPoints (DOM-free)', () => {
  it('a Polygon with one outer ring and one hole yields two transformed rings, in order', () => {
    const matrix = Mat2D.translation(100, 0);
    const geometry: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10]], // outer
        [[2, 2], [4, 2], [4, 4], [2, 4]] // hole
      ]
    };
    const rings = getPolygonRingsScreenPoints(geometry, matrix);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toEqual([{ x: 100, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 10 }, { x: 100, y: 10 }]);
    expect(rings[1]).toEqual([{ x: 102, y: 2 }, { x: 104, y: 2 }, { x: 104, y: 4 }, { x: 102, y: 4 }]);
  });

  it('a MultiPolygon flattens every ring of every polygon into one list', () => {
    const matrix = Mat2D.identity();
    const geometry: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1]]], // polygon A: one ring
        [[[5, 5], [6, 5], [6, 6]], [[5.2, 5.2], [5.4, 5.2], [5.4, 5.4]]] // polygon B: outer + hole
      ]
    };
    const rings = getPolygonRingsScreenPoints(geometry, matrix);
    expect(rings).toHaveLength(3);
    expect(rings[0]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(rings[1]).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]);
    expect(rings[2]).toEqual([{ x: 5.2, y: 5.2 }, { x: 5.4, y: 5.2 }, { x: 5.4, y: 5.4 }]);
  });
});

/// addFeature / removeFeature / setFeatures //////////////////////////////////////////////////////

describe('VectorLayer feature list management', () => {
  it('starts empty when constructed with no options', () => {
    const layer = new VectorLayer();
    expect(layer.features).toEqual([]);
  });

  it('addFeature appends to the list', () => {
    const layer = new VectorLayer();
    const f1: Feature<PointGeometry> = { id: 'a', geometry: { type: 'Point', coordinates: [0, 0] } };
    const f2: Feature<PointGeometry> = { id: 'b', geometry: { type: 'Point', coordinates: [1, 1] } };
    layer.addFeature(f1);
    layer.addFeature(f2);
    expect(layer.features).toEqual([f1, f2]);
  });

  it('removeFeature removes only the feature with the matching id', () => {
    const layer = new VectorLayer();
    const f1: Feature<PointGeometry> = { id: 1, geometry: { type: 'Point', coordinates: [0, 0] } };
    const f2: Feature<PointGeometry> = { id: 2, geometry: { type: 'Point', coordinates: [1, 1] } };
    layer.setFeatures([f1, f2]);
    layer.removeFeature(1);
    expect(layer.features).toEqual([f2]);
  });

  it('removeFeature is a no-op when no feature has that id', () => {
    const layer = new VectorLayer();
    const f1: Feature<PointGeometry> = { id: 'x', geometry: { type: 'Point', coordinates: [0, 0] } };
    layer.setFeatures([f1]);
    layer.removeFeature('does-not-exist');
    expect(layer.features).toEqual([f1]);
  });

  it('setFeatures replaces the whole list wholesale', () => {
    const layer = new VectorLayer();
    layer.addFeature({ geometry: { type: 'Point', coordinates: [0, 0] } });
    const replacement: Feature[] = [{ geometry: { type: 'Point', coordinates: [9, 9] } }];
    layer.setFeatures(replacement);
    expect(layer.features).toEqual(replacement);
  });

  it('setFeatures (and the constructor) defensively copy — later mutating the caller\'s array does not affect the layer', () => {
    const original: Feature[] = [{ id: 'a', geometry: { type: 'Point', coordinates: [0, 0] } }];
    const layer = new VectorLayer({ features: original });
    original.push({ id: 'b', geometry: { type: 'Point', coordinates: [1, 1] } });
    expect(layer.features).toHaveLength(1);

    const replacement: Feature[] = [{ id: 'c', geometry: { type: 'Point', coordinates: [2, 2] } }];
    layer.setFeatures(replacement);
    replacement.push({ id: 'd', geometry: { type: 'Point', coordinates: [3, 3] } });
    expect(layer.features).toHaveLength(1);
  });
});

/// draw() rendering behavior //////////////////////////////////////////////////////////////////////

describe('VectorLayer.draw', () => {
  it('draws nothing for an empty feature list', () => {
    const layer = new VectorLayer();
    const { ctx, calls } = createMockCtx();
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    layer.draw(fakeMap(ctx, camera, 800, 600));
    expect(calls).toEqual([]);
  });

  it('Point: transforms the coordinate through the exact same matrix computeLayerToScreenMatrix produces, and fills a small circle', () => {
    const camera = cameraFor({ x: 1000, y: -2000 }, 0.5, 0.3);
    const layer = new VectorLayer();
    layer.transform.setTranslation(50, -25);
    layer.transform.rotation = 0.1;
    const point: PointGeometry = { type: 'Point', coordinates: [123, -45] };
    layer.addFeature({ geometry: point });

    const { ctx, calls } = createMockCtx();
    const map = fakeMap(ctx, camera, 1000, 800);
    layer.draw(map);

    const expectedMatrix = computeLayerToScreenMatrix(camera, layer.transform, 1000, 800);
    const expected = expectedMatrix.transformPoint({ x: 123, y: -45 });

    const arcCall = calls.find((c) => c.method === 'arc');
    expect(arcCall).toBeDefined();
    expect(arcCall!.args[0]).toBeCloseTo(expected.x, 9);
    expect(arcCall!.args[1]).toBeCloseTo(expected.y, 9);

    const fillCall = calls.find((c) => c.method === 'fill');
    expect(fillCall!.fillStyle).toBe(VECTOR_LAYER_POINT_COLOR);
  });

  it('Point: an identity camera/layer places (100, 50) at (canvas center + 100, canvas center + 50)', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({ features: [{ geometry: { type: 'Point', coordinates: [100, 50] } }] });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const arcCall = calls.find((c) => c.method === 'arc')!;
    expect(arcCall.args[0]).toBeCloseTo(500, 9); // 800/2 + 100
    expect(arcCall.args[1]).toBeCloseTo(350, 9); // 600/2 + 50
  });

  it('LineString: emits moveTo followed by lineTo per remaining point, in order, then one stroke() in the line color', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const line: LineStringGeometry = { type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] };
    const layer = new VectorLayer({ features: [{ geometry: line }] });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(['beginPath', 'moveTo', 'lineTo', 'lineTo', 'stroke']);
    expect(calls[1].args).toEqual([400, 300]); // (0,0) -> center
    expect(calls[2].args).toEqual([410, 300]); // (10,0)
    expect(calls[3].args).toEqual([410, 310]); // (10,10)
    expect(calls[4].strokeStyle).toBe(VECTOR_LAYER_LINE_COLOR);
  });

  it('LineString with zero points draws nothing', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({ features: [{ geometry: { type: 'LineString', coordinates: [] } }] });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));
    expect(calls).toEqual([]);
  });

  it('Polygon with a hole: one beginPath, both rings moveTo/lineTo/closePath, exactly one fill("evenodd") in the fill color', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const polygon: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [[-10, -10], [10, -10], [10, 10], [-10, 10]], // outer
        [[-2, -2], [2, -2], [2, 2], [-2, 2]] // hole
      ]
    };
    const layer = new VectorLayer({ features: [{ geometry: polygon }] });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect(calls[0].method).toBe('beginPath');
    const fillCalls = calls.filter((c) => c.method === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].args).toEqual(['evenodd']);
    expect(fillCalls[0].fillStyle).toBe(VECTOR_LAYER_FILL_COLOR);

    const closePathCount = calls.filter((c) => c.method === 'closePath').length;
    expect(closePathCount).toBe(2); // one per ring

    // Ring point count: outer (4) + hole (4) = 8 moveTo/lineTo point-placing calls total,
    // 2 moveTo (one per ring) + 6 lineTo (3 remaining points per 4-point ring).
    expect(calls.filter((c) => c.method === 'moveTo')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'lineTo')).toHaveLength(6);
  });

  it('MultiPolygon: rings from every polygon are drawn into the same single path/fill', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const multi: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1]]],
        [[[5, 5], [6, 5], [6, 6]]]
      ]
    };
    const layer = new VectorLayer({ features: [{ geometry: multi }] });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect(calls.filter((c) => c.method === 'beginPath')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'fill')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'moveTo')).toHaveLength(2); // one per polygon's ring
    expect(calls.filter((c) => c.method === 'closePath')).toHaveLength(2);
  });

  it('multiple features of different geometry types are all drawn in one draw() call', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [
        { geometry: { type: 'Point', coordinates: [0, 0] } },
        { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
      ]
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect(calls.filter((c) => c.method === 'arc')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'stroke')).toHaveLength(1);
  });

  // ROT-4 regression guard (see BACKLOG.md): VectorLayer.draw must transform every coordinate by
  // hand (matrix.transformPoint, then moveTo/lineTo/arc with the result) rather than
  // ctx.setTransform(matrix) + drawing in local geometry coordinates — the latter silently drops
  // thin stroke()s at deep-zoom coordinate magnitudes (float32 precision inside the canvas
  // rasterizer). The mock ctx above deliberately has no setTransform method at all, so if
  // VectorLayer.draw ever called it, this would throw a TypeError and fail loudly rather than
  // pass silently.
  it('never calls ctx.setTransform — draws entirely through manually transformed points', () => {
    const camera = cameraFor({ x: 5_000_000, y: -3_000_000 }, 1 / 8192, 0.7); // deep-zoom-like magnitudes
    const layer = new VectorLayer({
      features: [
        { geometry: { type: 'Point', coordinates: [5_000_100, -3_000_050] } },
        { geometry: { type: 'LineString', coordinates: [[5_000_000, -3_000_000], [5_000_050, -3_000_000]] } },
        {
          geometry: {
            type: 'Polygon',
            coordinates: [[[5_000_000, -3_000_000], [5_000_010, -3_000_000], [5_000_010, -3_000_010], [5_000_000, -3_000_010]]]
          }
        }
      ]
    });
    const { ctx, calls } = createMockCtx();
    // Would throw here if draw() ever invoked ctx.setTransform — see comment above.
    expect(() => layer.draw(fakeMap(ctx, camera, 800, 600))).not.toThrow();
    expect(calls.some((c) => c.method === 'setTransform')).toBe(false);
  });
});

/// draw() style option (VEC-2) ////////////////////////////////////////////////////////////////////

describe('VectorLayer.draw with a style callback', () => {
  it('applies a custom fillStyle/strokeStyle/lineWidth/dash/pointRadius from the style callback', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const line: LineStringGeometry = { type: 'LineString', coordinates: [[0, 0], [10, 0]] };
    const point: PointGeometry = { type: 'Point', coordinates: [0, 0] };
    const layer = new VectorLayer({
      features: [{ id: 'line', geometry: line }, { id: 'point', geometry: point }],
      style: (feature): FeatureStyle =>
        feature.id === 'line'
          ? { strokeStyle: 'rgb(1,2,3)', lineWidth: 7, dash: [3, 1] }
          : { fillStyle: 'rgb(9,9,9)', pointRadius: 20 }
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const strokeCall = calls.find((c) => c.method === 'stroke')!;
    expect(strokeCall.strokeStyle).toBe('rgb(1,2,3)');
    expect(strokeCall.lineWidth).toBe(7);
    expect(strokeCall.dash).toEqual([3, 1]);

    const arcCall = calls.find((c) => c.method === 'arc')!;
    expect(arcCall.args[2]).toBe(20); // radius

    const fillCall = calls.find((c) => c.method === 'fill')!;
    expect(fillCall.fillStyle).toBe('rgb(9,9,9)');
  });

  it('a style returning null/undefined skips only that feature, preserving the draw order of the rest', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [
        { id: 'a', geometry: { type: 'Point', coordinates: [0, 0] } },
        { id: 'skip', geometry: { type: 'Point', coordinates: [1, 1] } },
        { id: 'b', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
      ],
      style: (feature): FeatureStyle | null => (feature.id === 'skip' ? null : {})
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect(calls.filter((c) => c.method === 'arc')).toHaveLength(1); // only feature 'a', not 'skip'
    expect(calls.filter((c) => c.method === 'stroke')).toHaveLength(1); // feature 'b' still drawn
    // Order preserved: the surviving arc() still precedes the surviving stroke().
    const arcIndex = calls.findIndex((c) => c.method === 'arc');
    const strokeIndex = calls.findIndex((c) => c.method === 'stroke');
    expect(arcIndex).toBeLessThan(strokeIndex);
  });

  it('an undefined return from style also skips the feature (not just null)', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }],
      style: (): FeatureStyle | undefined => undefined
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));
    expect(calls).toEqual([]);
  });

  // The bug class the ticket specifically calls out: ctx.lineWidth/ctx.setLineDash are canvas
  // *state*, not per-call arguments, so they persist across stroke() calls unless explicitly reset
  // every time. A feature styled with a thick dashed line must not leak that onto the next
  // feature's stroke just because that next feature's style doesn't mention dash/lineWidth at all.
  it('dash/lineWidth do not bleed from one LineString feature onto the next', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [
        { id: 'thick-dashed', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } },
        { id: 'plain', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } }
      ],
      style: (feature): FeatureStyle =>
        feature.id === 'thick-dashed' ? { lineWidth: 9, dash: [5, 5] } : {} // second feature: all defaults
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const strokeCalls = calls.filter((c) => c.method === 'stroke');
    expect(strokeCalls).toHaveLength(2);
    expect(strokeCalls[0].lineWidth).toBe(9);
    expect(strokeCalls[0].dash).toEqual([5, 5]);
    // The second feature explicitly did not ask for a dash/thick line — it must render solid at
    // the default width, not inherit the first feature's canvas state.
    expect(strokeCalls[1].lineWidth).toBe(1);
    expect(strokeCalls[1].dash).toEqual([]);
  });

  // Same bug class as the test above, but at draw()'s own outer boundary rather than between two
  // features of one layer: map.ctx is ONE CanvasRenderingContext2D shared across every layer for
  // the whole frame (see MapWidget.onRepaint's `for (...) layer.draw(this)` loop) — if the LAST
  // feature this layer draws leaves a custom lineWidth/dash on ctx, whatever layer draws next this
  // frame (e.g. map_grid/drawTileDebug, neither of which sets its own lineWidth/dash — see
  // src/layers.ts) would silently inherit it. draw() must leave ctx back at the neutral defaults
  // every other layer already assumes, not just avoid leaking between its own features.
  it('resets ctx.lineWidth/dash to defaults after draw() returns, so a layer drawn afterwards does not inherit them', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } }],
      style: (): FeatureStyle => ({ lineWidth: 12, dash: [7, 3] }) // the last (only) feature drawn
    });
    const { ctx, getDash } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect((ctx as unknown as { lineWidth: number }).lineWidth).toBe(1);
    expect(getDash()).toEqual([]);
  });

  it('a Point with an icon draws via drawImage (centered, using the explicit iconSize) instead of a filled circle', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const icon = fakeIcon(100, 100); // deliberately different from iconSize below, to prove iconSize wins
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [100, 50] } }],
      style: (): FeatureStyle => ({ icon, iconSize: [20, 10] })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect(calls.filter((c) => c.method === 'arc')).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'fill')).toHaveLength(0);
    const drawImageCall = calls.find((c) => c.method === 'drawImage')!;
    expect(drawImageCall).toBeDefined();
    // Center point is (400 + 100, 300 + 50) = (500, 350); top-left is offset by -width/2, -height/2.
    expect(drawImageCall.args).toEqual([icon, 500 - 10, 350 - 5, 20, 10]);
  });

  it('a Point with an icon but no iconSize falls back to the image\'s natural size', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const icon = fakeIcon(40, 16); // no HTMLImageElement/HTMLCanvasElement in this DOM-free test env,
    // so getNaturalIconSize falls through to its generic {width, height} branch — see fakeIcon's comment.
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }],
      style: (): FeatureStyle => ({ icon })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const drawImageCall = calls.find((c) => c.method === 'drawImage')!;
    expect(drawImageCall.args).toEqual([icon, 400 - 20, 300 - 8, 40, 16]);
  });

  it('Polygon with strokeStyle set: stroke() follows fill("evenodd") with the given lineWidth', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const polygon: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10]]]
    };
    const layer = new VectorLayer({
      features: [{ geometry: polygon }],
      style: (): FeatureStyle => ({ strokeStyle: 'rgb(7,7,7)', lineWidth: 3, dash: [2, 2] })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillIndex = calls.findIndex((c) => c.method === 'fill');
    const strokeIndex = calls.findIndex((c) => c.method === 'stroke');
    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(strokeIndex).toBe(fillIndex + 1); // stroke immediately follows fill, same path
    expect(calls[strokeIndex].strokeStyle).toBe('rgb(7,7,7)');
    expect(calls[strokeIndex].lineWidth).toBe(3);
    expect(calls[strokeIndex].dash).toEqual([2, 2]);
  });

  it('Polygon without strokeStyle in its style: no stroke() call at all (same as VEC-1 default)', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const polygon: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10]]]
    };
    const layer = new VectorLayer({
      features: [{ geometry: polygon }],
      style: (): FeatureStyle => ({ fillStyle: 'rgb(5,5,5)' }) // no strokeStyle
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect(calls.filter((c) => c.method === 'stroke')).toHaveLength(0);
  });
});

/// computeLabelAnchor (DOM-free, VEC-6) ///////////////////////////////////////////////////////////

describe('computeLabelAnchor (DOM-free)', () => {
  it('Point without icon anchors above the circle, using pointRadius (or its default)', () => {
    const geometry: PointGeometry = { type: 'Point', coordinates: [0, 0] };
    // pointRadius 4 (the default) + LABEL_OFFSET_PX 4 = 8px above the point.
    expect(computeLabelAnchor(geometry, {}, Mat2D.identity())).toEqual({
      point: { x: 0, y: -8 },
      textAlign: 'center',
      textBaseline: 'bottom'
    });
  });

  it('Point with icon anchors above the icon\'s half height, not pointRadius', () => {
    const geometry: PointGeometry = { type: 'Point', coordinates: [0, 0] };
    const icon = fakeIcon(999, 999); // deliberately different from iconSize, to prove iconSize wins
    // half of iconSize height (10/2=5) + LABEL_OFFSET_PX 4 = 9px above the point.
    expect(computeLabelAnchor(geometry, { icon, iconSize: [20, 10] }, Mat2D.identity())).toEqual({
      point: { x: 0, y: -9 },
      textAlign: 'center',
      textBaseline: 'bottom'
    });
  });

  it('LineString anchors at the vertex at the middle INDEX of the point list, not the midpoint by length', () => {
    const geometry: LineStringGeometry = { type: 'LineString', coordinates: [[0, 0], [100, 0], [100, 100], [0, 100]] };
    // floor(4 / 2) = 2 -> the THIRD point, (100, 100) - very far from the path's actual half-length.
    expect(computeLabelAnchor(geometry, {}, Mat2D.identity())).toEqual({
      point: { x: 100, y: 96 },
      textAlign: 'center',
      textBaseline: 'bottom'
    });
  });

  it('LineString with zero points has no anchor at all', () => {
    const geometry: LineStringGeometry = { type: 'LineString', coordinates: [] };
    expect(computeLabelAnchor(geometry, {}, Mat2D.identity())).toBeUndefined();
  });

  it('Polygon anchors at the centroid of the OUTER ring, excluding the closing duplicate point, ignoring holes', () => {
    const geometry: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // closed outer ring (5 points, first repeated last)
        [[3, 3], [6, 3], [6, 6], [3, 6], [3, 3]] // hole — must not affect the centroid at all
      ]
    };
    // Average of the 4 DISTINCT outer-ring vertices (dropping the closing duplicate): (5, 5).
    // Naively averaging all 5 points (including the duplicate) would instead give (4, 4).
    expect(computeLabelAnchor(geometry, {}, Mat2D.identity())).toEqual({
      point: { x: 5, y: 5 },
      textAlign: 'center',
      textBaseline: 'middle'
    });
  });

  it('MultiPolygon anchors at the outer-ring centroid of the FIRST polygon only', () => {
    const geometry: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]], // first polygon: centroid (2, 2)
        [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]] // second polygon: ignored
      ]
    };
    expect(computeLabelAnchor(geometry, {}, Mat2D.identity())).toEqual({
      point: { x: 2, y: 2 },
      textAlign: 'center',
      textBaseline: 'middle'
    });
  });
});

/// draw() label rendering (VEC-6) /////////////////////////////////////////////////////////////////

describe('VectorLayer.draw label rendering', () => {
  it('a feature with no label set never calls ctx.fillText', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({ features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }] });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));
    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(0);
  });

  it('Point without icon: exactly one fillText, positioned above the circle, in the default label color', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }],
      style: (): FeatureStyle => ({ label: 'Hello' })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillTextCalls = calls.filter((c) => c.method === 'fillText');
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0].args).toEqual(['Hello', 400, 292]); // center (400, 300) minus radius+offset (4+4)
    expect(fillTextCalls[0].textAlign).toBe('center');
    expect(fillTextCalls[0].textBaseline).toBe('bottom');
    expect(fillTextCalls[0].fillStyle).toBe(VECTOR_LAYER_LABEL_COLOR);
  });

  it('Point with icon: label sits above the icon\'s bounding box, not a circle', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const icon = fakeIcon(100, 100);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [100, 50] } }],
      style: (): FeatureStyle => ({ icon, iconSize: [20, 10], label: 'Marker' })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillTextCall = calls.find((c) => c.method === 'fillText')!;
    // Center (500, 350); half icon height 5, offset 4 => y = 341.
    expect(fillTextCall.args).toEqual(['Marker', 500, 341]);
  });

  it('LineString: label positioned at the middle-INDEX vertex, not the midpoint by length', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const line: LineStringGeometry = { type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10], [0, 10]] };
    const layer = new VectorLayer({ features: [{ geometry: line }], style: (): FeatureStyle => ({ label: 'Road' }) });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillTextCall = calls.find((c) => c.method === 'fillText')!;
    // floor(4 / 2) = 2 -> third point (10, 10) -> screen (410, 310); label 4px above that.
    expect(fillTextCall.args).toEqual(['Road', 410, 306]);
    expect(fillTextCall.textAlign).toBe('center');
    expect(fillTextCall.textBaseline).toBe('bottom');
  });

  it('LineString with zero points draws no label either, same as it draws no line', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'LineString', coordinates: [] } }],
      style: (): FeatureStyle => ({ label: 'Ghost road' })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));
    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(0);
  });

  it('Polygon with a hole: label positioned at the OUTER ring\'s centroid, unaffected by the hole', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const polygon: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // closed outer ring
        [[3, 3], [6, 3], [6, 6], [3, 6], [3, 3]] // hole
      ]
    };
    const layer = new VectorLayer({ features: [{ geometry: polygon }], style: (): FeatureStyle => ({ label: 'Zone' }) });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillTextCall = calls.find((c) => c.method === 'fillText')!;
    // Outer-ring centroid (excluding the closing duplicate) is (5, 5) -> screen (405, 305).
    expect(fillTextCall.args).toEqual(['Zone', 405, 305]);
    expect(fillTextCall.textAlign).toBe('center');
    expect(fillTextCall.textBaseline).toBe('middle');
  });

  it('MultiPolygon: label positioned at the FIRST polygon\'s outer-ring centroid', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const multi: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
        [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]]
      ]
    };
    const layer = new VectorLayer({ features: [{ geometry: multi }], style: (): FeatureStyle => ({ label: 'Area' }) });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillTextCall = calls.find((c) => c.method === 'fillText')!;
    // First polygon's centroid (2, 2) -> screen (402, 302).
    expect(fillTextCall.args).toEqual(['Area', 402, 302]);
  });

  it('labelColor overrides the default label color', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }],
      style: (): FeatureStyle => ({ label: 'Custom', labelColor: 'rgb(9,8,7)' })
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    const fillTextCall = calls.find((c) => c.method === 'fillText')!;
    expect(fillTextCall.fillStyle).toBe('rgb(9,8,7)');
  });

  it('a feature whose style() returns null/undefined draws no label at all (same early-continue as the shape itself)', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ id: 'hidden', geometry: { type: 'Point', coordinates: [0, 0] } }],
      style: (): FeatureStyle | null => null
    });
    const { ctx, calls } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));
    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(0);
  });

  // Same reasoning as the existing lineWidth/dash reset test above (VEC-2): ctx.font/textAlign/
  // textBaseline are shared canvas *state*, so a layer drawn after this one must not inherit
  // whatever the last label left behind.
  it('resets ctx.font/textAlign/textBaseline to plain canvas defaults after draw() returns', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const layer = new VectorLayer({
      features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }],
      style: (): FeatureStyle => ({ label: 'Leftover' })
    });
    const { ctx } = createMockCtx();
    layer.draw(fakeMap(ctx, camera, 800, 600));

    expect((ctx as unknown as { font: string }).font).toBe('');
    expect((ctx as unknown as { textAlign: string }).textAlign).toBe('start');
    expect((ctx as unknown as { textBaseline: string }).textBaseline).toBe('alphabetic');
  });
});

/// distanceToSegment / pointInRings (DOM-free, VEC-4) ////////////////////////////////////////////

describe('distanceToSegment (DOM-free)', () => {
  it('is zero for a point that lies exactly on the segment', () => {
    expect(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 9);
  });

  it('measures the perpendicular distance when the closest point is strictly between the endpoints', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 9);
  });

  it('clamps to the nearest endpoint when the projection falls outside the segment', () => {
    // Closest point on the (0,0)-(10,0) segment to (15, 4) is the endpoint (10, 0), not the
    // infinite line's projection — distance is hypot(5, 4), not just 4.
    expect(distanceToSegment({ x: 15, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(Math.hypot(5, 4), 9);
  });

  it('degenerates to point-to-point distance for a zero-length segment', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 9);
  });
});

describe('pointInRings (DOM-free)', () => {
  const square: XY[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it('a point inside a single ring is inside', () => {
    expect(pointInRings({ x: 5, y: 5 }, [square])).toBe(true);
  });

  it('a point outside every ring is outside', () => {
    expect(pointInRings({ x: 50, y: 50 }, [square])).toBe(false);
  });

  it('a point inside the outer ring but inside a hole ring is outside (evenodd across all rings)', () => {
    const hole: XY[] = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }];
    expect(pointInRings({ x: 5, y: 5 }, [square, hole])).toBe(false);
    // Still inside the outer ring, outside the hole -> inside the shape.
    expect(pointInRings({ x: 1, y: 1 }, [square, hole])).toBe(true);
  });
});

/// VectorLayer.getFeatureAt (DOM-free, VEC-4) /////////////////////////////////////////////////////
// Identity camera + a 800x600 canvas puts geometry coordinate (x, y) at screen (400 + x, 300 + y) —
// same convention already established by the VectorLayer.draw tests above.

describe('VectorLayer.getFeatureAt', () => {
  const identityCamera = () => cameraFor({ x: 0, y: 0 }, 1);
  const map800x600 = () => fakeMap(createMockCtx().ctx, identityCamera(), 800, 600);

  it('Point: hits dead center, and misses well outside the (floored) hit radius', () => {
    const point: Feature<PointGeometry> = { id: 'p', geometry: { type: 'Point', coordinates: [0, 0] } };
    const layer = new VectorLayer({ features: [point] });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 400, y: 300 }, map)).toBe(point);
    expect(layer.getFeatureAt({ x: 500, y: 500 }, map)).toBeUndefined();
  });

  it('Point: MIN_HIT_RADIUS_PX floors the click target even when drawn with a much smaller pointRadius', () => {
    const point: Feature<PointGeometry> = { id: 'p', geometry: { type: 'Point', coordinates: [0, 0] } };
    // pointRadius 1 is drawn far smaller than MIN_HIT_RADIUS_PX (8) — a click 6px away misses the
    // drawn circle but must still hit, because the click threshold floors at MIN_HIT_RADIUS_PX.
    const layer = new VectorLayer({ features: [point], style: (): FeatureStyle => ({ pointRadius: 1 }) });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 406, y: 300 }, map)).toBe(point); // 6px away: within the floor
    expect(layer.getFeatureAt({ x: 410, y: 300 }, map)).toBeUndefined(); // 10px away: beyond the floor
  });

  it('Point with icon: hits inside the centered icon bounding box, misses just outside it', () => {
    const icon = fakeIcon(100, 100);
    const point: Feature<PointGeometry> = { geometry: { type: 'Point', coordinates: [100, 50] } };
    const layer = new VectorLayer({ features: [point], style: (): FeatureStyle => ({ icon, iconSize: [20, 10] }) });
    const map = map800x600();

    // Center at (500, 350); bbox is x in [490, 510], y in [345, 355].
    expect(layer.getFeatureAt({ x: 495, y: 350 }, map)).toBe(point);
    expect(layer.getFeatureAt({ x: 485, y: 350 }, map)).toBeUndefined(); // just left of the bbox
  });

  it('LineString: MIN_LINE_HIT_TOLERANCE_PX floors the click tolerance for a hairline-width line', () => {
    const line: Feature<LineStringGeometry> = { id: 'l', geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] } };
    // Default lineWidth (1px) would give a geometric tolerance of 0.5px — floored to MIN_LINE_HIT_TOLERANCE_PX (5).
    const layer = new VectorLayer({ features: [line] });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 450, y: 303 }, map)).toBe(line); // 3px away: within the floor
    expect(layer.getFeatureAt({ x: 450, y: 309 }, map)).toBeUndefined(); // 9px away: beyond the floor
  });

  it('LineString: a wide lineWidth widens the tolerance beyond the floor', () => {
    const line: Feature<LineStringGeometry> = { geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] } };
    const layer = new VectorLayer({ features: [line], style: (): FeatureStyle => ({ lineWidth: 20 }) });
    const map = map800x600();

    // Tolerance = max(20/2, 5) = 10.
    expect(layer.getFeatureAt({ x: 450, y: 308 }, map)).toBe(line);
    expect(layer.getFeatureAt({ x: 450, y: 315 }, map)).toBeUndefined();
  });

  it('Polygon with a hole: a click inside the hole misses despite being inside the outer ring\'s bounding box', () => {
    const polygon: Feature<PolygonGeometry> = {
      id: 'poly',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-10, -10], [10, -10], [10, 10], [-10, 10]], // outer
          [[-5, -5], [5, -5], [5, 5], [-5, 5]] // hole
        ]
      }
    };
    const layer = new VectorLayer({ features: [polygon] });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 400, y: 300 }, map)).toBeUndefined(); // center of the hole
    expect(layer.getFeatureAt({ x: 407, y: 300 }, map)).toBe(polygon); // outside hole, inside outer
    expect(layer.getFeatureAt({ x: 450, y: 450 }, map)).toBeUndefined(); // outside everything
  });

  it('MultiPolygon: a click inside any one of its polygons hits', () => {
    const multi: Feature<MultiPolygonGeometry> = {
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [4, 0], [4, 4], [0, 4]]],
          [[[100, 100], [104, 100], [104, 104], [100, 104]]]
        ]
      }
    };
    const layer = new VectorLayer({ features: [multi] });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 402, y: 302 }, map)).toBe(multi); // inside the first polygon
    expect(layer.getFeatureAt({ x: 502, y: 402 }, map)).toBe(multi); // inside the second polygon
    expect(layer.getFeatureAt({ x: 450, y: 450 }, map)).toBeUndefined();
  });

  it('checks features back-to-front so the topmost (last-drawn) overlapping feature wins', () => {
    const bottom: Feature<PointGeometry> = { id: 'bottom', geometry: { type: 'Point', coordinates: [0, 0] } };
    const top: Feature<PointGeometry> = { id: 'top', geometry: { type: 'Point', coordinates: [0, 0] } };
    const layer = new VectorLayer({ features: [bottom, top] });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 400, y: 300 }, map)).toBe(top);
  });

  it('a feature whose style returns null/undefined is not hittable, but a feature under it still is', () => {
    const bottom: Feature<PointGeometry> = { id: 'bottom', geometry: { type: 'Point', coordinates: [0, 0] } };
    const hidden: Feature<PointGeometry> = { id: 'hidden', geometry: { type: 'Point', coordinates: [0, 0] } };
    const layer = new VectorLayer({
      features: [bottom, hidden],
      style: (feature): FeatureStyle | null => (feature.id === 'hidden' ? null : {})
    });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 400, y: 300 }, map)).toBe(bottom);
  });

  it('an invisible layer never reports a hit, even dead center on a feature', () => {
    const point: Feature<PointGeometry> = { geometry: { type: 'Point', coordinates: [0, 0] } };
    const layer = new VectorLayer({ features: [point], visible: false });
    const map = map800x600();

    expect(layer.getFeatureAt({ x: 400, y: 300 }, map)).toBeUndefined();
  });
});

/// VectorLayer.enableFeatureEvents (DOM-free, VEC-4) //////////////////////////////////////////////

describe('VectorLayer.enableFeatureEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup() {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    const canvas = fakeCanvas(800, 600);
    const { ctx } = createMockCtx();
    const map = fakeMapWithCanvas(ctx, camera, canvas);
    return { canvas, map };
  }

  it('fires onFeatureHover only when the feature under the cursor actually changes', () => {
    const featureA: Feature<PointGeometry> = { id: 'a', geometry: { type: 'Point', coordinates: [0, 0] } };
    const featureB: Feature<PointGeometry> = { id: 'b', geometry: { type: 'Point', coordinates: [200, 0] } };
    const onFeatureHover = vi.fn();
    const layer = new VectorLayer({ features: [featureA, featureB], onFeatureHover });
    const { canvas, map } = setup();
    layer.enableFeatureEvents(map);

    // Two mousemoves over the same feature (a): only one hover call.
    canvas.dispatch('mousemove', { offsetX: 400, offsetY: 300 });
    canvas.dispatch('mousemove', { offsetX: 401, offsetY: 300 });
    expect(onFeatureHover).toHaveBeenCalledTimes(1);
    expect(onFeatureHover).toHaveBeenLastCalledWith(featureA, map);

    // Move onto feature b: a second call, with the new feature.
    canvas.dispatch('mousemove', { offsetX: 600, offsetY: 300 });
    expect(onFeatureHover).toHaveBeenCalledTimes(2);
    expect(onFeatureHover).toHaveBeenLastCalledWith(featureB, map);

    // Move off every feature: a third call with undefined.
    canvas.dispatch('mousemove', { offsetX: 0, offsetY: 0 });
    expect(onFeatureHover).toHaveBeenCalledTimes(3);
    expect(onFeatureHover).toHaveBeenLastCalledWith(undefined, map);

    // Staying off every feature: no further calls.
    canvas.dispatch('mousemove', { offsetX: 1, offsetY: 1 });
    expect(onFeatureHover).toHaveBeenCalledTimes(3);
  });

  it('a real click (fast, near-stationary) fires onFeatureClick for the feature under the cursor', () => {
    const feature: Feature<PointGeometry> = { geometry: { type: 'Point', coordinates: [0, 0] } };
    const onFeatureClick = vi.fn();
    const layer = new VectorLayer({ features: [feature], onFeatureClick });
    const { canvas, map } = setup();
    layer.enableFeatureEvents(map);

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000);
    canvas.dispatch('mousedown', { offsetX: 400, offsetY: 300 });
    nowSpy.mockReturnValueOnce(1050); // 50ms later, well under TAP_MAX_DURATION_MS
    canvas.dispatch('mouseup', { offsetX: 401, offsetY: 300 }); // 1px movement, well under the tap threshold

    expect(onFeatureClick).toHaveBeenCalledTimes(1);
    expect(onFeatureClick).toHaveBeenCalledWith(feature, map);
  });

  it('a click released after a drag-pan (long duration and/or movement) is NOT counted as a feature click', () => {
    const feature: Feature<PointGeometry> = { geometry: { type: 'Point', coordinates: [0, 0] } };
    const onFeatureClick = vi.fn();
    const layer = new VectorLayer({ features: [feature], onFeatureClick });
    const { canvas, map } = setup();
    layer.enableFeatureEvents(map);

    const nowSpy = vi.spyOn(performance, 'now');

    // Case 1: long duration, mouse released back over the same feature.
    nowSpy.mockReturnValueOnce(0);
    canvas.dispatch('mousedown', { offsetX: 400, offsetY: 300 });
    nowSpy.mockReturnValueOnce(2000); // 2s later — way past TAP_MAX_DURATION_MS
    canvas.dispatch('mouseup', { offsetX: 400, offsetY: 300 });
    expect(onFeatureClick).not.toHaveBeenCalled();

    // Case 2: short duration, but the pointer was released far from where it went down (a
    // drag-pan) — isTap measures movement between the recorded mousedown and this mouseup, the
    // same start-vs-end convention the existing touch tap detection (isTap's other caller) uses.
    nowSpy.mockReturnValueOnce(3000);
    canvas.dispatch('mousedown', { offsetX: 400, offsetY: 300 });
    nowSpy.mockReturnValueOnce(3050);
    canvas.dispatch('mouseup', { offsetX: 700, offsetY: 300 });
    expect(onFeatureClick).not.toHaveBeenCalled();
  });

  it('a click that lands on no feature calls nothing', () => {
    const onFeatureClick = vi.fn();
    const layer = new VectorLayer({ features: [], onFeatureClick });
    const { canvas, map } = setup();
    layer.enableFeatureEvents(map);

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    canvas.dispatch('mousedown', { offsetX: 400, offsetY: 300 });
    nowSpy.mockReturnValueOnce(10);
    canvas.dispatch('mouseup', { offsetX: 400, offsetY: 300 });

    expect(onFeatureClick).not.toHaveBeenCalled();
  });

  it('calling enableFeatureEvents with neither callback set does not throw', () => {
    const layer = new VectorLayer({ features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }] });
    const { canvas, map } = setup();
    expect(() => layer.enableFeatureEvents(map)).not.toThrow();

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    canvas.dispatch('mousedown', { offsetX: 400, offsetY: 300 });
    nowSpy.mockReturnValueOnce(10);
    expect(() => {
      canvas.dispatch('mouseup', { offsetX: 400, offsetY: 300 });
      canvas.dispatch('mousemove', { offsetX: 400, offsetY: 300 });
    }).not.toThrow();
  });

  it('the returned unsubscribe function removes every listener it added', () => {
    const onFeatureClick = vi.fn();
    const onFeatureHover = vi.fn();
    const feature: Feature<PointGeometry> = { geometry: { type: 'Point', coordinates: [0, 0] } };
    const layer = new VectorLayer({ features: [feature], onFeatureClick, onFeatureHover });
    const { canvas, map } = setup();
    const unsubscribe = layer.enableFeatureEvents(map);

    expect(canvas.listenerCount('mousemove')).toBe(1);
    expect(canvas.listenerCount('mousedown')).toBe(1);
    expect(canvas.listenerCount('mouseup')).toBe(1);

    unsubscribe();

    expect(canvas.listenerCount('mousemove')).toBe(0);
    expect(canvas.listenerCount('mousedown')).toBe(0);
    expect(canvas.listenerCount('mouseup')).toBe(0);

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    canvas.dispatch('mousedown', { offsetX: 400, offsetY: 300 });
    nowSpy.mockReturnValueOnce(10);
    canvas.dispatch('mouseup', { offsetX: 400, offsetY: 300 });
    canvas.dispatch('mousemove', { offsetX: 400, offsetY: 300 });

    expect(onFeatureClick).not.toHaveBeenCalled();
    expect(onFeatureHover).not.toHaveBeenCalled();
  });
});

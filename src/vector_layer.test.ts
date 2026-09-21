import { describe, expect, it } from 'vitest';
import { Transform2D } from './transform2d.js';
import { Mat2D } from './mat2d.js';
import { computeLayerToScreenMatrix } from './map.js';
import type { MapWidget } from './map.js';
import { VECTOR_LAYER_FILL_COLOR, VECTOR_LAYER_LINE_COLOR, VECTOR_LAYER_POINT_COLOR } from './defines.js';
import {
  VectorLayer,
  transformCoordinate,
  transformRing,
  getPolygonRingsScreenPoints
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
}

function createMockCtx(): { ctx: CanvasRenderingContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let currentDash: number[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
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
    }
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
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

import { describe, expect, it } from 'vitest';
import { Transform2D } from './transform2d.js';
import { Mat2D } from './mat2d.js';
import {
  classifyWheelEvent,
  computeBufferBlitMatrix,
  computeBufferDiag,
  computeLayerToScreenMatrix,
  computeTileGridMatrix,
  computeTileIndexBounds,
  computeUnrotatedLayerToScreenMatrix,
  computeUnrotatedTileGridMatrix,
  DEFAULT_BUFFER_SIZE_GRANULARITY,
  hasCrossedActivationThreshold,
  isDoubleTapContinuation,
  isTap,
  TiledLayer,
  type MapWidget,
  type PendingTap,
  type WheelClassifyState
} from './map.js';
import { TileSource } from './tile_source.js';

// AFF-4's core safety net: computeTileGridMatrix replaced the old inline
// `x * tile_size - c.x + w / 2` arithmetic in TiledLayer.draw. This reimplements that old
// formula independently (not by reading it back out of map.ts) and checks the new matrix
// reproduces it exactly for a layer left at its default (identity) transform — which is every
// layer that exists today, since nothing sets shift/scale/rotation to anything but the default.
// DOM-free by construction (Transform2D has no browser dependency), so this doesn't need a live
// canvas or Playwright to give strong, fast confidence the rewrite didn't move a single pixel.

function oldFormula(
  position: XY,
  zf: number,
  tileSizeNative: number,
  w: number,
  h: number,
  ix: number,
  iy: number
): { x: number; y: number; tile_size: number } {
  const z = Math.ceil(Math.log2(zf));
  const k = zf / Math.pow(2, z);
  const tile_size = tileSizeNative * k;
  const c = { x: position.x * zf, y: position.y * zf };
  return {
    x: ix * tile_size - c.x + w / 2,
    y: iy * tile_size - c.y + h / 2,
    tile_size
  };
}

function cameraFor(position: XY, zf: number): Transform2D {
  const camera = new Transform2D();
  camera.setTranslation(position.x, position.y);
  camera.setScale(1 / zf);
  return camera;
}

interface Case {
  label: string;
  position: XY;
  zf: number;
  tileSizeNative: number;
  w: number;
  h: number;
  ix: number;
  iy: number;
}

const CASES: Case[] = [
  { label: 'default location, zoom_factor=1 (zoom_max), OSM-sized tiles', position: { x: 40373076, y: 22579095 }, zf: 1, tileSizeNative: 256, w: 1280, h: 720, ix: 5, iy: -3 },
  { label: 'roaddogs location, mid zoom, negative tile indices', position: { x: 12482409, y: 27045819 }, zf: 0.37, tileSizeNative: 256, w: 800, h: 600, ix: -10, iy: 20 },
  { label: 'near zoom_min, xkcd-sized tiles, origin', position: { x: 0, y: 0 }, zf: 1 / 8192, tileSizeNative: 2048, w: 1024, h: 768, ix: 1, iy: 1 },
  { label: 'exact power-of-two zoom_factor boundary (z lands exactly on an octave)', position: { x: 1000, y: -2000 }, zf: 0.5, tileSizeNative: 256, w: 1000, h: 1000, ix: 3, iy: 3 },
  { label: 'zoom_factor just above a power-of-two boundary', position: { x: 1000, y: -2000 }, zf: 0.5001, tileSizeNative: 256, w: 1000, h: 1000, ix: 3, iy: 3 },
  { label: 'tile index (0,0)', position: { x: 500, y: 500 }, zf: 0.8, tileSizeNative: 512, w: 640, h: 480, ix: 0, iy: 0 }
];

describe('computeTileGridMatrix', () => {
  it.each(CASES)('matches the old x*tile_size - c.x + w/2 formula exactly: $label', (c) => {
    const camera = cameraFor(c.position, c.zf);
    const layerTransform = new Transform2D(); // identity — matches every real layer today

    const z = Math.ceil(Math.log2(c.zf));
    const world_tile_edge = c.tileSizeNative / Math.pow(2, z);

    const matrix = computeTileGridMatrix(camera, layerTransform, c.w, c.h, world_tile_edge);
    const actual = matrix.transformPoint({ x: c.ix, y: c.iy });
    const expected = oldFormula(c.position, c.zf, c.tileSizeNative, c.w, c.h, c.ix, c.iy);

    expect(actual.x).toBeCloseTo(expected.x, 6);
    expect(actual.y).toBeCloseTo(expected.y, 6);
  });

  it('the tile-index unit square scales to exactly tile_size screen pixels, for an identity layer', () => {
    const c = CASES[1];
    const camera = cameraFor(c.position, c.zf);
    const layerTransform = new Transform2D();

    const z = Math.ceil(Math.log2(c.zf));
    const world_tile_edge = c.tileSizeNative / Math.pow(2, z);
    const matrix = computeTileGridMatrix(camera, layerTransform, c.w, c.h, world_tile_edge);

    const topLeft = matrix.transformPoint({ x: c.ix, y: c.iy });
    const bottomRight = matrix.transformPoint({ x: c.ix + 1, y: c.iy + 1 });
    const expected = oldFormula(c.position, c.zf, c.tileSizeNative, c.w, c.h, c.ix, c.iy).tile_size;

    expect(bottomRight.x - topLeft.x).toBeCloseTo(expected, 6);
    expect(bottomRight.y - topLeft.y).toBeCloseTo(expected, 6);
  });

  it('a nonzero layer shift moves every tile by exactly that world-space offset, scaled by zoom', () => {
    const c = CASES[0];
    const camera = cameraFor(c.position, c.zf);
    const z = Math.ceil(Math.log2(c.zf));
    const world_tile_edge = c.tileSizeNative / Math.pow(2, z);

    const identity = new Transform2D();
    const shifted = new Transform2D();
    const shift = { x: 1000, y: -500 };
    shifted.setTranslation(shift.x, shift.y);

    const m0 = computeTileGridMatrix(camera, identity, c.w, c.h, world_tile_edge);
    const m1 = computeTileGridMatrix(camera, shifted, c.w, c.h, world_tile_edge);

    const p0 = m0.transformPoint({ x: c.ix, y: c.iy });
    const p1 = m1.transformPoint({ x: c.ix, y: c.iy });

    // A world-space shift is subject to the same world->screen zoom scale as everything else.
    expect(p1.x - p0.x).toBeCloseTo(shift.x * c.zf, 6);
    expect(p1.y - p0.y).toBeCloseTo(shift.y * c.zf, 6);
  });

  it('a per-layer scale scales tile spacing around the origin, independent of camera zoom', () => {
    const c = CASES[0];
    const camera = cameraFor(c.position, c.zf);
    const z = Math.ceil(Math.log2(c.zf));
    const world_tile_edge = c.tileSizeNative / Math.pow(2, z);

    const identity = new Transform2D();
    const scaled = new Transform2D();
    scaled.setScale(2);

    const m0 = computeTileGridMatrix(camera, identity, c.w, c.h, world_tile_edge);
    const m1 = computeTileGridMatrix(camera, scaled, c.w, c.h, world_tile_edge);

    // Distance between two tile indices, in screen pixels, should double.
    const a0 = m0.transformPoint({ x: 0, y: 0 });
    const b0 = m0.transformPoint({ x: 4, y: 0 });
    const a1 = m1.transformPoint({ x: 0, y: 0 });
    const b1 = m1.transformPoint({ x: 4, y: 0 });

    const dist0 = b0.x - a0.x;
    const dist1 = b1.x - a1.x;
    expect(dist1).toBeCloseTo(dist0 * 2, 6);
  });
});

// VEC-1: computeLayerToScreenMatrix is computeTileGridMatrix's shared core, factored out so
// VectorLayer (src/vector_layer.ts, which draws directly in shared world units, with no notion of
// a "tile edge") can place features through the exact same camera+layer composition TiledLayer
// uses, rather than a second, only-hopefully-consistent implementation.
describe('computeLayerToScreenMatrix', () => {
  it.each(CASES)('matches computeTileGridMatrix with the world_tile_edge scaling factored back out: $label', (c) => {
    const camera = cameraFor(c.position, c.zf);
    const layerTransform = new Transform2D();
    const z = Math.ceil(Math.log2(c.zf));
    const world_tile_edge = c.tileSizeNative / Math.pow(2, z);

    const layerMatrix = computeLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
    const tileMatrix = computeTileGridMatrix(camera, layerTransform, c.w, c.h, world_tile_edge);
    const reconstructed = layerMatrix.multiply(Mat2D.scaling(world_tile_edge, world_tile_edge));

    expect(reconstructed.equals(tileMatrix)).toBe(true);
  });

  it('is the identity translated to the canvas center, for identity camera/layer transforms', () => {
    const camera = new Transform2D();
    const layerTransform = new Transform2D();
    const matrix = computeLayerToScreenMatrix(camera, layerTransform, 800, 600);

    const p = matrix.transformPoint({ x: 10, y: -5 });
    expect(p.x).toBeCloseTo(410, 9);
    expect(p.y).toBeCloseTo(295, 9);
  });

  it('places a world point at the canvas center exactly when it equals the camera position', () => {
    const c = CASES[1];
    const camera = cameraFor(c.position, c.zf);
    const layerTransform = new Transform2D();
    const matrix = computeLayerToScreenMatrix(camera, layerTransform, c.w, c.h);

    // A point in the layer's local space that, after the layer's own (identity) transform, lands
    // exactly on the camera's world position should map to the exact center of the canvas.
    const p = matrix.transformPoint(c.position);
    expect(p.x).toBeCloseTo(c.w / 2, 6);
    expect(p.y).toBeCloseTo(c.h / 2, 6);
  });

  it('a nonzero layer shift moves a point by exactly that world-space offset, scaled by zoom', () => {
    const c = CASES[0];
    const camera = cameraFor(c.position, c.zf);
    const identity = new Transform2D();
    const shifted = new Transform2D();
    const shift = { x: 300, y: -750 };
    shifted.setTranslation(shift.x, shift.y);

    const m0 = computeLayerToScreenMatrix(camera, identity, c.w, c.h);
    const m1 = computeLayerToScreenMatrix(camera, shifted, c.w, c.h);

    const p0 = m0.transformPoint({ x: 42, y: -17 });
    const p1 = m1.transformPoint({ x: 42, y: -17 });

    expect(p1.x - p0.x).toBeCloseTo(shift.x * c.zf, 6);
    expect(p1.y - p0.y).toBeCloseTo(shift.y * c.zf, 6);
  });

  it('a camera rotation rotates a point around the canvas center', () => {
    const camera = cameraFor({ x: 0, y: 0 }, 1);
    camera.rotation = Math.PI / 2;
    const layerTransform = new Transform2D();
    const matrix = computeLayerToScreenMatrix(camera, layerTransform, 800, 600);

    // The matrix applies camera.worldMatrix.invert(), i.e. rotation(-camera.rotation) here — a
    // world point straight "east" of the origin (100, 0) therefore lands straight "up" from the
    // canvas center (matches MapWidget.rotateBy's own doc comment: increasing `rotation` turns
    // the displayed content counter-clockwise, not clockwise).
    const p = matrix.transformPoint({ x: 100, y: 0 });
    expect(p.x).toBeCloseTo(400, 6);
    expect(p.y).toBeCloseTo(200, 6);
  });
});

// ROT-7 (BACKLOG.md, reopened ROT-3): the buffered-rotation redesign's core math — see
// computeUnrotatedLayerToScreenMatrix/computeBufferBlitMatrix's own doc comments in map.ts for the
// full derivation. The identity checked below (real rotated matrix == blit ∘ unrotated matrix) is
// what the whole approach hinges on; if this ever fails, ROT-8/9/10's buffer compositing is
// drawing the wrong thing.
const ROTATIONS = [0, Math.PI / 6, -Math.PI / 4, 2.3, -1.1, Math.PI];

describe('computeUnrotatedLayerToScreenMatrix (ROT-7)', () => {
  it.each(CASES)('matches computeLayerToScreenMatrix when camera.rotation is already 0: $label', (c) => {
    const camera = cameraFor(c.position, c.zf);
    const layerTransform = new Transform2D();

    const rotated = computeLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
    const unrotated = computeUnrotatedLayerToScreenMatrix(camera, layerTransform, c.w, c.h);

    expect(unrotated.equals(rotated)).toBe(true);
  });

  it('ignores camera.rotation entirely — same output at 0 and at a large nonzero angle', () => {
    const c = CASES[1];
    const camera = cameraFor(c.position, c.zf);
    const layerTransform = new Transform2D();

    const atZero = computeUnrotatedLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
    camera.rotation = 2.7;
    const atNonzero = computeUnrotatedLayerToScreenMatrix(camera, layerTransform, c.w, c.h);

    expect(atNonzero.equals(atZero)).toBe(true);
  });

  it('still honors a nonzero layer transform (shift/scale), independent of camera rotation', () => {
    const c = CASES[0];
    const camera = cameraFor(c.position, c.zf);
    camera.rotation = 1.2;
    const layerTransform = new Transform2D();
    layerTransform.setTranslation(500, -250);
    layerTransform.setScale(3);

    const matrix = computeUnrotatedLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
    const p = matrix.transformPoint({ x: 0, y: 0 });
    // The layer-local origin, after the layer's own shift, lands at world (500, -250) — mapped to
    // screen the same way any other world point would be, MINUS the camera's rotation (forced 0
    // here) but still through its position/zoom.
    const expected = computeLayerToScreenMatrix(cameraFor(c.position, c.zf), layerTransform, c.w, c.h)
      .transformPoint({ x: 0, y: 0 });
    expect(p.x).toBeCloseTo(expected.x, 6);
    expect(p.y).toBeCloseTo(expected.y, 6);
  });
});

describe('computeBufferBlitMatrix (ROT-7)', () => {
  it('is the identity when rotation is 0 and from/to centers match', () => {
    const m = computeBufferBlitMatrix(0, 400, 300, 400, 300);
    expect(m.equals(Mat2D.identity())).toBe(true);
  });

  it('translates by (to - from) when rotation is 0 and the centers differ', () => {
    const m = computeBufferBlitMatrix(0, 720, 720, 400, 300);
    const p = m.transformPoint({ x: 100, y: 50 });
    expect(p.x).toBeCloseTo(100 - 720 + 400, 9);
    expect(p.y).toBeCloseTo(50 - 720 + 300, 9);
  });

  // The core identity this whole ticket series hinges on (see the doc comment on
  // computeBufferBlitMatrix in map.ts): rendering "as if rotation were 0" into a buffer, then
  // rotating the WHOLE buffer image once around its own center onto the screen, must land every
  // point exactly where the ordinary rotated per-frame matrix would — for the buffer's own size
  // (matching the real canvas, i.e. same from/to center) AND for a differently-sized buffer (the
  // actual diag x diag case BufferedLayer uses).
  it.each(CASES)('blit(rotation, w/2,h/2, w/2,h/2) ∘ unrotated == the real rotated matrix, same size: $label', (c) => {
    for (const rotation of ROTATIONS) {
      const camera = cameraFor(c.position, c.zf);
      camera.rotation = rotation;
      const layerTransform = new Transform2D();

      const rotatedMatrix = computeLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
      const unrotated = computeUnrotatedLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
      const blit = computeBufferBlitMatrix(rotation, c.w / 2, c.h / 2, c.w / 2, c.h / 2);
      const reconstructed = blit.multiply(unrotated);

      expect(reconstructed.equals(rotatedMatrix, 1e-6)).toBe(true);
    }
  });

  it.each(CASES)('same identity through a differently-sized (diag) buffer, as BufferedLayer actually uses it: $label', (c) => {
    const diag = computeBufferDiag(c.w, c.h);
    for (const rotation of ROTATIONS) {
      const camera = cameraFor(c.position, c.zf);
      camera.rotation = rotation;
      const layerTransform = new Transform2D();

      const rotatedMatrix = computeLayerToScreenMatrix(camera, layerTransform, c.w, c.h);
      const unrotatedBuffer = computeUnrotatedLayerToScreenMatrix(camera, layerTransform, diag, diag);
      const blit = computeBufferBlitMatrix(rotation, diag / 2, diag / 2, c.w / 2, c.h / 2);
      const reconstructed = blit.multiply(unrotatedBuffer);

      expect(reconstructed.equals(rotatedMatrix, 1e-5)).toBe(true);
    }
  });

  it.each(CASES)('holds for computeTileGridMatrix / computeUnrotatedTileGridMatrix too (world_tile_edge folded in): $label', (c) => {
    const diag = computeBufferDiag(c.w, c.h);
    const z = Math.ceil(Math.log2(c.zf));
    const world_tile_edge = c.tileSizeNative / Math.pow(2, z);
    const rotation = Math.PI / 5;

    const camera = cameraFor(c.position, c.zf);
    camera.rotation = rotation;
    const layerTransform = new Transform2D();

    const rotatedTileMatrix = computeTileGridMatrix(camera, layerTransform, c.w, c.h, world_tile_edge);
    const unrotatedTileMatrix = computeUnrotatedTileGridMatrix(camera, layerTransform, diag, diag, world_tile_edge);
    const blit = computeBufferBlitMatrix(rotation, diag / 2, diag / 2, c.w / 2, c.h / 2);

    expect(blit.multiply(unrotatedTileMatrix).equals(rotatedTileMatrix, 1e-5)).toBe(true);
  });
});

describe('computeBufferDiag (ROT-8)', () => {
  it('is at least the canvas diagonal (the whole point — a diag x diag square must cover the canvas at any rotation)', () => {
    const cases: Array<[number, number]> = [[1280, 720], [100, 100], [1, 1000], [1999, 3]];
    for (const [w, h] of cases) {
      const diag = computeBufferDiag(w, h);
      expect(diag).toBeGreaterThanOrEqual(Math.sqrt(w * w + h * h));
    }
  });

  it('rounds up to a multiple of the granularity, exactly (30-40-50 triangle)', () => {
    // sqrt(30^2 + 40^2) = 50 exactly, so with granularity 25 this should round to exactly 50 —
    // no extra slack, a precise check that the rounding math itself is right, not just "big enough".
    expect(computeBufferDiag(30, 40, 25)).toBe(50);
  });

  it('defaults to DEFAULT_BUFFER_SIZE_GRANULARITY when no granularity is given', () => {
    const withDefault = computeBufferDiag(1280, 720);
    const explicit = computeBufferDiag(1280, 720, DEFAULT_BUFFER_SIZE_GRANULARITY);
    expect(withDefault).toBe(explicit);
  });
});

// ZOOM-12: classifyWheelEvent is mapbox-gl-js's own field-tested mouse-vs-trackpad heuristic
// (see map.ts's own doc comment on it, and BACKLOG.md's ZOOM-12 entry, for the citations/design),
// extracted as a standalone pure function specifically so it can be exercised here without a live
// browser or a real MacBook trackpad (neither is available in this sandbox — see BACKLOG.md's
// ZOOM-10 note on the same limitation). Each case below is chosen to land deterministically in
// one specific branch of the heuristic (see map.ts for the branch order/constants), not just to
// eyeball a "looks about right" outcome.
describe('classifyWheelEvent (ZOOM-12)', () => {
  const fresh = (): WheelClassifyState => ({ type: null });

  it('a single, isolated mouse-wheel-notch-sized deltaY classifies as wheel, regardless of timing', () => {
    // 25 * 4.000244140625 — an exact multiple of the "one notch" modulus mapbox measured, and (at
    // ~100) the same magnitude a real physical mouse wheel notch reports in Chrome/Firefox/Safari
    // (see WHEEL_DELTA_PER_STEP's own comment in map.ts, ZOOM-9/ZOOM-10).
    const value = 25 * 4.000244140625;
    // A huge, and then a tiny, gap since the "previous" event — the notch-modulus check is
    // checked first and doesn't care about timing at all, so both must agree.
    for (const timeDelta of [100000, 5]) {
      const result = classifyWheelEvent(value, 0 /* DOM_DELTA_PIXEL */, timeDelta, 0, fresh());
      expect(result.type).toBe('wheel');
      expect(result.state.type).toBe('wheel');
      expect(result.startGraceTimer).toBe(false);
    }
  });

  it('a single small deltaY classifies as trackpad immediately, even as the very first event of a gesture', () => {
    // |value| < 4 is checked before the "new gesture" (400ms gap) branch, so this doesn't need a
    // fast follow-up to be classified — trackpad noise is simply too small to ever be a wheel notch.
    const result = classifyWheelEvent(3, 0, 5000, 0, fresh());
    expect(result.type).toBe('trackpad');
    expect(result.startGraceTimer).toBe(false);
  });

  it('a rapid stream of small (2-6px) deltaY events classifies as trackpad throughout', () => {
    const stream = [
      { deltaY: 3, t: 0 },
      { deltaY: 4, t: 16 },
      { deltaY: 5, t: 32 },
      { deltaY: -2, t: 48 },
      { deltaY: 6, t: 64 }
    ];
    let state = fresh();
    let lastTime = -10000; // far enough in the past that the first event's own branch doesn't
    // depend on it (deltaY=3 is caught by the |value|<4 check regardless of timing).
    for (const { deltaY, t } of stream) {
      const result = classifyWheelEvent(deltaY, 0, t, lastTime, state);
      expect(result.type).toBe('trackpad');
      state = result.state;
      lastTime = t;
    }
  });

  it('a ctrlKey:true stream never reaches this classifier at all — it goes straight to pinch-zoom', () => {
    // Structural, not behavioral: classifyWheelEvent takes no ctrlKey parameter at all — the
    // `wheel` listener in map.ts checks `e.ctrlKey || e.metaKey` and calls `_wheelZoom` directly
    // *before* ever calling this function (see its own source) — verified by inspection here
    // rather than duplicated as a runtime assertion the function itself can't make.
    expect(classifyWheelEvent.length).toBe(5); // (deltaY, deltaMode, now, lastTime, state) — no ctrlKey slot
  });

  it('a new gesture (>400ms gap) with an ambiguous magnitude is undecided and requests a grace timer', () => {
    // 50 is neither an exact notch multiple nor below the definitely-trackpad threshold.
    const result = classifyWheelEvent(50, 0, 100000, 0, fresh());
    expect(result.type).toBeNull();
    expect(result.state.type).toBeNull();
    expect(result.startGraceTimer).toBe(true);
  });

  it('once undecided, a fast, small-magnitude-per-ms follow-up resolves to trackpad', () => {
    const undecided = classifyWheelEvent(50, 0, 100000, 0, fresh()).state; // {type: null}
    // |20ms * 6| = 120 < 200 (WHEEL_TRACKPAD_TIME_DELTA_THRESHOLD).
    const result = classifyWheelEvent(6, 0, 100020, 100000, undecided);
    expect(result.type).toBe('trackpad');
  });

  it('once undecided, a fast, large-magnitude-per-ms follow-up resolves to wheel', () => {
    const undecided = classifyWheelEvent(50, 0, 100000, 0, fresh()).state; // {type: null}
    // |20ms * 50| = 1000, not < 200 — this reads as a (fast, repeated) wheel, not trackpad.
    const result = classifyWheelEvent(50, 0, 100020, 100000, undecided);
    expect(result.type).toBe('wheel');
  });

  it('DOM_DELTA_LINE (deltaMode=1) normalizes deltaY*40, matching the equivalent raw-pixel value', () => {
    // 3 lines * 40 == 120 raw pixels — both must classify identically given the same timing/state.
    const viaLine = classifyWheelEvent(3, 1 /* DOM_DELTA_LINE */, 10, 0, fresh());
    const viaPixel = classifyWheelEvent(120, 0 /* DOM_DELTA_PIXEL */, 10, 0, fresh());
    expect(viaLine.type).toBe(viaPixel.type);
    expect(viaLine.type).toBe('wheel'); // |10ms * 120| = 1200, not < 200 — resolves to wheel
  });
});

// ZOOM-13: isTap/isDoubleTapContinuation/hasCrossedActivationThreshold are the pure timing-and-
// distance predicates pulled out of the touchstart/touchmove/touchend handlers — see map.ts's own
// doc comment on them (and BACKLOG.md's ZOOM-13 entry) for why only these, and not the rest of the
// gesture's state machine, are extracted this way. Boundary values below are chosen right at each
// constant's own threshold (see map.ts: TAP_MAX_DURATION_MS=250, TAP_MAX_MOVEMENT_PX=10,
// DOUBLE_TAP_MAX_INTERVAL_MS=300, DOUBLE_TAP_MAX_DISTANCE_PX=40, ZOOM_ROTATE_ACTIVATION_PX=10) to
// pin down the exact <= / > cutoffs, not just "clearly inside" / "clearly outside" cases.
describe('isTap (ZOOM-13)', () => {
  it('a short, still touch is a tap', () => {
    expect(isTap(100, 2)).toBe(true);
  });

  it('exactly at the duration/movement limits still counts as a tap (<=, not <)', () => {
    expect(isTap(250, 10)).toBe(true);
  });

  it('a touch held a moment too long is not a tap', () => {
    expect(isTap(251, 0)).toBe(false);
  });

  it('a touch that moved a hair too far is not a tap', () => {
    expect(isTap(0, 10.0001)).toBe(false);
  });
});

describe('isDoubleTapContinuation (ZOOM-13)', () => {
  it('no pending tap at all is never a continuation', () => {
    expect(isDoubleTapContinuation(null, 1000, { x: 0, y: 0 })).toBe(false);
  });

  it('a second tap soon after and close to the first is a continuation', () => {
    const pending: PendingTap = { time: 1000, pos: { x: 100, y: 100 } };
    expect(isDoubleTapContinuation(pending, 1200, { x: 110, y: 105 })).toBe(true);
  });

  it('exactly at the interval/distance limits still counts (<=, not <)', () => {
    const pending: PendingTap = { time: 1000, pos: { x: 0, y: 0 } };
    // elapsed = 300 (== DOUBLE_TAP_MAX_INTERVAL_MS), distance = 40 (== DOUBLE_TAP_MAX_DISTANCE_PX).
    expect(isDoubleTapContinuation(pending, 1300, { x: 40, y: 0 })).toBe(true);
  });

  it('a second tap too long after the first is not a continuation, even right on top of it', () => {
    const pending: PendingTap = { time: 1000, pos: { x: 50, y: 50 } };
    expect(isDoubleTapContinuation(pending, 1301, { x: 50, y: 50 })).toBe(false);
  });

  it('a second tap too far from the first is not a continuation, even immediately after', () => {
    const pending: PendingTap = { time: 1000, pos: { x: 0, y: 0 } };
    expect(isDoubleTapContinuation(pending, 1001, { x: 40.0001, y: 0 })).toBe(false);
  });
});

describe('hasCrossedActivationThreshold (ZOOM-13)', () => {
  it('no movement has not crossed', () => {
    expect(hasCrossedActivationThreshold({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it('movement right at the threshold has not crossed yet (>, not >=)', () => {
    expect(hasCrossedActivationThreshold({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(false);
  });

  it('movement a hair past the threshold has crossed', () => {
    expect(hasCrossedActivationThreshold({ x: 0, y: 0 }, { x: 10.0001, y: 0 })).toBe(true);
  });

  it('diagonal movement is measured as straight-line distance, not per-axis', () => {
    // 6-8-10 triangle: exactly 10px away diagonally, same boundary as the straight case above.
    expect(hasCrossedActivationThreshold({ x: 0, y: 0 }, { x: 6, y: 8 })).toBe(false);
    expect(hasCrossedActivationThreshold({ x: 0, y: 0 }, { x: 6.001, y: 8 })).toBe(true);
  });
});

// LAYER-6: Layer.kind (metadata), TiledLayerOptions.zLevelMin/zLevelMax (real clamping of the
// computed level) and TiledLayerOptions.bounds (real exclusion of out-of-bounds tile indices from
// the draw loop) — all optional and backward-compatible; a layer that sets none of them must
// behave exactly as before (see the regression cases below).

// ROT-9: a no-op 2D-context stand-in — used both as `fakeMap`'s own `map.ctx` (BufferedLayer.draw()
// unconditionally blits the buffer onto it every frame, regardless of whether the buffer has any
// real content — see its own doc comment) and, via fakeCanvas() below, as a TiledLayer's offscreen
// buffer context. Plain no-ops are enough: none of the tests below inspect draw *calls*, only
// which tile indices tile_source.get() was asked for (see trackingSource()).
function fakeCtx(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    drawImage: () => {},
    clearRect: () => {}
  } as unknown as CanvasRenderingContext2D;
}

// ROT-9: DOM-free stand-in for the offscreen buffer canvas BufferedLayer normally creates via
// `document.createElement('canvas')` — this vitest suite runs under plain Node, not jsdom, so
// there's no live `document` to call. Passed in as TiledLayerOptions.createBufferCanvas by the
// tests below that actually call `.draw()` (the getLevelParams-only tests above never touch a
// canvas at all, so they don't need this).
function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => fakeCtx()
  } as unknown as HTMLCanvasElement;
}

// Minimal MapWidget stand-in for getLevelParams()/draw(): both only ever touch zoom_factor,
// camera and canvas.width/height (draw() also touches ctx — see fakeCtx()'s own comment — plus,
// since ROT-9, `c`/`rotation` too, via BufferedLayer.draw()'s own rebuild-check/blit).
function fakeMap(position: XY, zf: number, width: number, height: number): MapWidget {
  const camera = new Transform2D();
  camera.setTranslation(position.x, position.y);
  camera.setScale(1 / zf);
  return {
    camera,
    c: { x: position.x, y: position.y },
    rotation: 0,
    zoom_factor: zf,
    canvas: { width, height },
    ctx: fakeCtx()
  } as unknown as MapWidget;
}

describe('TiledLayer.getLevelParams — zLevelMin/zLevelMax clamping (LAYER-6)', () => {
  it('leaves the computed level untouched when neither bound is set (regression)', () => {
    const layer = new TiledLayer({ tile_size: 256, z_max: 3 });
    const map = fakeMap({ x: 0, y: 0 }, 1024, 100, 100); // zoom_factor=2^10 -> z=10
    const params = layer.getLevelParams(map, 100, 100);
    expect(params.z).toBe(10 + 3); // unclamped: z + z_max, exactly like before this ticket
  });

  it('zLevelMin raises a computed level that falls below it', () => {
    const layer = new TiledLayer({ tile_size: 256, zLevelMin: 5 });
    const map = fakeMap({ x: 0, y: 0 }, 1, 100, 100); // zoom_factor=1 -> z=0, well under zLevelMin
    const params = layer.getLevelParams(map, 100, 100);
    expect(params.z).toBe(5);
  });

  it('zLevelMax lowers a computed level that exceeds it', () => {
    const layer = new TiledLayer({ tile_size: 256, zLevelMax: 6 });
    const map = fakeMap({ x: 0, y: 0 }, 1024, 100, 100); // zoom_factor=2^10 -> z=10, well over zLevelMax
    const params = layer.getLevelParams(map, 100, 100);
    expect(params.z).toBe(6);
  });

  it('clamps AFTER the existing z_max offset is applied, without changing z_max itself', () => {
    const layer = new TiledLayer({ tile_size: 256, z_max: 2, zLevelMax: 11 });
    const map = fakeMap({ x: 0, y: 0 }, 1024, 100, 100); // z=10, +z_max(2) = 12, clamp to 11
    const params = layer.getLevelParams(map, 100, 100);
    expect(params.z).toBe(11);
  });

  it("doesn't clamp a level already within [zLevelMin, zLevelMax]", () => {
    const layer = new TiledLayer({ tile_size: 256, zLevelMin: 5, zLevelMax: 15 });
    const map = fakeMap({ x: 0, y: 0 }, 1024, 100, 100); // z=10, well inside [5,15]
    const params = layer.getLevelParams(map, 100, 100);
    expect(params.z).toBe(10);
  });
});

describe('computeTileIndexBounds (LAYER-6)', () => {
  it('converts a world-space rect into tile-index space via world_tile_edge, for an identity layer transform', () => {
    const identity = new Transform2D();
    const bounds = computeTileIndexBounds(identity, 100, { minX: 0, minY: 0, maxX: 300, maxY: 500 });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 5 });
  });

  it('accounts for a nonzero layer shift, the same way computeTileGridMatrix does for tile placement', () => {
    const shifted = new Transform2D();
    shifted.setTranslation(100, 100);
    // world bounds [100,400) — shift by (100,100) — should land at index [0,3) once shift is undone.
    const bounds = computeTileIndexBounds(shifted, 100, { minX: 100, minY: 100, maxX: 400, maxY: 400 });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 });
  });
});

describe('TiledLayer.draw — bounds excludes out-of-bounds tile indices (LAYER-6)', () => {
  // world_tile_edge works out to exactly `tile_size` here (zoom_factor=1 -> z=0 -> k=1, and
  // world_tile_edge = tile_size / 2^z = tile_size), so bounds in world units divide cleanly into
  // tile-index bounds — see computeTileIndexBounds's own tests above for the general case.
  const TILE_SIZE = 100;

  function trackingSource(): { source: TileSource; calls: Array<[number, number]> } {
    const calls: Array<[number, number]> = [];
    const source = new TileSource({
      tile_size: TILE_SIZE,
      onGet: (x, y) => { calls.push([x, y]); return null; } // no image -> drawContent's image draw never fires (onTileDraw/the buffer blit still run, against fakeCtx()'s no-ops)
    });
    return { source, calls };
  }

  it('never requests a tile whose index square falls entirely outside `bounds`', () => {
    const { source, calls } = trackingSource();
    const layer = new TiledLayer({
      tile_source: source,
      tile_size: TILE_SIZE,
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 }, // tile-index [0,3) x [0,3)
      createBufferCanvas: fakeCanvas // ROT-9: draw() now always builds/blits an offscreen buffer
    });
    // A big canvas relative to the tile size, centered inside `bounds`, so the ordinary visible
    // range comfortably extends past [0,3) x [0,3) in every direction — otherwise this test would
    // pass vacuously (nothing out-of-bounds was ever a candidate in the first place).
    const map = fakeMap({ x: 150, y: 150 }, 1, 1000, 1000);

    layer.draw(map);

    expect(calls.length).toBeGreaterThan(0);
    for (const [x, y] of calls) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(3);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(3);
    }
    // Every in-bounds index should actually have been requested (nothing over-excluded either).
    const seen = new Set(calls.map(([x, y]) => `${x}:${y}`));
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        expect(seen.has(`${x}:${y}`)).toBe(true);
      }
    }
  });

  it('requests every visible tile, in and out of what would be `bounds`, when `bounds` is unset (regression)', () => {
    const { source, calls } = trackingSource();
    const layer = new TiledLayer({ tile_source: source, tile_size: TILE_SIZE, createBufferCanvas: fakeCanvas }); // no bounds
    const map = fakeMap({ x: 150, y: 150 }, 1, 1000, 1000);

    layer.draw(map);

    const params = layer.getLevelParams(map, 1000, 1000);
    expect(calls.length).toBe((2 * params.dx + 1) * (2 * params.dy + 1));
    // Confirms the visible range genuinely reaches outside [0,3) x [0,3) — same range as the
    // bounded test above — so that test's exclusions are real, not vacuous.
    expect(calls.some(([x, y]) => x < 0 || x >= 3 || y < 0 || y >= 3)).toBe(true);
  });
});

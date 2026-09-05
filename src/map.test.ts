import { describe, expect, it } from 'vitest';
import { Transform2D } from './transform2d.js';
import {
  classifyWheelEvent,
  computeTileGridMatrix,
  hasCrossedActivationThreshold,
  isDoubleTapContinuation,
  isTap,
  type PendingTap,
  type WheelClassifyState
} from './map.js';

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

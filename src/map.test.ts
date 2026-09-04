import { describe, expect, it } from 'vitest';
import { Transform2D } from './transform2d.js';
import { computeTileGridMatrix } from './map.js';

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

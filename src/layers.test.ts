import { describe, expect, it } from 'vitest';
import {
  mandelbrotTileRect,
  mandelbrotEscapeIterations,
  subdomain,
  MANDELBROT_RE_MIN,
  MANDELBROT_RE_MAX,
  MANDELBROT_IM_MIN,
  MANDELBROT_IM_MAX,
  MANDELBROT_BASE_Z
} from './layers.js';

describe('subdomain (DEMO-2 {s} rotation)', () => {
  it('always returns one of the three configured letters, never undefined', () => {
    // Real regression this catches: JS's `%` is a remainder, not a modulo, so a naive
    // `(x + y) % 3` goes negative for negative tile indices (e.g. -1 % 3 === -1) and indexes the
    // subdomain array with -1 — silently producing `undefined`, which then gets baked into a
    // request URL as the literal hostname "undefined.tile-...". Found via Playwright against a
    // real tile server, not by inspection.
    for (let x = -10; x <= 10; x++) {
      for (let y = -10; y <= 10; y++) {
        expect(['a', 'b', 'c']).toContain(subdomain(x, y));
      }
    }
  });

  it('is deterministic for a given tile index (repeated requests hit the same subdomain)', () => {
    expect(subdomain(5, -3)).toBe(subdomain(5, -3));
  });
});

describe('mandelbrotTileRect (DEMO-4)', () => {
  it('tile (0,0) at the base zoom covers exactly the configured base view', () => {
    const rect = mandelbrotTileRect(0, 0, MANDELBROT_BASE_Z);
    expect(rect.reMin).toBeCloseTo(MANDELBROT_RE_MIN, 12);
    expect(rect.reMax).toBeCloseTo(MANDELBROT_RE_MAX, 12);
    expect(rect.imMin).toBeCloseTo(MANDELBROT_IM_MIN, 12);
    expect(rect.imMax).toBeCloseTo(MANDELBROT_IM_MAX, 12);
  });

  it('one zoom level in quarters the base view into 4 tiles that exactly tile it back together', () => {
    // z = base+1 -> 2x2 tiles. Halving in each axis per zoom level, same relationship a real
    // slippy-map tile's lon/lat rectangle has to its x/y/z.
    const z = MANDELBROT_BASE_Z + 1;
    const topLeft = mandelbrotTileRect(0, 0, z);
    const topRight = mandelbrotTileRect(1, 0, z);
    const bottomLeft = mandelbrotTileRect(0, 1, z);
    const bottomRight = mandelbrotTileRect(1, 1, z);

    const fullWidth = MANDELBROT_RE_MAX - MANDELBROT_RE_MIN;
    const fullHeight = MANDELBROT_IM_MAX - MANDELBROT_IM_MIN;
    expect(topLeft.reMax - topLeft.reMin).toBeCloseTo(fullWidth / 2, 12);
    expect(topLeft.imMax - topLeft.imMin).toBeCloseTo(fullHeight / 2, 12);

    // Top-left tile: leftmost/topmost quadrant (y increases downward -> decreasing imaginary,
    // same convention TiledLayer uses everywhere else).
    expect(topLeft.reMin).toBeCloseTo(MANDELBROT_RE_MIN, 12);
    expect(topLeft.imMax).toBeCloseTo(MANDELBROT_IM_MAX, 12);

    // Adjacent tiles share exact boundaries — no gap, no overlap.
    expect(topRight.reMin).toBeCloseTo(topLeft.reMax, 12);
    expect(bottomLeft.imMax).toBeCloseTo(topLeft.imMin, 12);
    expect(bottomRight.reMin).toBeCloseTo(topLeft.reMax, 12);
    expect(bottomRight.imMax).toBeCloseTo(topLeft.imMin, 12);

    // The four quadrants' outer corners reconstruct the full base view.
    expect(topLeft.reMin).toBeCloseTo(MANDELBROT_RE_MIN, 12);
    expect(topRight.reMax).toBeCloseTo(MANDELBROT_RE_MAX, 12);
    expect(bottomLeft.imMin).toBeCloseTo(MANDELBROT_IM_MIN, 12);
    expect(topLeft.imMax).toBeCloseTo(MANDELBROT_IM_MAX, 12);
  });

  it('deeper zoom halves the rectangle again, unlike a fixed-depth data source', () => {
    const z1 = mandelbrotTileRect(0, 0, MANDELBROT_BASE_Z + 1);
    const z2 = mandelbrotTileRect(0, 0, MANDELBROT_BASE_Z + 2);
    expect(z2.reMax - z2.reMin).toBeCloseTo((z1.reMax - z1.reMin) / 2, 12);
    expect(z2.imMax - z2.imMin).toBeCloseTo((z1.imMax - z1.imMin) / 2, 12);
  });
});

describe('mandelbrotEscapeIterations (DEMO-4)', () => {
  it('the origin (0,0) never escapes — it is the deepest point inside the set', () => {
    expect(mandelbrotEscapeIterations(0, 0, 200)).toBe(200);
  });

  it('a point far outside |c|>2 escapes almost immediately', () => {
    const iter = mandelbrotEscapeIterations(5, 5, 200);
    expect(iter).toBeLessThan(5);
  });

  it('a known exterior point (c=1) escapes well before maxIter', () => {
    // z0=0, z1=1, z2=2, z3=5 -> |z3|>2 by the 3rd iteration.
    const iter = mandelbrotEscapeIterations(1, 0, 200);
    expect(iter).toBeGreaterThan(0);
    expect(iter).toBeLessThan(200);
  });

  it('is monotonically capped at maxIter and never exceeds it', () => {
    expect(mandelbrotEscapeIterations(-0.5, 0, 50)).toBeLessThanOrEqual(50);
    expect(mandelbrotEscapeIterations(0.3, 0.3, 10)).toBeLessThanOrEqual(10);
  });
});

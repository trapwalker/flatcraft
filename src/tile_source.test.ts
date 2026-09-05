import { describe, expect, it } from 'vitest';
import { Tile, TileSource, TSCache, XYZTileSource, TMSTileSource, DownsampledTileSource } from './tile_source.js';

function countingSource(onGet: (x: number, y: number, z: number) => Tile | null | undefined) {
  const calls: Array<[number, number, number]> = [];
  const cache = new TSCache({
    tile_size: 256,
    onGet: (x, y, z) => {
      calls.push([x, y, z]);
      return onGet(x, y, z);
    }
  });
  return { cache, calls };
}

describe('TSCache caching (LOAD-5)', () => {
  it('caches a Tile result: onGet is called once per key, not on every get()', () => {
    const { cache, calls } = countingSource((x, y, z) => new Tile(x, y, z));

    const first = cache.get(1, 2, 3);
    const second = cache.get(1, 2, 3);

    expect(calls).toHaveLength(1);
    expect(second).toBe(first); // same cached instance, not a fresh one
  });

  it('caches an explicit null result too — a "no tile here" answer is remembered', () => {
    const { cache, calls } = countingSource(() => null);

    cache.get(1, 2, 3);
    cache.get(1, 2, 3);

    expect(calls).toHaveLength(1);
    expect(cache.get(1, 2, 3)).toBeNull();
  });

  it('does NOT cache undefined — every call keeps retrying instead of getting stuck', () => {
    const { cache, calls } = countingSource(() => undefined);

    cache.get(1, 2, 3);
    cache.get(1, 2, 3);
    cache.get(1, 2, 3);

    expect(calls).toHaveLength(3);
  });

  it('cache_size reflects the number of distinct cached keys', () => {
    const { cache } = countingSource((x, y, z) => new Tile(x, y, z));

    cache.get(0, 0, 0);
    cache.get(1, 0, 0);
    cache.get(1, 0, 0); // repeat — shouldn't add a new entry
    cache.get(2, 0, 0);

    expect(cache.cache_size).toBe(3);
  });

  it('evicts the least-recently-used entry once cache_limit is exceeded', () => {
    const { cache, calls } = countingSource((x, y, z) => new Tile(x, y, z));
    cache.cache_limit = 3;

    cache.get(1, 0, 0); // oldest
    cache.get(2, 0, 0);
    cache.get(3, 0, 0);
    expect(cache.cache_size).toBe(3);

    cache.get(4, 0, 0); // pushes size to 4 -> evicts (1,0,0)
    expect(cache.cache_size).toBe(3);

    calls.length = 0;
    cache.get(1, 0, 0); // was evicted — must re-fetch
    expect(calls).toEqual([[1, 0, 0]]);
  });

  it('reading an entry refreshes its recency, protecting it from eviction', () => {
    const { cache, calls } = countingSource((x, y, z) => new Tile(x, y, z));
    cache.cache_limit = 3;

    cache.get(1, 0, 0);
    cache.get(2, 0, 0);
    cache.get(3, 0, 0);
    cache.get(1, 0, 0); // touch (1,0,0) again — (2,0,0) is now the least-recently-used

    cache.get(4, 0, 0); // pushes size to 4 -> should evict (2,0,0), not (1,0,0)

    calls.length = 0;
    cache.get(1, 0, 0);
    cache.get(2, 0, 0);
    expect(calls).toEqual([[2, 0, 0]]); // only the evicted one needed re-fetching
  });
});

describe('TSCache.heat() (LOAD-1 preload queue)', () => {
  it('queues tiles at absolute coordinates near (x,y,z) — not doubled', () => {
    // Real-world symptom this catches: heat(100, 200, 18, ...) used to queue x~300/y~600/z~36
    // instead of x~100/y~200/z~18 (every coordinate got added to itself once more inside the
    // callback) -- harmless-looking off by a factor of ~2 that, against a real XYZ tile server,
    // requests a nonexistent zoom level far past any real pyramid's depth and 400s. See
    // BACKLOG.md's LOAD-1/SRC-4 notes for how this was actually found (via Playwright against a
    // real tile server, not by inspection).
    const { cache } = countingSource(() => null);
    cache.heat(100, 200, 18, 2, 4);

    expect(cache.load_queue.length).toBeGreaterThan(0);
    for (const tile of cache.load_queue) {
      expect(Math.abs(tile.x - 100)).toBeLessThanOrEqual(10);
      expect(Math.abs(tile.y - 200)).toBeLessThanOrEqual(10);
      expect(Math.abs(tile.z - 18)).toBeLessThanOrEqual(10);
    }
  });
});

// buildUrl is `protected` — a compile-time-only restriction, erased at runtime — so it's called
// here via a cast rather than through .get(), specifically to avoid needing `Image`/`document`
// (not available in vitest's default Node environment; XYZTileSource.get() itself does `new
// Image()`, so it isn't unit-tested directly here — its network-loading path is covered by the
// SRC-4/AFF-3 Playwright checks instead, against this sandbox's real tile-server responses).
describe('XYZTileSource / TMSTileSource (SRC-2) URL building', () => {
  it('XYZTileSource.buildUrl passes x/y/z straight through to the template', () => {
    const source = new XYZTileSource({
      tile_size: 256,
      urlTemplate: (x, y, z) => `https://example.test/${z}/${x}/${y}.png`
    });
    expect((source as unknown as { buildUrl: (x: number, y: number, z: number) => string }).buildUrl(5, 10, 3))
      .toBe('https://example.test/3/5/10.png');
  });

  it('TMSTileSource flips Y (origin bottom-left) before calling the template, keeping x/z as given', () => {
    const source = new TMSTileSource({
      tile_size: 256,
      urlTemplate: (x, y, z) => `https://example.test/${z}/${x}/${y}.png`
    });
    const buildUrl = (source as unknown as { buildUrl: (x: number, y: number, z: number) => string }).buildUrl.bind(source);

    // z=3 -> 8x8 grid (0..7). XYZ y=0 (top row) is TMS y=7 (top-left origin vs. bottom-left).
    expect(buildUrl(5, 0, 3)).toBe('https://example.test/3/5/7.png');
    // The bottom row in XYZ (y=7) is TMS row 0.
    expect(buildUrl(5, 7, 3)).toBe('https://example.test/3/5/0.png');
    // Round trip: flipping twice (at two different z) recovers the original y at that z.
    expect(buildUrl(2, 2, 2)).toBe('https://example.test/2/2/1.png'); // z=2 -> 4x4 grid, flip(2) = 4-1-2 = 1
  });

  it('XYZTileSource/TMSTileSource are still TSCache underneath — caching and heat() work the same', () => {
    const source = new XYZTileSource({ tile_size: 256, urlTemplate: () => 'https://example.test/x.png' });
    expect(source).toBeInstanceOf(TSCache);
    expect(typeof source.heat).toBe('function');
  });
});

// DownsampledTileSource (SRC-8) composites by drawing into a real <canvas> — not available in
// vitest's default Node environment (same constraint as XYZTileSource/Image, noted above). Rather
// than pull in a full DOM implementation (jsdom/happy-dom) just for this one class, a minimal
// in-memory stand-in for `document`/canvas is enough to exercise the actual compositing logic
// (which native sub-tiles get requested, in what index range, how many times, what gets drawn
// where) without needing real rasterization — nothing here inspects pixels, only call counts and
// argument values.
class FakeCanvasRenderingContext2D {
  drawCalls: Array<{ image: unknown; dx: number; dy: number; dw: number; dh: number }> = [];
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void {
    this.drawCalls.push({ image, dx, dy, dw, dh });
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly ctx = new FakeCanvasRenderingContext2D();
  getContext(): FakeCanvasRenderingContext2D {
    return this.ctx;
  }
}

(globalThis as unknown as { document: { createElement: (tag: string) => FakeCanvas } }).document = {
  createElement: () => new FakeCanvas()
};

// A bare, uncached TileSource (not TSCache) as the "native" source under test: get() calls
// onGet directly, every time, with no caching of its own — so call counts below reflect exactly
// what DownsampledTileSource asked for, undistorted by an intermediate cache.
function countingNativeSource(
  onGet: (x: number, y: number, z: number) => Tile | null | undefined
): { source: TileSource; calls: Array<[number, number, number]> } {
  const calls: Array<[number, number, number]> = [];
  const source = new TileSource({
    tile_size: 256,
    onGet: (x, y, z) => {
      calls.push([x, y, z]);
      return onGet(x, y, z);
    }
  });
  return { source, calls };
}

function readyTile(x: number, y: number, z: number): Tile {
  // A placeholder image value — DownsampledTileSource's compositing only ever passes this through
  // to the fake context's drawImage, never inspects it, so any non-undefined value proves the
  // point (that this exact sub-tile's image reached the right quadrant).
  return new Tile(x, y, z, { image: { marker: `${x}:${y}:${z}` } as unknown as CanvasImageSource });
}

describe('DownsampledTileSource (SRC-8) compositing', () => {
  it.each([
    [1, 2], // z0-z=1 -> reduce by 2x
    [2, 4], // z0-z=2 -> reduce by 4x
    [3, 8], // z0-z=3 -> reduce by 8x
    [4, 16] // z0-z=4 -> reduce by 16x
  ])('z0-z=%i (reduce by %ix): draws exactly n*n sub-tiles from index range x*n..x*n+n-1', (delta, n) => {
    const z0 = 10;
    const { source, calls } = countingNativeSource((x, y, z) => readyTile(x, y, z));
    const downsampled = new DownsampledTileSource({ tile_size: 512, source, z0 });

    const tile = downsampled.get(3, 5, z0 - delta);

    expect(calls).toHaveLength(n * n);
    // Every call must be at the native level z0, and its x/y must fall in the expected range.
    for (const [cx, cy, cz] of calls) {
      expect(cz).toBe(z0);
      expect(cx).toBeGreaterThanOrEqual(3 * n);
      expect(cx).toBeLessThanOrEqual(3 * n + n - 1);
      expect(cy).toBeGreaterThanOrEqual(5 * n);
      expect(cy).toBeLessThanOrEqual(5 * n + n - 1);
    }
    // Exactly one call per (x,y) pair in the range — no duplicates, none skipped.
    const seen = new Set(calls.map(([cx, cy]) => `${cx}:${cy}`));
    expect(seen.size).toBe(n * n);

    // The composite itself: one canvas, one drawImage call per sub-tile, each into its own
    // 1/n-sized quadrant (tile_size / n on a side).
    const image = (tile as Tile).image as unknown as FakeCanvas;
    const sub = 512 / n;
    expect(image.ctx.drawCalls).toHaveLength(n * n);
    for (const call of image.ctx.drawCalls) {
      expect(call.dw).toBe(sub);
      expect(call.dh).toBe(sub);
      expect(call.dx % sub).toBe(0);
      expect(call.dy % sub).toBe(0);
    }
  });

  it('z >= z0 is a transparent passthrough: returns exactly what the base source returns, no compositing', () => {
    const z0 = 10;
    const nativeTile = readyTile(7, 8, z0);
    const { source, calls } = countingNativeSource(() => nativeTile);
    const downsampled = new DownsampledTileSource({ tile_size: 512, source, z0 });

    const atNative = downsampled.get(7, 8, z0);
    const aboveNative = downsampled.get(7, 8, z0 + 3); // "finer than native" — still passthrough, per spec

    expect(atNative).toBe(nativeTile); // same instance — nothing rebuilt or rewrapped
    expect(aboveNative).toBe(nativeTile);
    expect(calls).toHaveLength(2); // one direct call per get(), no n*n sub-fetching
  });

  it('caches a built composite: does not recompute or re-fetch sub-tiles on a second get() for the same key', () => {
    const z0 = 10;
    const { source, calls } = countingNativeSource((x, y, z) => readyTile(x, y, z));
    const downsampled = new DownsampledTileSource({ tile_size: 256, source, z0 });

    const first = downsampled.get(1, 1, z0 - 2); // n=4 -> 16 sub-tile requests
    expect(calls).toHaveLength(16);

    const second = downsampled.get(1, 1, z0 - 2);
    expect(calls).toHaveLength(16); // unchanged — served from TSCache.storage, base source untouched
    expect(second).toBe(first); // same cached Tile instance
  });

  it('an async/pending sub-tile defers the whole composite: returns undefined and does not cache', () => {
    const z0 = 10;
    let ready = false;
    // Mimics XYZTileSource: get() always returns a Tile immediately, but it only carries `image`
    // once "loaded" — before that it's the 'prepare' state DownsampledTileSource must recognize as
    // not-yet-final.
    const { source, calls } = countingNativeSource((x, y, z) =>
      ready ? readyTile(x, y, z) : new Tile(x, y, z, { state: 'prepare' })
    );
    const downsampled = new DownsampledTileSource({ tile_size: 256, source, z0 });

    const whilePending = downsampled.get(0, 0, z0 - 1); // n=2 -> 4 sub-tiles, none ready yet
    expect(whilePending).toBeUndefined();
    expect(downsampled.cache_size).toBe(0); // undefined must never be cached (see TSCache.get())

    ready = true;
    calls.length = 0;
    const onceReady = downsampled.get(0, 0, z0 - 1); // retried — same source, now returns real images
    expect(onceReady).not.toBeUndefined();
    expect(onceReady).not.toBeNull();
    expect(calls).toHaveLength(4); // re-asked all 4 sub-tiles — cheap, no caching was skipped for real
    expect(downsampled.cache_size).toBe(1); // now cached, since this answer was final
  });

  it('a confirmed load error on a sub-tile is treated as final (blank quadrant), not pending', () => {
    const z0 = 10;
    const { source } = countingNativeSource((x, y, z) =>
      x === 0 && y === 0 ? new Tile(x, y, z, { state: 'error' }) : readyTile(x, y, z)
    );
    const downsampled = new DownsampledTileSource({ tile_size: 256, source, z0 });

    const tile = downsampled.get(0, 0, z0 - 1); // n=2 -> one of 4 sub-tiles permanently errored

    expect(tile).not.toBeUndefined(); // the error doesn't block the other 3 quadrants forever
    const image = (tile as Tile).image as unknown as FakeCanvas;
    expect(image.ctx.drawCalls).toHaveLength(3); // only the 3 non-errored quadrants got drawn
  });

  it('all sub-tiles reporting "no data" composites to a cached null, not an empty canvas', () => {
    const z0 = 10;
    const { source } = countingNativeSource(() => null);
    const downsampled = new DownsampledTileSource({ tile_size: 256, source, z0 });

    expect(downsampled.get(0, 0, z0 - 2)).toBeNull();
    expect(downsampled.cache_size).toBe(1); // a definitive "no data" answer, cached like any other null
  });
});

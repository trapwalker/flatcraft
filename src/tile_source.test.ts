import { describe, expect, it } from 'vitest';
import { Tile, TSCache, XYZTileSource, TMSTileSource } from './tile_source.js';

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

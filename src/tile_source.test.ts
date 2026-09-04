import { describe, expect, it } from 'vitest';
import { Tile, TSCache } from './tile_source.js';

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

import { heat } from './tile_tree.js';

/// TileSource ////////////////////////////////////////////////////////////////////////////////////
export interface TileSourceOptions {
  name?: string;
  onGet?: (this: TileSource, x: number, y: number, z: number) => Tile | null | undefined;
  tile_size: number;
  // LOAD-5: only meaningful for TSCache — how many entries `storage` holds before the
  // least-recently-used one is evicted. No universally "right" number (depends on tile
  // dimensions and how much the user pans around), so it's per-instance rather than one global
  // constant; DEFAULT_CACHE_LIMIT below is just a reasonable default, not a tuned value.
  cache_limit?: number;
}

export class TileSource {
  name?: string;
  onGet?: (this: TileSource, x: number, y: number, z: number) => Tile | null | undefined;
  tile_size: number;
  options: TileSourceOptions;

  constructor(options: TileSourceOptions) {
    this.name = options && options.name;
    this.onGet = options && options.onGet;
    this.tile_size = options.tile_size;
    this.options = options;
  }

  get(x: number, y: number, z: number): Tile | null | undefined {
    if (this.onGet) {
      return this.onGet(x, y, z);
    }
    return undefined;
  }
}

/// TSCache ///////////////////////////////////////////////////////////////////////////////////////
interface QueuedTile {
  x: number;
  y: number;
  z: number;
}

// LOAD-5: `storage` used to grow without limit for the lifetime of the page (flagged as a known
// gap in tile_tree.ts's old comments and in BACKLOG.md's audit). Generous enough that normal
// panning/zooming rarely evicts anything actually still in view, but bounded.
const DEFAULT_CACHE_LIMIT = 2000;

export class TSCache extends TileSource {
  cache_limit: number;
  // A Map (not a plain object) specifically for its iteration-order-is-insertion-order
  // guarantee: re-inserting a key (delete + set) on every read moves it to the end, so the
  // first key is always the least-recently-used one — an LRU cache with no extra bookkeeping.
  storage: Map<string, Tile | null>;
  load_queue: QueuedTile[];
  private _last_heating_state: string | null;
  private onBackgroundHeat: () => void;

  // LOAD-8 (debug-overlay stats): cumulative, session-lifetime counters — unlike
  // loaded_count/error_count/loading_count below (which scan `storage` and so only ever describe
  // what's cached *right now*), these track totals across the whole page lifetime, surviving LRU
  // eviction. Deliberately plain incrementing counters (not derived) since the events they count
  // (a cache miss, a cache hit, a successful load, a prefetch candidate queued) aren't otherwise
  // recoverable after the fact once older entries fall out of `storage`.
  requested_count = 0; // get() calls that missed the cache and asked the underlying source for a tile
  cache_hit_count = 0; // get() calls served straight from `storage`, no request to the source
  received_count = 0; // tiles that finished loading successfully (see XYZTileSource.fetchTile)
  prefetch_queued_count = 0; // tiles pushed onto load_queue by heat() (background-preload candidates)

  constructor(options: TileSourceOptions) {
    super(options);
    this.cache_limit = options.cache_limit || DEFAULT_CACHE_LIMIT;
    this.storage = new Map();
    this.load_queue = [];
    this._last_heating_state = null;

    this.onBackgroundHeat = () => {
      if (this.load_queue.length) {
        const tile = this.load_queue.pop() as QueuedTile;
        this.get(tile.x, tile.y, tile.z);
      }
      setTimeout(this.onBackgroundHeat, 10); // todo: extract to constant or settings
    };
    this.onBackgroundHeat(); // todo: add property 'backgroundHeatingEnable'
  }

  heat(x: number, y: number, z: number, r1?: number, r2?: number, zup?: number, zdn?: number): void {
    r1 = r1 === undefined ? 2048 / 256 / 2 : r1;
    r2 = r2 === undefined ? r1 * 2 : r2;
    // Exploring z+1/z-1 at the *same* x/y (what a nonzero zup/zdn does, via `deep` in
    // tile_tree.ts's heat()) is only meaningful for a z-independent addressing scheme (the xkcd
    // source: its onGet ignores z entirely, keying purely on x/y). For a standard XYZ/slippy
    // pyramid, each z level has its own, differently-scaled grid — the same x/y at z-1 is a
    // *different, unrelated* tile, not a lower-detail version of this one (getting there needs
    // x/2,y/2, not x,y unchanged). Defaulting to 0 (same-z only) is the behavior that's actually
    // correct for a generic tile source; a caller that knows its source is z-independent (xkcd)
    // can still opt in explicitly. Discovered via a real, reproducible bug: with the old default
    // of 1, LOAD-1's automatic preload requested nonexistent out-of-range tiles from the real OSM
    // server (e.g. z=17 with an x/y that's only valid at z=18) and got 400s for it.
    zup = zup === undefined ? 0 : zup;
    zdn = zdn === undefined ? 0 : zdn; // was `: zup` — only mattered when zup was passed without zdn
    const heating_state = [x, y, z, r1, r2, zup, zdn].toString();
    if (this._last_heating_state === heating_state) return;

    this._last_heating_state = heating_state;

    // `heat`/`ring`/`square` (tile_tree.ts) already give the callback ABSOLUTE tile
    // coordinates, not offsets from (x,y,z) — square() computes `ix = x - r` etc. itself and
    // calls back with that, and heat()'s own z-recursion (z+i+1, z-i-1, ...) is likewise
    // already absolute. Re-adding (x,y,z) here was double-counting every coordinate: this bug
    // sent LOAD-1's automatic background preload requests for roughly 2x the intended tile
    // index (e.g. x=315412 instead of 157706) and a z far past any real tile pyramid's depth
    // (e.g. 18+18=36) — which a real tile server correctly rejects with 400. Went unnoticed
    // until LOAD-1 wired heat() into the normal render loop: before that, nothing called it at
    // all (see BACKLOG.md's LOAD-1 note), so this path was simply never exercised.
    const callback = (ix: number, iy: number, iz: number): number => {
      this.prefetch_queued_count++;
      return this.load_queue.push({ x: ix, y: iy, z: iz });
    };

    this.load_queue = []; // todo: check garbage collector rules

    heat(callback, x, y, z, r1, r2, zup); // todo: use znd/zup
    // todo: autorun background heating
  }

  // Was a manually incremented-only counter; became a getter over `storage.size` once eviction
  // existed, since a counter that never decrements would drift from reality as entries are
  // evicted below.
  get cache_size(): number {
    return this.storage.size;
  }

  // Debug-overlay support: counts by outcome, computed on demand rather than tracked
  // incrementally (cheap enough at cache_limit's scale, and can't drift out of sync with
  // eviction the way a running counter could). `.image` is checked directly rather than
  // `.state === 'ready'` because StaticCanvasTileSource's tiles never set `state` at all (they're
  // ready the instant they're constructed) — a tile counts as loaded once it has an image,
  // regardless of what (if anything) set `state`.
  get loaded_count(): number {
    let count = 0;
    for (const tile of this.storage.values()) {
      if (tile && tile.image !== undefined) count++;
    }
    return count;
  }

  get error_count(): number {
    let count = 0;
    for (const tile of this.storage.values()) {
      if (tile && tile.state === 'error') count++;
    }
    return count;
  }

  // Cached (Tile object exists) but neither loaded nor errored yet — mid-flight. Does not
  // include `null` entries (a confirmed "no data here" answer, not a pending one).
  get loading_count(): number {
    let count = 0;
    for (const tile of this.storage.values()) {
      if (tile && tile.image === undefined && tile.state !== 'error') count++;
    }
    return count;
  }

  // LOAD-9 (debug-overlay memory estimate): a rough, honest RGBA byte count for every cached tile
  // that actually has a ready image — `width * height * 4`, the same convention browser devtools
  // use for canvas/image memory. Not exact (the browser's real internal storage format for a
  // decoded <img>/<canvas> isn't exposed to script, and could in principle differ — compressed
  // texture upload, sub-byte formats, etc.) but a consistent, conservative upper-ish bound for an
  // uncompressed raster, cheap enough to compute on demand every frame (same on-demand-getter
  // pattern as loaded_count/error_count/loading_count above, for the same "can't drift from
  // eviction" reason). Entries with no image yet (mid-flight) or `null` (confirmed no-data) are
  // skipped — they occupy no meaningful raster memory of their own.
  get estimated_bytes(): number {
    let total = 0;
    for (const tile of this.storage.values()) {
      if (tile && tile.image !== undefined) {
        const image = tile.image as { width: number; height: number };
        total += image.width * image.height * 4;
      }
    }
    return total;
  }

  get(x: number, y: number, z: number): Tile | null | undefined {
    const key = x + ':' + y + ':' + z;

    if (this.storage.has(key)) {
      this.cache_hit_count++;
      const tile = this.storage.get(key) as Tile | null;
      // Refresh recency: delete + re-set moves this key to the end of the Map's iteration
      // order, i.e. marks it most-recently-used.
      this.storage.delete(key);
      this.storage.set(key, tile);
      return tile;
    }

    // Every miss means asking the underlying source (onGet/fetchTile) for this tile — counted
    // here regardless of what comes back, since the request itself already happened by this
    // point (see requested_count's doc comment).
    this.requested_count++;
    const tile = super.get(x, y, z);
    if (tile !== undefined) {
      // Only Tile | null gets cached — `undefined` (no onGet configured, or onGet declining to
      // answer) is deliberately never cached, so every call keeps trying instead of getting
      // stuck on a transient "no answer".
      this.storage.set(key, tile);
      while (this.storage.size > this.cache_limit) {
        const oldestKey = this.storage.keys().next().value;
        if (oldestKey === undefined) break; // storage is empty — shouldn't happen here, but be safe
        this.storage.delete(oldestKey);
      }
    }
    return tile;
  }
}

/// XYZTileSource //////////////////////////////////////////////////////////////////////////////////
// SRC-2: a reusable base for the common "build a URL from x/y/z, load it as an <img>" pattern —
// previously duplicated per source as ad hoc closures in src/layers.ts (makeTileGetter). Includes
// SRC-4's retry-with-backoff, generalized here rather than left a layers.ts-local helper, since
// it's genuinely core tile-loading infrastructure, not demo-specific.
export interface XYZTileSourceOptions extends TileSourceOptions {
  urlTemplate: (x: number, y: number, z: number) => string;
  maxRetries?: number; // attempts beyond the first, e.g. 3 -> 4 tries total before giving up
  retryBaseDelayMs?: number; // exponential backoff: retryBaseDelayMs * 2^attemptIndex
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

export class XYZTileSource extends TSCache {
  urlTemplate: (x: number, y: number, z: number) => string;
  maxRetries: number;
  retryBaseDelayMs: number;

  constructor(options: XYZTileSourceOptions) {
    super(options);
    this.urlTemplate = options.urlTemplate;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.onGet = (x, y, z) => this.fetchTile(x, y, z);
  }

  /** Builds the request URL for a tile. Override to remap coordinates first — see TMSTileSource. */
  protected buildUrl(x: number, y: number, z: number): string {
    return this.urlTemplate(x, y, z);
  }

  private fetchTile(x: number, y: number, z: number): Tile {
    // The same Tile instance is reused across retries (only `preparing_image`/`state` are
    // mutated) — TSCache caches whatever this returns, keyed by x:y:z, so a later successful
    // retry "self-heals" that cache entry in place; TSCache itself needs no retry-awareness.
    const tile = new Tile(x, y, z, { state: 'prepare' });

    const attempt = (attemptIndex: number): void => {
      const img = new Image();
      tile.preparing_image = img;
      img.onload = tile.makeReadyCallback(() => { this.received_count++; });
      img.onerror = () => {
        if (attemptIndex < this.maxRetries) {
          // Not cancelled if the tile falls out of view/gets evicted before it fires (see
          // LOAD-4, not done yet) — harmless (finishes updating an otherwise-unreferenced Tile),
          // not a growing leak.
          setTimeout(() => attempt(attemptIndex + 1), this.retryBaseDelayMs * Math.pow(2, attemptIndex));
        } else {
          tile.state = 'error';
          console.warn(`Tile load failed permanently after ${this.maxRetries + 1} attempt(s): ${this.buildUrl(x, y, z)}`);
        }
      };
      img.src = this.buildUrl(x, y, z);
    };

    attempt(0);
    return tile;
  }
}

/// TMSTileSource ///////////////////////////////////////////////////////////////////////////////////
// TMS flips the Y axis relative to the (far more common) XYZ/Slippy convention — origin at the
// bottom-left instead of the top-left. `x`/`y`/`z` as seen by callers (TiledLayer, the cache key,
// heat()'s addressing) stay XYZ throughout; only the request URL gets the flipped Y, computed
// fresh per call since it depends on `z`.
export class TMSTileSource extends XYZTileSource {
  protected buildUrl(x: number, y: number, z: number): string {
    const tmsY = Math.pow(2, z) - 1 - y;
    return super.buildUrl(x, tmsY, z);
  }
}

/// StaticCanvasTileSource /////////////////////////////////////////////////////////////////////////
// SRC-2: a reusable base for sources that synthesize a tile's image on the fly (by drawing into a
// canvas) rather than fetching one — generalizes the pattern src/layers.ts's xkcd source used to
// hand-roll directly against TSCache. Synchronous by nature (drawing is synchronous), so no
// retry/error-state machinery is needed here the way XYZTileSource needs it for network loads.
export interface StaticCanvasTileSourceOptions extends TileSourceOptions {
  /**
   * Called for every cache miss. `getCtx()` lazily creates a tile_size x tile_size canvas on
   * first call within this invocation — call it only once actual data is confirmed, so a tile
   * with no data (common: most of a sparse/small dataset's index space is empty) costs nothing
   * beyond the lookup itself. Return false without calling `getCtx()` at all for "no data here".
   *
   * (An earlier version of this class always allocated the canvas up front, before drawTile got
   * a chance to say "no data" — a real regression this API is designed to make hard to repeat:
   * a sparse source at a zoom/pan where most lookups miss meant allocating and discarding a full
   * tile_size x tile_size canvas per miss, memory pressure real enough to visibly break canvas
   * rendering in a constrained environment. Caught via Playwright, not by inspection.)
   */
  drawTile: (getCtx: () => CanvasRenderingContext2D, x: number, y: number, z: number) => boolean;
}

export class StaticCanvasTileSource extends TSCache {
  drawTileFn: StaticCanvasTileSourceOptions['drawTile'];

  constructor(options: StaticCanvasTileSourceOptions) {
    super(options);
    this.drawTileFn = options.drawTile;
    this.onGet = (x, y, z) => {
      let canvas: HTMLCanvasElement | undefined;
      const getCtx = (): CanvasRenderingContext2D => {
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.width = this.tile_size;
          canvas.height = this.tile_size;
        }
        return canvas.getContext('2d') as CanvasRenderingContext2D;
      };
      const hasData = this.drawTileFn(getCtx, x, y, z);
      return hasData && canvas ? new Tile(x, y, z, { image: canvas }) : null;
    };
  }
}

/// DownsampledTileSource //////////////////////////////////////////////////////////////////////////
// SRC-8: a generic mip-level wrapper over any other TileSource, for sources that have a fixed
// native zoom level and no real reduced-detail levels below it. The motivating case (see
// xkcd_tiles, src/layers.ts / DEMO-5): a StaticCanvasTileSource whose onGet ignores `z` entirely
// and always answers at native (2048x2048) resolution — every zoomed-out level was forced to
// fetch/scale down full native tiles instead of requesting fewer, pre-shrunk ones the way a real
// tile pyramid would, which is both wasteful (many full-size canvases drawn tiny) and, once a
// source's addressing actually depends on `z` the way a real pyramid's does, outright wrong (the
// same x/y at a coarser z is a *different* native-grid cell, not a shrunk view of the same area —
// see BACKLOG.md's TSCache.heat() note for the analogous bug in z-independent-vs-dependent
// addressing). This class fixes both: it owns the doubling-pyramid arithmetic so a wrapped source
// only ever has to answer at its own single native level.
//
// Wraps `source` (the native-resolution TileSource) plus `z0`, its native zoom level in the same
// numbering TiledLayer passes to get() (i.e. already including that layer's `z_max` offset — see
// TiledLayer.getLevelParams, src/map.ts).
//
// SRC-9: each level below z0 is built from exactly 4 tiles of the adjacent finer level (a real mip
// chain), not directly from up to n*n native tiles — see buildTile()'s comment for why the
// original direct-from-native approach was a measured, reproducible perf bug (90s/9 tiles at ÷16).
export interface DownsampledTileSourceOptions extends TileSourceOptions {
  source: TileSource; // the wrapped, native-resolution source
  z0: number; // z at and above which get() is a pure, unchanged passthrough to `source`
}

export class DownsampledTileSource extends TSCache {
  source: TileSource;
  z0: number;

  constructor(options: DownsampledTileSourceOptions) {
    super(options);
    this.source = options.source;
    this.z0 = options.z0;
    // Reuses TSCache's own `storage` (inherited get()) as the ONE cache here — a built composite
    // is stored under its own x:y:z key exactly like a passthrough answer would be, no second,
    // composite-specific cache on top. Levels >= z0 and < z0 share this cache without collision:
    // the key includes `z`, so a composite at z=5 and a native tile at z=11 (say) never collide
    // even if x/y happen to match.
    this.onGet = (x, y, z) => this.buildTile(x, y, z);
  }

  private buildTile(x: number, y: number, z: number): Tile | null | undefined {
    if (z >= this.z0) return this.source.get(x, y, z); // native-or-finer: unchanged passthrough

    // SRC-9: build this level from the ADJACENT finer level (z+1), not straight from n*n native
    // tiles — a real mip chain, not a resample-from-base every time. The original (SRC-8) version
    // here fetched `this.source.get()` directly n*n times (n = 2^(z0-z): 256 for a single ÷16
    // composite), each one triggering a full, expensive native decode (xkcd's `load_tree` into a
    // 2048x2048 canvas) — measured at 90 SECONDS synchronously for just 9 neighboring ÷16 tiles
    // (see BACKLOG.md SRC-9). Compositing from exactly 4 tiles at z+1 instead, fetched through a
    // RECURSIVE `this.get()` call (not `this.source.get()`!), fixes this the way a real bitmap
    // mipmap pyramid is built:
    //  (1) any single buildTile call now allocates/draws from exactly 4 sub-results, never up to
    //      n*n — peak work per call is a small constant, not O(n^2), regardless of how far past
    //      z0 the requested level is;
    //  (2) `this.get()` routes through TSCache's own `get()` (inherited, unchanged), so every
    //      intermediate level this recursion touches (z0-1, z0-2, ...) gets cached in `storage`
    //      right alongside the top-level answer, keyed by its own x:y:z — a later request that
    //      shares part of this subtree (a shallower zoom over the same area already visited, or a
    //      composite built afterward whose recursion bottoms out through an already-cached
    //      intermediate) reuses it via a cheap `ctx.drawImage`, no re-decode;
    //  (3) the recursion bottoms out exactly at z+1 === z0, where this.get() (inherited TSCache.get,
    //      via `onGet` = this.buildTile) hits the `z >= this.z0` branch above and becomes the
    //      ordinary passthrough to `source` — so the expensive native decode of any given native
    //      tile still happens, just at most ONCE per cache lifetime instead of once per composite
    //      that happens to include it.
    const sub = this.tile_size / 2;

    // Same "wait for a final answer per sub-tile, else return undefined, never cache a partial
    // composite" convention as before (see the SRC-8 note this used to carry here) — just over
    // exactly 4 sub-results now instead of up to n*n. A sub-tile still in flight (this.get()
    // returning `undefined`, e.g. a not-yet-built deeper level or an XYZTileSource tile mid-load)
    // makes the whole composite "not ready"; the next get() for this key simply retries, cheaply,
    // since everything sits behind TSCache's own caching.
    let canvas: HTMLCanvasElement | undefined;
    let ctx: CanvasRenderingContext2D | undefined;
    let anyData = false;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const subTile = this.get(2 * x + dx, 2 * y + dy, z + 1);
        if (subTile === undefined) return undefined; // not ready yet — retry later, don't cache
        if (subTile === null) continue; // confirmed "no data" for this quadrant — final, leave blank
        if (subTile.image === undefined) {
          if (subTile.state === 'error') continue; // confirmed permanent failure — final, leave blank
          return undefined; // still loading — not a final answer, retry later, don't cache
        }
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.width = this.tile_size;
          canvas.height = this.tile_size;
          ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        }
        (ctx as CanvasRenderingContext2D).drawImage(subTile.image, dx * sub, dy * sub, sub, sub);
        anyData = true;
      }
    }
    // No sub-tile anywhere had data: a confirmed "no data" answer for the whole composite, cached
    // like any other null (see TSCache.get()'s comment on why null and undefined are cached
    // differently) rather than an empty canvas.
    return anyData && canvas ? new Tile(x, y, z, { image: canvas }) : null;
  }
}

/// HeatableTileSource ////////////////////////////////////////////////////////////////////////////
// Narrow, duck-typed contract for the LOAD-1 wiring in TiledLayer.draw (src/map.ts): any
// TileSource that also exposes `heat()` (currently only TSCache) gets its background
// preloading driven automatically by the visible tile range, instead of relying on call
// sites to remember to invoke `heat()` themselves (which, before LOAD-1, nothing did).
export interface HeatableTileSource extends TileSource {
  heat(x: number, y: number, z: number, r1?: number, r2?: number, zup?: number, zdn?: number): void;
}

export function isHeatableTileSource(source: TileSource): source is HeatableTileSource {
  return typeof (source as Partial<HeatableTileSource>).heat === 'function';
}

// todo: метод прогрева прямоугольной зоны слоя
// todo: метод освобождения вне прямоугольной зоны слоя
/// Tile //////////////////////////////////////////////////////////////////////////////////////////
export interface TileOptions {
  kind?: string;
  state?: string;
  data?: unknown;
  preparing_image?: HTMLImageElement;
  image?: CanvasImageSource;
}

export class Tile {
  x: number;
  y: number;
  z: number;
  kind?: string;
  state?: string;
  data?: unknown;
  preparing_image?: HTMLImageElement;
  image?: CanvasImageSource;
  options?: TileOptions;

  constructor(x: number, y: number, z: number, options?: TileOptions) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.kind = options && options.kind;
    this.state = options && options.state;

    this.data = options && options.data;
    this.preparing_image = options && options.preparing_image;
    this.image = options && options.image;
    this.options = options;
  }

  makeReadyCallback(onReady?: (tile: Tile) => void): () => void {
    return () => {
      this.state = 'ready';
      if (this.preparing_image) this.image = this.preparing_image;
      if (onReady) onReady(this);
    };
  }
}

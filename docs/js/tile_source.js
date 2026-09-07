import { heat } from './tile_tree.js';
export class TileSource {
    constructor(options) {
        this.name = options && options.name;
        this.onGet = options && options.onGet;
        this.tile_size = options.tile_size;
        this.options = options;
    }
    get(x, y, z) {
        if (this.onGet) {
            return this.onGet(x, y, z);
        }
        return undefined;
    }
}
// LOAD-5: `storage` used to grow without limit for the lifetime of the page (flagged as a known
// gap in tile_tree.ts's old comments and in BACKLOG.md's audit). Generous enough that normal
// panning/zooming rarely evicts anything actually still in view, but bounded.
const DEFAULT_CACHE_LIMIT = 2000;
export class TSCache extends TileSource {
    constructor(options) {
        super(options);
        // LOAD-8 (debug-overlay stats): cumulative, session-lifetime counters — unlike
        // loaded_count/error_count/loading_count below (which scan `storage` and so only ever describe
        // what's cached *right now*), these track totals across the whole page lifetime, surviving LRU
        // eviction. Deliberately plain incrementing counters (not derived) since the events they count
        // (a cache miss, a cache hit, a successful load, a prefetch candidate queued) aren't otherwise
        // recoverable after the fact once older entries fall out of `storage`.
        this.requested_count = 0; // get() calls that missed the cache and asked the underlying source for a tile
        this.cache_hit_count = 0; // get() calls served straight from `storage`, no request to the source
        this.received_count = 0; // tiles that finished loading successfully (see XYZTileSource.fetchTile)
        this.prefetch_queued_count = 0; // tiles pushed onto load_queue by heat() (background-preload candidates)
        this.cache_limit = options.cache_limit || DEFAULT_CACHE_LIMIT;
        this.storage = new Map();
        this.load_queue = [];
        this._last_heating_state = null;
        this.onBackgroundHeat = () => {
            if (this.load_queue.length) {
                const tile = this.load_queue.pop();
                this.get(tile.x, tile.y, tile.z);
            }
            setTimeout(this.onBackgroundHeat, 10); // todo: extract to constant or settings
        };
        this.onBackgroundHeat(); // todo: add property 'backgroundHeatingEnable'
    }
    heat(x, y, z, r1, r2, zup, zdn) {
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
        if (this._last_heating_state === heating_state)
            return;
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
        const callback = (ix, iy, iz) => {
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
    get cache_size() {
        return this.storage.size;
    }
    // Debug-overlay support: counts by outcome, computed on demand rather than tracked
    // incrementally (cheap enough at cache_limit's scale, and can't drift out of sync with
    // eviction the way a running counter could). `.image` is checked directly rather than
    // `.state === 'ready'` because StaticCanvasTileSource's tiles never set `state` at all (they're
    // ready the instant they're constructed) — a tile counts as loaded once it has an image,
    // regardless of what (if anything) set `state`.
    get loaded_count() {
        let count = 0;
        for (const tile of this.storage.values()) {
            if (tile && tile.image !== undefined)
                count++;
        }
        return count;
    }
    get error_count() {
        let count = 0;
        for (const tile of this.storage.values()) {
            if (tile && tile.state === 'error')
                count++;
        }
        return count;
    }
    // Cached (Tile object exists) but neither loaded nor errored yet — mid-flight. Does not
    // include `null` entries (a confirmed "no data here" answer, not a pending one).
    get loading_count() {
        let count = 0;
        for (const tile of this.storage.values()) {
            if (tile && tile.image === undefined && tile.state !== 'error')
                count++;
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
    get estimated_bytes() {
        let total = 0;
        for (const tile of this.storage.values()) {
            if (tile && tile.image !== undefined) {
                const image = tile.image;
                total += image.width * image.height * 4;
            }
        }
        return total;
    }
    get(x, y, z) {
        const key = x + ':' + y + ':' + z;
        if (this.storage.has(key)) {
            this.cache_hit_count++;
            const tile = this.storage.get(key);
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
                if (oldestKey === undefined)
                    break; // storage is empty — shouldn't happen here, but be safe
                this.storage.delete(oldestKey);
            }
        }
        return tile;
    }
}
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
export class XYZTileSource extends TSCache {
    constructor(options) {
        var _a, _b;
        super(options);
        this.urlTemplate = options.urlTemplate;
        this.maxRetries = (_a = options.maxRetries) !== null && _a !== void 0 ? _a : DEFAULT_MAX_RETRIES;
        this.retryBaseDelayMs = (_b = options.retryBaseDelayMs) !== null && _b !== void 0 ? _b : DEFAULT_RETRY_BASE_DELAY_MS;
        this.onGet = (x, y, z) => this.fetchTile(x, y, z);
    }
    /** Builds the request URL for a tile. Override to remap coordinates first — see TMSTileSource. */
    buildUrl(x, y, z) {
        return this.urlTemplate(x, y, z);
    }
    fetchTile(x, y, z) {
        // The same Tile instance is reused across retries (only `preparing_image`/`state` are
        // mutated) — TSCache caches whatever this returns, keyed by x:y:z, so a later successful
        // retry "self-heals" that cache entry in place; TSCache itself needs no retry-awareness.
        const tile = new Tile(x, y, z, { state: 'prepare' });
        const attempt = (attemptIndex) => {
            const img = new Image();
            tile.preparing_image = img;
            img.onload = tile.makeReadyCallback(() => { this.received_count++; });
            img.onerror = () => {
                if (attemptIndex < this.maxRetries) {
                    // Not cancelled if the tile falls out of view/gets evicted before it fires (see
                    // LOAD-4, not done yet) — harmless (finishes updating an otherwise-unreferenced Tile),
                    // not a growing leak.
                    setTimeout(() => attempt(attemptIndex + 1), this.retryBaseDelayMs * Math.pow(2, attemptIndex));
                }
                else {
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
    buildUrl(x, y, z) {
        const tmsY = Math.pow(2, z) - 1 - y;
        return super.buildUrl(x, tmsY, z);
    }
}
export class StaticCanvasTileSource extends TSCache {
    constructor(options) {
        super(options);
        this.drawTileFn = options.drawTile;
        this.onGet = (x, y, z) => {
            let canvas;
            const getCtx = () => {
                if (!canvas) {
                    canvas = document.createElement('canvas');
                    canvas.width = this.tile_size;
                    canvas.height = this.tile_size;
                }
                return canvas.getContext('2d');
            };
            const hasData = this.drawTileFn(getCtx, x, y, z);
            return hasData && canvas ? new Tile(x, y, z, { image: canvas }) : null;
        };
    }
}
export class DownsampledTileSource extends TSCache {
    constructor(options) {
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
    buildTile(x, y, z) {
        if (z >= this.z0)
            return this.source.get(x, y, z); // native-or-finer: unchanged passthrough
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
        let canvas;
        let ctx;
        let anyData = false;
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const subTile = this.get(2 * x + dx, 2 * y + dy, z + 1);
                if (subTile === undefined)
                    return undefined; // not ready yet — retry later, don't cache
                if (subTile === null)
                    continue; // confirmed "no data" for this quadrant — final, leave blank
                if (subTile.image === undefined) {
                    if (subTile.state === 'error')
                        continue; // confirmed permanent failure — final, leave blank
                    return undefined; // still loading — not a final answer, retry later, don't cache
                }
                if (!canvas) {
                    canvas = document.createElement('canvas');
                    canvas.width = this.tile_size;
                    canvas.height = this.tile_size;
                    ctx = canvas.getContext('2d');
                }
                ctx.drawImage(subTile.image, dx * sub, dy * sub, sub, sub);
                anyData = true;
            }
        }
        // No sub-tile anywhere had data: a confirmed "no data" answer for the whole composite, cached
        // like any other null (see TSCache.get()'s comment on why null and undefined are cached
        // differently) rather than an empty canvas.
        return anyData && canvas ? new Tile(x, y, z, { image: canvas }) : null;
    }
}
export function isHeatableTileSource(source) {
    return typeof source.heat === 'function';
}
export class Tile {
    constructor(x, y, z, options) {
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
    makeReadyCallback(onReady) {
        return () => {
            this.state = 'ready';
            if (this.preparing_image)
                this.image = this.preparing_image;
            if (onReady)
                onReady(this);
        };
    }
}
//# sourceMappingURL=tile_source.js.map
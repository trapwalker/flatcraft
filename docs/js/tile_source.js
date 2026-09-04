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
        zup = zup === undefined ? 1 : zup;
        zdn = zdn === undefined ? 1 : zdn; // was `: zup` — only mattered when zup was passed without zdn
        const heating_state = [x, y, z, r1, r2, zup, zdn].toString();
        if (this._last_heating_state === heating_state)
            return;
        this._last_heating_state = heating_state;
        const callback = (ix, iy, iz) => {
            return this.load_queue.push({ x: x + ix, y: y + iy, z: z + iz });
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
    get(x, y, z) {
        const key = x + ':' + y + ':' + z;
        if (this.storage.has(key)) {
            const tile = this.storage.get(key);
            // Refresh recency: delete + re-set moves this key to the end of the Map's iteration
            // order, i.e. marks it most-recently-used.
            this.storage.delete(key);
            this.storage.set(key, tile);
            return tile;
        }
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
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
export class TSCache extends TileSource {
    constructor(options) {
        super(options);
        this.cache_size = 0;
        this.storage = {};
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
    get(x, y, z) {
        const key = x + ':' + y + ':' + z;
        let tile = this.storage[key];
        if (tile !== undefined)
            return tile;
        tile = super.get(x, y, z);
        if (tile !== undefined) {
            this.storage[key] = tile;
            this.cache_size += 1;
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
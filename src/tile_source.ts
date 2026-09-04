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
    zup = zup === undefined ? 1 : zup;
    zdn = zdn === undefined ? 1 : zdn; // was `: zup` — only mattered when zup was passed without zdn
    const heating_state = [x, y, z, r1, r2, zup, zdn].toString();
    if (this._last_heating_state === heating_state) return;

    this._last_heating_state = heating_state;

    const callback = (ix: number, iy: number, iz: number): number => {
      return this.load_queue.push({ x: x + ix, y: y + iy, z: z + iz });
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

  get(x: number, y: number, z: number): Tile | null | undefined {
    const key = x + ':' + y + ':' + z;

    if (this.storage.has(key)) {
      const tile = this.storage.get(key) as Tile | null;
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
        if (oldestKey === undefined) break; // storage is empty — shouldn't happen here, but be safe
        this.storage.delete(oldestKey);
      }
    }
    return tile;
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

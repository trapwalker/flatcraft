import { heat } from './tile_tree.js';

/// TileSource ////////////////////////////////////////////////////////////////////////////////////
export interface TileSourceOptions {
  name?: string;
  onGet?: (this: TileSource, x: number, y: number, z: number) => Tile | null | undefined;
  tile_size: number;
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

export class TSCache extends TileSource {
  cache_size: number;
  storage: Record<string, Tile | null | undefined>;
  load_queue: QueuedTile[];
  private _last_heating_state: string | null;
  private onBackgroundHeat: () => void;

  constructor(options: TileSourceOptions) {
    super(options);
    this.cache_size = 0;
    this.storage = {};
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

  get(x: number, y: number, z: number): Tile | null | undefined {
    const key = x + ':' + y + ':' + z;
    let tile = this.storage[key];
    if (tile !== undefined) return tile;

    tile = super.get(x, y, z);
    if (tile !== undefined) {
      this.storage[key] = tile;
      this.cache_size += 1;
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

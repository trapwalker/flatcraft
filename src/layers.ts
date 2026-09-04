// Layers =========================================================================

import { Vector } from './vector.js';
import { BASE_COLOR, DEBUG } from './defines.js';
import { Iter } from './tools.js';
import { load_tree, leafFunction } from './tile_tree.js';
import { Tile, TSCache } from './tile_source.js';
import type { TileSource } from './tile_source.js';
import { Layer, TiledLayer } from './map.js';
import type { MapWidget } from './map.js';

// SRC-4: retry policy for a failed tile image load (404, network error, etc.) — was previously
// unhandled entirely (no img.onerror at all), so a broken tile got cached forever in
// state:'prepare' with no image and no way to ever recover, even if the failure was transient.
export interface MakeTileGetterOptions {
  maxRetries?: number; // attempts beyond the first, e.g. 3 -> 4 tries total before giving up
  retryBaseDelayMs?: number; // exponential backoff: retryBaseDelayMs * 2^attemptIndex
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

function makeTileGetter(
  uriBuilder: (x: number, y: number, z: number) => string,
  options?: MakeTileGetterOptions
): (x: number, y: number, z: number) => Tile {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = options?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  return function (x: number, y: number, z: number): Tile {
    const path = uriBuilder(x, y, z);
    // The same Tile instance is reused across retries (only `preparing_image`/`state` are
    // mutated) — TSCache caches whatever Tile object this function returns, keyed by x:y:z, so
    // a later successful retry "self-heals" that cache entry in place; TSCache itself needs no
    // retry-awareness at all.
    const tile = new Tile(x, y, z, { state: 'prepare' });

    const attempt = (attemptIndex: number): void => {
      const img = new Image();
      tile.preparing_image = img;
      img.onload = tile.makeReadyCallback();
      img.onerror = () => {
        if (attemptIndex < maxRetries) {
          // Note: this timer isn't cancelled if the tile falls out of view/gets evicted from
          // TSCache before it fires (see LOAD-4, not done yet) — harmless (it just finishes
          // updating an otherwise-unreferenced Tile object), not a growing leak.
          setTimeout(() => attempt(attemptIndex + 1), retryBaseDelayMs * Math.pow(2, attemptIndex));
        } else {
          tile.state = 'error';
          console.warn(`Tile load failed permanently after ${maxRetries + 1} attempt(s): ${path}`);
        }
      };
      img.src = path;
    };

    attempt(0);
    return tile;
  };
}

//mapTileSource = new TSCache({
//  tile_size: 256,
//  onGet: makeTileGetter(function(x, y, z) {return `http://roaddogs.ru/map/merged/${z}/${x}/${y}.jpg`;})
//});

const TILE_EXT = '.png';

const tsMerged = new TSCache({
  tile_size: 256,
  onGet: makeTileGetter((x, y, z) => `http://roaddogs.ru/map/merged/${z}/${x}/${y}${TILE_EXT}`)
});

const tsBack = new TSCache({
  tile_size: 256,
  onGet: makeTileGetter((x, y, z) => `http://roaddogs.ru/map/back/${z}/${x}/${y}${TILE_EXT}`)
  //  onGet: makeTileGetter(function(x, y, z) {return `http://roaddogs.ru/map/back/${z}/${x}/${y}${TILE_EXT}`;})
});

const tsFront = new TSCache({
  tile_size: 256,
  //  onGet: makeTileGetter(function(x, y, z) {return `http://roaddogs.ru/map/front/${z}/${x}/${y}${TILE_EXT}`;})
  onGet: makeTileGetter((x, y, z) => `https://a.tile.openstreetmap.org/${z}/${x}/${y}${TILE_EXT}`)
});

const tsOSM = new TSCache({
  tile_size: 256,
  onGet: makeTileGetter((x, y, z) => `https://a.tile.openstreetmap.org/${z}/${x}/${y}${TILE_EXT}`)
});

const tsStrava = new TSCache({
  tile_size: 512,
  onGet: makeTileGetter((x, y, z) => `https://heatmap-external-a.strava.com/tiles/all/hot/${z}/${x}/${y}.png`)
});

function drawTileDebug(
  this: TiledLayer,
  map: MapWidget,
  ix: number,
  iy: number,
  iz: number,
  x: number,
  y: number,
  tsize: number
): void {
  const ctx = map.ctx;
  ctx.font = Math.round(tsize / 10) + 'px Arial'; // todo: font size calculate
  ctx.fillStyle = (this.options.textColor || this.options.color) as string;
  ctx.textAlign = 'center';
  ctx.fillText('[' + ix + ', ' + iy + ']/' + iz, x + tsize / 2, y + tsize / 2);
  //ctx.fillText(""+Math.round(tsize), x + tsize / 2, y + tsize / 2 + 40);

  ctx.beginPath();
  ctx.strokeStyle = (this.options.frameColor || this.options.color) as string;
  ctx.rect(x + 10, y + 10, tsize - 20 - 1, tsize - 20 - 1);
  ctx.rect(x, y, tsize, tsize);
  ctx.stroke();
}

function drawDebugInfo(this: Layer, map: MapWidget): void {
  const ctx = map.ctx;
  const w = map.canvas.width;
  const h = map.canvas.height;
  const pos = new Vector(Math.round(map.c.x), Math.round(map.c.y));
  ctx.font = '20px Arial';
  ctx.fillStyle = this.options.color as string;
  ctx.textAlign = 'left';

  ctx.fillText('pos=' + pos, w - 300, h - 20);
  const fps_range = map.fps_stat.frame_range();

  ctx.fillText(
    'fps=' + Math.round(map.fps_stat.avg())
    + ' [' + Math.round(fps_range[0] as number)
    + '..' + Math.round(fps_range[1] as number)
    + '] ' + (tsMerged.cache_size + tsBack.cache_size + tsFront.cache_size + tsOSM.cache_size), // todo: automate cache size counting
    w - 300, h - 40
  );

  const dt_range = map.dt_stat.frame_range();
  ctx.fillText(
    'dt=' + Math.round(map.dt_stat.avg() * 1000)
    + ' [' + Math.round((dt_range[0] as number) * 1000)
    + '..' + Math.round((dt_range[1] as number) * 1000)
    + '] ',
    w - 300, h - 60
  );
}

export const LAYERS: Record<string, Layer> = {
  background: new Layer({
    name: 'Background',
    color: BASE_COLOR,
    onDraw: function (this: Layer, map: MapWidget) {
      map.ctx.fillStyle = this.options.color as string;
      map.ctx.fillRect(0, 0, map.canvas.width, map.canvas.height); // todo: use width and height properties
    }
  }),

  xkcd_tiles: new TiledLayer({
    name: 'XKCD tiles',
    tile_source: new TSCache({
      tile_size: 2048,
      onGet: function (this: TileSource, x: number, y: number, z: number): Tile | null {
        const key = x + ':' + (64 - y);
        const data = TILES_AS_TREE[key];
        if (data === undefined) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.tile_size;
        canvas.height = this.tile_size;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        console.log('build tile: ' + [x, y, z] + ' data: ' + data.length);
        load_tree(Iter(data), leafFunction, ctx, 2048); // строит изображение тайла через leafFunction
        return new Tile(x, y, z, { image: canvas });
      }
    }),
    visible: false,
    z_max: 11 // todo: rename to z_deep
  }),

  xkcd_debug: new TiledLayer({
    name: 'XKCD tiles debug',
    tile_size: 2048,
    color: 'rgba(255, 0, 0, 0.5)',
    onTileDraw: drawTileDebug,
    visible: false,
    z_max: 11 // todo: rename to z_deep
  }),

  map_tiles_back: new TiledLayer({
    name: 'Map tiles back',
    tile_source: tsBack,
    visible: false,
    z_max: 18 // todo: rename to z_deep
  }),

  map_tiles_front: new TiledLayer({
    name: 'Map tiles front',
    tile_source: tsFront,
    visible: true,
    z_max: 18 // todo: rename to z_deep
  }),

  map_tiles: new TiledLayer({
    name: 'Map tiles (mixed)',
    tile_source: tsMerged,
    visible: false,
    z_max: 18 // todo: rename to z_deep
  }),

  map_tiles_strava: new TiledLayer({
    name: 'Strava heat map',
    tile_source: tsStrava,
    visible: false,
    z_max: 18 // todo: rename to z_deep
  }),

  map_debug: new TiledLayer({
    name: 'Map tiles debug',
    tile_size: 256,
    color: 'rgba(150, 150, 255, 0.5)',
    onTileDraw: drawTileDebug,
    visible: false,
    z_max: 18 // todo: rename to z_deep
  }),

  map_grid: new TiledLayer({
    name: 'Map grid',
    tile_size: 256,
    color: 'rgba(60, 110, 60, 0.4)',
    visible: true,
    z_max: 18, // todo: rename to z_deep
    onTileDraw: function (this: TiledLayer, map: MapWidget, ix: number, iy: number, iz: number, x: number, y: number, tsize: number): void {
      const k = (tsize - 128) / 128;
      //k *= k;
      const color = this.options.color as string;

      const ctx = map.ctx;

      ctx.save();
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.rect(x, y, tsize / 2, tsize / 2);
      ctx.rect(x + tsize / 2, y, tsize / 2, tsize / 2);
      ctx.rect(x, y + tsize / 2, tsize / 2, tsize / 2);
      ctx.rect(x + tsize / 2, y + tsize / 2, tsize / 2, tsize / 2);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.rect(x, y, tsize, tsize);
      ctx.stroke();
    }
  }),

  debug: new Layer({
    name: 'Debug data',
    color: 'red',
    onDraw: drawDebugInfo,
    visible: DEBUG
  })
};

export const ALL_LAYERS: Layer[] = [
  LAYERS.background,
  LAYERS.map_tiles_back,
  LAYERS.map_tiles_front,
  LAYERS.map_tiles,
  LAYERS.map_debug,
  LAYERS.map_grid,
  LAYERS.xkcd_tiles,
  LAYERS.xkcd_debug,
  LAYERS.map_tiles_strava,
  LAYERS.debug
];

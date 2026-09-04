// Layers =========================================================================

import { Vector } from './vector.js';
import { BASE_COLOR, DEBUG } from './defines.js';
import { Iter } from './tools.js';
import { load_tree, leafFunction } from './tile_tree.js';
import { XYZTileSource, StaticCanvasTileSource } from './tile_source.js';
import { Layer, TiledLayer } from './map.js';
import type { MapWidget } from './map.js';

// SRC-2: retry-with-backoff (SRC-4) and the URL-template pattern now live in XYZTileSource
// (src/tile_source.ts) — generalized out of what used to be a layers.ts-local `makeTileGetter`,
// since neither is specific to this demo's particular sources.

const TILE_EXT = '.png';

const tsMerged = new XYZTileSource({
  tile_size: 256,
  urlTemplate: (x, y, z) => `http://roaddogs.ru/map/merged/${z}/${x}/${y}${TILE_EXT}`
});

const tsBack = new XYZTileSource({
  tile_size: 256,
  urlTemplate: (x, y, z) => `http://roaddogs.ru/map/back/${z}/${x}/${y}${TILE_EXT}`
});

const tsFront = new XYZTileSource({
  tile_size: 256,
  urlTemplate: (x, y, z) => `https://a.tile.openstreetmap.org/${z}/${x}/${y}${TILE_EXT}`
});

const tsOSM = new XYZTileSource({
  tile_size: 256,
  urlTemplate: (x, y, z) => `https://a.tile.openstreetmap.org/${z}/${x}/${y}${TILE_EXT}`
});

const tsStrava = new XYZTileSource({
  tile_size: 512,
  urlTemplate: (x, y, z) => `https://heatmap-external-a.strava.com/tiles/all/hot/${z}/${x}/${y}.png`
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
  // The full tile-counts line ("tiles(front): visible=... loading=... loaded=... error=...
  // cached=...") measures ~580px at this font size — wider than any other debug line — so it's
  // split across two fillText calls (see below) and needs more left margin than -420 gave it,
  // which was still clipping "error=... cached=..." off the right edge of a 1280px-wide canvas.
  const x = w - 520;
  const pos = new Vector(Math.round(map.c.x), Math.round(map.c.y));
  ctx.font = '20px Arial';
  ctx.fillStyle = this.options.color as string;
  ctx.textAlign = 'left';

  ctx.fillText('pos=' + pos, x, h - 20);

  // The fps line used to end with a bare, unlabeled number (the summed cache_size of every
  // source, tacked on with `// todo: automate cache size counting`) — moved to its own labeled
  // line below instead of leaving a mystery number next to the frame-rate range.
  const fps_range = map.fps_stat.frame_range();
  ctx.fillText(
    'fps=' + Math.round(map.fps_stat.avg())
    + ' [' + Math.round(fps_range[0] as number)
    + '..' + Math.round(fps_range[1] as number)
    + ']',
    x, h - 40
  );

  const dt_range = map.dt_stat.frame_range();
  ctx.fillText(
    'dt=' + Math.round(map.dt_stat.avg() * 1000)
    + ' [' + Math.round((dt_range[0] as number) * 1000)
    + '..' + Math.round((dt_range[1] as number) * 1000)
    + ']',
    x, h - 60
  );

  // OSM/front layer specifically (per request — this is the layer that's actually visible by
  // default): how many tile slots the current viewport covers, vs. how many of those are still
  // mid-flight, already have an image, or gave up after retrying (SRC-4). `tsFront.cache_size`
  // (loading+loaded+error, plus any confirmed-empty entries) is the total ever fetched, not just
  // what's on screen right now — the two numbers differ once you've panned past tiles LOAD-5's
  // LRU limit hasn't evicted yet.
  // Two lines, topmost (h-100) first so "tiles(front): ..." reads as the label line above its
  // continuation, matching the top-to-bottom reading order of the block.
  const frontLayer = LAYERS.map_tiles_front as TiledLayer;
  ctx.fillText(
    'tiles(front): visible=' + frontLayer.visible_tile_count
    + ' loading=' + tsFront.loading_count,
    x, h - 100
  );
  ctx.fillText(
    'loaded=' + tsFront.loaded_count
    + ' error=' + tsFront.error_count
    + ' cached=' + tsFront.cache_size,
    x, h - 80
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
    tile_source: new StaticCanvasTileSource({
      tile_size: 2048,
      drawTile: (getCtx, x, y, z) => {
        const key = x + ':' + (64 - y);
        const data = TILES_AS_TREE[key];
        if (data === undefined) return false; // no canvas allocated for the (common) miss case

        console.log('build tile: ' + [x, y, z] + ' data: ' + data.length);
        load_tree(Iter(data), leafFunction, getCtx(), 2048); // строит изображение тайла через leafFunction
        return true;
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

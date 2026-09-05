// Layers =========================================================================
import { Vector } from './vector.js';
import { BASE_COLOR, DEBUG } from './defines.js';
import { Iter } from './tools.js';
import { load_tree, leafFunction } from './tile_tree.js';
import { XYZTileSource, StaticCanvasTileSource } from './tile_source.js';
import { Layer, TiledLayer } from './map.js';
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
// ROT-4 (debug layers): was broken the same way map_grid was — an axis-aligned ctx.rect(x, y,
// tsize, tsize) (plus a second, smaller "shrunk" rect inside it) at the tile's precomputed
// top-left corner, so the frame's *position* tracked the rotated camera but its *shape* never
// did, coming out visibly "torn" at any nonzero rotation. Used by both xkcd_debug and map_debug
// (`MapTilesDebug`) — same TiledLayer/onTileDraw machinery, same fix either way.
function drawTileDebug(map, ix, iy, iz, x, y, tsize, _tile, gridMatrix) {
    const ctx = map.ctx;
    ctx.font = Math.round(tsize / 10) + 'px Arial'; // todo: font size calculate
    ctx.fillStyle = (this.options.textColor || this.options.color);
    ctx.textAlign = 'center';
    if (gridMatrix) {
        // Label the tile's actual on-screen center — its corners' midpoint transformed through the
        // same per-layer matrix tileDraw() places the tile image with — not the old axis-aligned
        // (x + tsize/2, y + tsize/2), correct only at rotation 0. The label itself is deliberately
        // left unrotated (a "billboard": upright and readable at any map rotation) — only its
        // *position* needs to track the tile.
        const center = gridMatrix.transformPoint({ x: ix + 0.5, y: iy + 0.5 });
        ctx.fillText('[' + ix + ', ' + iy + ']/' + iz, center.x, center.y);
        // The tile's actual on-screen quadrilateral, drawn as one clean outline — see map_grid's
        // onTileDraw (this file) for why the four corners are transformed ourselves and stroked
        // directly, rather than via ctx.setTransform(gridMatrix): a stroke only ~1 device pixel wide
        // silently fails to render at the huge tile-index coordinates deep zoom reaches (float32
        // precision limit inside the canvas rasterizer's stroke geometry — see BACKLOG.md). No
        // second "shrunk" inner rect here either — the old version's redundant second frame added
        // nothing a human debugging tile boundaries actually needs.
        const p00 = gridMatrix.transformPoint({ x: ix, y: iy });
        const p10 = gridMatrix.transformPoint({ x: ix + 1, y: iy });
        const p11 = gridMatrix.transformPoint({ x: ix + 1, y: iy + 1 });
        const p01 = gridMatrix.transformPoint({ x: ix, y: iy + 1 });
        ctx.beginPath();
        ctx.strokeStyle = (this.options.frameColor || this.options.color);
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
        ctx.stroke();
        return;
    }
    // Fallback (no matrix given, e.g. a direct call bypassing draw()) — old axis-aligned pixel-rect
    // draw, only correct at rotation 0.
    ctx.fillText('[' + ix + ', ' + iy + ']/' + iz, x + tsize / 2, y + tsize / 2);
    ctx.beginPath();
    ctx.strokeStyle = (this.options.frameColor || this.options.color);
    ctx.rect(x, y, tsize, tsize);
    ctx.stroke();
}
function drawDebugInfo(map) {
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
    ctx.fillStyle = this.options.color;
    ctx.textAlign = 'left';
    ctx.fillText('pos=' + pos, x, h - 20);
    // The fps line used to end with a bare, unlabeled number (the summed cache_size of every
    // source, tacked on with `// todo: automate cache size counting`) — moved to its own labeled
    // line below instead of leaving a mystery number next to the frame-rate range.
    const fps_range = map.fps_stat.frame_range();
    ctx.fillText('fps=' + Math.round(map.fps_stat.avg())
        + ' [' + Math.round(fps_range[0])
        + '..' + Math.round(fps_range[1])
        + ']', x, h - 40);
    const dt_range = map.dt_stat.frame_range();
    ctx.fillText('dt=' + Math.round(map.dt_stat.avg() * 1000)
        + ' [' + Math.round(dt_range[0] * 1000)
        + '..' + Math.round(dt_range[1] * 1000)
        + ']', x, h - 60);
    // OSM/front layer specifically (per request — this is the layer that's actually visible by
    // default): how many tile slots the current viewport covers, vs. how many of those are still
    // mid-flight, already have an image, or gave up after retrying (SRC-4). `tsFront.cache_size`
    // (loading+loaded+error, plus any confirmed-empty entries) is the total ever fetched, not just
    // what's on screen right now — the two numbers differ once you've panned past tiles LOAD-5's
    // LRU limit hasn't evicted yet.
    // Two lines, topmost (h-100) first so "tiles(front): ..." reads as the label line above its
    // continuation, matching the top-to-bottom reading order of the block.
    const frontLayer = LAYERS.map_tiles_front;
    ctx.fillText('tiles(front): visible=' + frontLayer.visible_tile_count
        + ' loading=' + tsFront.loading_count, x, h - 100);
    ctx.fillText('loaded=' + tsFront.loaded_count
        + ' error=' + tsFront.error_count
        + ' cached=' + tsFront.cache_size, x, h - 80);
}
export const LAYERS = {
    background: new Layer({
        name: 'Background',
        color: BASE_COLOR,
        onDraw: function (map) {
            map.ctx.fillStyle = this.options.color;
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
                if (data === undefined)
                    return false; // no canvas allocated for the (common) miss case
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
        onTileDraw: function (map, ix, iy, iz, x, y, tsize, _tile, gridMatrix) {
            const k = (tsize - 128) / 128;
            //k *= k;
            const color = this.options.color;
            const ctx = map.ctx;
            // ROT-4: stroke the tile's actual on-screen quadrilateral — its corners transformed
            // through the same per-layer matrix tileDraw() places the tile image with — instead of an
            // axis-aligned pixel rect at the precomputed top-left corner. The old code's rect always
            // kept its own edges screen-axis-aligned even though its position moved with the rotated
            // camera, so at any nonzero rotation the grid came out "torn" (each cell a straight
            // square, the sheet as a whole not actually rotating), unlike the tile images next to it,
            // which already rotate as one rigid sheet.
            //
            // Deliberately NOT drawn the way tileDraw() draws the image itself (ctx.setTransform to
            // gridMatrix, then a unit square in tile-index units) — tried first, and it silently drew
            // nothing at deep zoom. Reason (confirmed empirically: a several-unit-wide stroke rendered
            // fine through that transform, a ~1px one didn't): tile-index coordinates at z~18 are
            // ~10^5-10^6, and a stroke only ~1 device pixel wide needs a local-space half-width far
            // smaller than a float32's precision at that magnitude to build its outline — the offset
            // rounds away to nothing and the stroke geometry collapses. Transforming the corner points
            // ourselves (below) keeps every coordinate that reaches the rasterizer in ordinary
            // screen-pixel magnitudes, sidestepping the problem entirely. gridMatrix is only absent for
            // a direct tileDraw() call that bypasses draw() (none exist in this codebase today) — the
            // pixel-rect fallback below covers that case so this doesn't silently draw nothing either.
            if (gridMatrix) {
                const p00 = gridMatrix.transformPoint({ x: ix, y: iy });
                const p10 = gridMatrix.transformPoint({ x: ix + 1, y: iy });
                const p11 = gridMatrix.transformPoint({ x: ix + 1, y: iy + 1 });
                const p01 = gridMatrix.transformPoint({ x: ix, y: iy + 1 });
                const pTop = gridMatrix.transformPoint({ x: ix + 0.5, y: iy });
                const pBottom = gridMatrix.transformPoint({ x: ix + 0.5, y: iy + 1 });
                const pLeft = gridMatrix.transformPoint({ x: ix, y: iy + 0.5 });
                const pRight = gridMatrix.transformPoint({ x: ix + 1, y: iy + 0.5 });
                // Inner 2x2 subdivision (the old four half-size rects, minus their outer edges — those
                // coincide exactly with the full-cell border drawn below, so drawing them again here
                // would just be redundant overlapping strokes): one cross through the cell's center.
                ctx.save();
                ctx.globalAlpha = k;
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.moveTo(pTop.x, pTop.y);
                ctx.lineTo(pBottom.x, pBottom.y);
                ctx.moveTo(pLeft.x, pLeft.y);
                ctx.lineTo(pRight.x, pRight.y);
                ctx.stroke();
                ctx.restore();
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.moveTo(p00.x, p00.y);
                ctx.lineTo(p10.x, p10.y);
                ctx.lineTo(p11.x, p11.y);
                ctx.lineTo(p01.x, p01.y);
                ctx.closePath();
                ctx.stroke();
                return;
            }
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
export const ALL_LAYERS = [
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
//# sourceMappingURL=layers.js.map
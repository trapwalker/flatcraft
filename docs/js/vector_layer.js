/// VectorLayer ///////////////////////////////////////////////////////////////////////////////////
// VEC-1: a Layer that draws GeoJSON-shaped Point/LineString/Polygon/MultiPolygon geometry, in the
// same per-layer coordinate system AFF-4 gave TiledLayer (this.transform, composed with the
// camera once per draw() call into a single Mat2D — see computeLayerToScreenMatrix in map.ts).
//
// Scope note: this file is VEC-1 only. Fixed-in-advance, out of scope here (see BACKLOG.md,
// "Фаза 7"): per-feature/data-driven style (VEC-2), any notion of a data *source* — static or
// tiled (VEC-3a/b/c), hit-testing/click events (VEC-4), billboard labels (VEC-6), and the demo
// wiring in src/layers.ts/src/index.ts (VEC-7). `features` below is therefore just a plain
// in-memory array — VectorSource (VEC-3a) is a separate later abstraction, not anticipated here.
import { computeLayerToScreenMatrix, Layer } from './map.js';
import { VECTOR_LAYER_FILL_COLOR, VECTOR_LAYER_LINE_COLOR, VECTOR_LAYER_POINT_COLOR } from './defines.js';
// Fixed MVP visual size of a Point marker, in on-screen CSS pixels — NOT scaled by the layer/
// camera matrix (deliberately: geometry coordinates are matrix-transformed per point below, but
// this radius is applied afterwards, directly in screen space, the same way a marker/icon would
// be in any other map library). VEC-2 is where this becomes configurable per feature/zoom.
const POINT_RADIUS_PX = 4;
/// Pure, DOM-free coordinate math /////////////////////////////////////////////////////////////////
// Split out from draw() below specifically so it's unit-testable without a live/mocked
// CanvasRenderingContext2D — see vector_layer.test.ts.
/** A single [x, y] geometry coordinate, transformed by `matrix` into screen pixels. */
export function transformCoordinate(coordinate, matrix) {
    return matrix.transformPoint({ x: coordinate[0], y: coordinate[1] });
}
/** A geometry coordinate ring/line, transformed point-by-point (never via ctx.setTransform — see
 * VectorLayer.draw's own comment on why). */
export function transformRing(ring, matrix) {
    return ring.map((coordinate) => transformCoordinate(coordinate, matrix));
}
/**
 * Every ring of a Polygon or MultiPolygon, each already transformed to screen points — flattened
 * across polygons for MultiPolygon (rendering doesn't need to know which rings belong to which
 * polygon: a single `evenodd`-filled path over all of them, outer rings and holes alike, is
 * correct regardless of grouping — see VectorLayer.draw).
 */
export function getPolygonRingsScreenPoints(geometry, matrix) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const rings = [];
    for (const polygon of polygons) {
        for (const ring of polygon) {
            rings.push(transformRing(ring, matrix));
        }
    }
    return rings;
}
/// VectorLayer //////////////////////////////////////////////////////////////////////////////////
export class VectorLayer extends Layer {
    constructor(options) {
        super(options);
        this.features = (options && options.features && options.features.slice()) || [];
    }
    addFeature(feature) {
        this.features.push(feature);
    }
    /** No-op if no feature currently has this id (e.g. it was already removed, or every feature is
     * id-less) — same "removing something not there is fine" contract as, e.g., Set.delete/Map.delete. */
    removeFeature(id) {
        this.features = this.features.filter((feature) => feature.id !== id);
    }
    setFeatures(features) {
        this.features = features.slice();
    }
    draw(map) {
        super.draw(map); // AFF-4/TiledLayer.draw convention: run the base Layer's onDraw hook too.
        const w = map.canvas.width;
        const h = map.canvas.height;
        // Computed once per draw() call, same as TiledLayer's gridMatrix (see getLevelParams) — every
        // feature this frame is placed through this one matrix, so a moving camera/layer transform
        // can't tear features drawn earlier in the loop from ones drawn later.
        const matrix = computeLayerToScreenMatrix(map.camera, this.transform, w, h);
        const ctx = map.ctx;
        for (const feature of this.features) {
            const geometry = feature.geometry;
            // ROT-4 lesson (see BACKLOG.md): every coordinate below is transformed by hand through
            // `matrix.transformPoint`/`transformRing` BEFORE it reaches ctx.moveTo/lineTo/arc — never
            // via ctx.setTransform(matrix) plus drawing in the geometry's own local coordinates. At
            // deep zoom, local coordinates here (like tile indices) run into the 10^5-10^6 range, and
            // `ctx.setTransform` bakes the *combined* translation into the canvas's internal transform,
            // which the rasterizer stores in float32 — a thin stroke's sub-pixel offset in local space
            // rounds away to nothing at that magnitude and the stroke silently vanishes (this exact bug
            // was already hit and fixed twice in this codebase: map_grid's grid lines and
            // drawTileDebug's tile outlines, both in src/layers.ts). Transforming points ourselves in
            // JS double precision and handing the rasterizer already-small screen coordinates sidesteps
            // the problem entirely, the same way those two fixes do.
            switch (geometry.type) {
                case 'Point': {
                    const p = transformCoordinate(geometry.coordinates, matrix);
                    ctx.beginPath();
                    ctx.fillStyle = VECTOR_LAYER_POINT_COLOR;
                    ctx.arc(p.x, p.y, POINT_RADIUS_PX, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                }
                case 'LineString': {
                    const points = transformRing(geometry.coordinates, matrix);
                    if (points.length === 0)
                        break;
                    ctx.beginPath();
                    ctx.strokeStyle = VECTOR_LAYER_LINE_COLOR;
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++)
                        ctx.lineTo(points[i].x, points[i].y);
                    ctx.stroke();
                    break;
                }
                case 'Polygon':
                case 'MultiPolygon': {
                    // One beginPath()/one fill() across every ring (outer + holes, and — for MultiPolygon —
                    // every polygon), using the `evenodd` fill rule: a point inside an odd number of rings
                    // is filled, an even number (e.g. inside an outer ring AND inside a hole ring cut into
                    // it) is not. That makes holes render correctly regardless of each ring's winding
                    // order, without this MVP needing its own ring-orientation bookkeeping.
                    const rings = getPolygonRingsScreenPoints(geometry, matrix);
                    ctx.beginPath();
                    ctx.fillStyle = VECTOR_LAYER_FILL_COLOR;
                    for (const ring of rings) {
                        if (ring.length === 0)
                            continue;
                        ctx.moveTo(ring[0].x, ring[0].y);
                        for (let i = 1; i < ring.length; i++)
                            ctx.lineTo(ring[i].x, ring[i].y);
                        ctx.closePath();
                    }
                    ctx.fill('evenodd');
                    break;
                }
            }
        }
    }
}
//# sourceMappingURL=vector_layer.js.map
/// VectorLayer ///////////////////////////////////////////////////////////////////////////////////
// VEC-1: a Layer that draws GeoJSON-shaped Point/LineString/Polygon/MultiPolygon geometry, in the
// same per-layer coordinate system AFF-4 gave TiledLayer (this.transform, composed with the
// camera once per draw() call into a single Mat2D — see computeLayerToScreenMatrix in map.ts).
//
// VEC-2 adds data-driven per-feature styling (fill/stroke/width/dash/icon, plus zoom-dependent
// visibility via the style callback inspecting map.zoom_factor) on top of that.
//
// VEC-4 adds hit-testing (getFeatureAt: point-in-polygon, distance-to-segment, point/icon
// bounding-box) and click/hover interactivity (enableFeatureEvents), working directly against
// `this.features` — still just a plain in-memory array. Still fixed-in-advance, out of scope here
// (see BACKLOG.md, "Фаза 7"): any notion of a data *source* — static or tiled (VEC-3a/b/c),
// billboard labels (VEC-6), and the demo wiring in src/layers.ts/src/index.ts (VEC-7).
// VectorSource (VEC-3a) is a separate later abstraction, not anticipated here.
import { computeLayerToScreenMatrix, isTap, Layer } from './map.js';
import { VECTOR_LAYER_FILL_COLOR, VECTOR_LAYER_LINE_COLOR, VECTOR_LAYER_POINT_COLOR } from './defines.js';
// Fixed MVP visual size of a Point marker, in on-screen CSS pixels — NOT scaled by the layer/
// camera matrix (deliberately: geometry coordinates are matrix-transformed per point below, but
// this radius is applied afterwards, directly in screen space, the same way a marker/icon would
// be in any other map library).
const POINT_RADIUS_PX = 4;
// VEC-4: floors on how small a click/hover target a feature can present, independent of how small
// it's actually drawn. Without these, a feature styled with e.g. `pointRadius: 1` or a hairline
// `lineWidth` would be effectively unclickable — real map libraries (Leaflet et al.) apply the same
// kind of minimum hit-target padding for exactly this reason. Purely a hit-testing concept: neither
// constant ever affects draw() above.
const MIN_HIT_RADIUS_PX = 8; // minimum click radius around a Point, even if drawn smaller
const MIN_LINE_HIT_TOLERANCE_PX = 5; // minimum click distance-to-line, even if drawn thinner
// VEC-1's fixed behavior, preserved bit-for-bit as the per-geometry-type merge-in default for
// whatever a feature's style leaves unset (see the switch in draw() below) — including when
// VectorLayerOptions.style is omitted entirely (DEFAULT_STYLE_FN just returns `{}`, i.e. "use
// every default"), which is the regression contract this ticket must not break. Note these
// defaults are geometry-type-dependent, NOT one fixed set: a Point's default `fillStyle` is
// VECTOR_LAYER_POINT_COLOR while a Polygon's is VECTOR_LAYER_FILL_COLOR (same FeatureStyle field,
// different fallback), and a Polygon's `strokeStyle` has NO fallback at all — omitting it means no
// outline is drawn (exactly today's behavior), whereas a LineString's `strokeStyle` falls back to
// VECTOR_LAYER_LINE_COLOR. That asymmetry is why there's no single "resolve style" helper below:
// each geometry case in draw() applies its own defaults inline.
const DEFAULT_LINE_WIDTH = 1;
const DEFAULT_DASH = [];
/** The `style` VectorLayer uses when none is passed to its constructor: an empty override for
 * every feature, so every geometry case in draw() falls all the way back to its own fixed
 * default — i.e. exactly VEC-1's old hard-coded drawing, expressed as a (feature, map) =>
 * FeatureStyle callback like every other style (never null/undefined, so nothing is ever
 * skipped). */
const DEFAULT_STYLE_FN = () => ({});
/** `CanvasImageSource` is a union of several DOM image-ish types; this picks out the "natural"
 * width/height each of them actually exposes, without assuming they all share one shape. Falls
 * back to [0, 0] for a source this MVP doesn't special-case (e.g. SVGImageElement/VideoFrame) —
 * such a source needs an explicit `iconSize` anyway, since there's no single reliable natural-size
 * field to read for it. */
export function getNaturalIconSize(icon) {
    var _a, _b;
    if (typeof HTMLImageElement !== 'undefined' && icon instanceof HTMLImageElement) {
        return [icon.naturalWidth, icon.naturalHeight];
    }
    if (typeof HTMLCanvasElement !== 'undefined' && icon instanceof HTMLCanvasElement) {
        return [icon.width, icon.height];
    }
    if (typeof HTMLVideoElement !== 'undefined' && icon instanceof HTMLVideoElement) {
        return [icon.videoWidth, icon.videoHeight];
    }
    if (typeof ImageBitmap !== 'undefined' && icon instanceof ImageBitmap) {
        return [icon.width, icon.height];
    }
    // OffscreenCanvas, and any other CanvasImageSource variant, also exposes width/height directly.
    const sized = icon;
    return [(_a = sized.width) !== null && _a !== void 0 ? _a : 0, (_b = sized.height) !== null && _b !== void 0 ? _b : 0];
}
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
/// Pure, DOM-free hit-test math (VEC-4) ///////////////////////////////////////////////////////////
// Same split-out-for-testability reasoning as the coordinate math above: these never touch a
// CanvasRenderingContext2D or a live MapWidget, so VectorLayer.getFeatureAt's per-geometry-type
// logic can reuse them directly on already-screen-transformed points (see getFeatureAt below).
/** Shortest distance from point `p` to the segment [a, b], in whatever units `p`/`a`/`b` share
 * (screen pixels, in getFeatureAt's use). Degenerates to a plain point-to-point distance when `a`
 * and `b` coincide (a zero-length segment), rather than dividing by zero. */
export function distanceToSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared === 0)
        return Math.hypot(p.x - a.x, p.y - a.y);
    // Project p onto the infinite line through a/b, then clamp the projection to the segment itself
    // (t in [0, 1]) so the result is the distance to the nearest point ON the segment, not the line.
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared));
    return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}
/**
 * Point-in-polygon test over a set of already screen-transformed rings — the same format
 * getPolygonRingsScreenPoints returns — using the standard ray-casting algorithm under the
 * `evenodd` rule: the SAME rule VectorLayer.draw fills with (`ctx.fill('evenodd')`), and
 * deliberately reimplemented here rather than approximated some other way, specifically so
 * hit-testing and rendering never disagree about where a shape "is". One pass sums crossings
 * across EVERY ring passed in (outer rings and holes alike, and — for a MultiPolygon — every
 * polygon's rings together) exactly like the single evenodd-filled path draw() builds, rather than
 * testing each ring in isolation: that's what makes an odd number of ring-crossings (inside the
 * shape) read as "inside" and an even number (e.g. inside an outer ring AND inside a hole cut into
 * it) read as "outside", matching the fill exactly.
 */
export function pointInRings(p, rings) {
    let inside = false;
    for (const ring of rings) {
        const n = ring.length;
        if (n < 3)
            continue;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = ring[i];
            const b = ring[j];
            const straddles = a.y > p.y !== b.y > p.y;
            if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
                inside = !inside;
            }
        }
    }
    return inside;
}
/// VectorLayer //////////////////////////////////////////////////////////////////////////////////
export class VectorLayer extends Layer {
    constructor(options) {
        super(options);
        this.features = (options && options.features && options.features.slice()) || [];
        this.style = (options && options.style) || DEFAULT_STYLE_FN;
        this.onFeatureClick = options && options.onFeatureClick;
        this.onFeatureHover = options && options.onFeatureHover;
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
            // VEC-2: `null`/`undefined` from the style callback means "don't draw this feature at all"
            // this frame — this is also how zoom-dependent styling works (the callback itself looks at
            // map.zoom_factor and returns nothing for features too small/insignificant to show). Any
            // FeatureStyle field a *drawn* feature's style leaves unset falls back to VEC-1's original
            // fixed default for that field/geometry combination inline below (see the DEFAULT_LINE_WIDTH
            // comment above for why that fallback is geometry-dependent, not one fixed set).
            const style = this.style(feature, map);
            if (!style)
                continue;
            // ctx.lineWidth/ctx.setLineDash are canvas *state*, not per-call arguments — unlike
            // fillStyle/strokeStyle (already reassigned unconditionally below), they persist across
            // stroke() calls, across features, and across other layers sharing this same ctx (map.ctx is
            // one CanvasRenderingContext2D for the whole frame). A feature that sets `dash`/`lineWidth`
            // must not leak them onto the next feature's stroke — so both are set unconditionally before
            // every stroke() below (falling back to DEFAULT_DASH/DEFAULT_LINE_WIDTH when this feature's
            // own style doesn't specify them), never left as "whatever the previous feature left behind".
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
                    if (style.icon) {
                        const [iw, ih] = (_a = style.iconSize) !== null && _a !== void 0 ? _a : getNaturalIconSize(style.icon);
                        // Center the icon on the same screen point a plain circle marker would occupy —
                        // drawImage takes a top-left corner, so offset by half the (possibly custom) size.
                        ctx.drawImage(style.icon, p.x - iw / 2, p.y - ih / 2, iw, ih);
                    }
                    else {
                        ctx.beginPath();
                        ctx.fillStyle = (_b = style.fillStyle) !== null && _b !== void 0 ? _b : VECTOR_LAYER_POINT_COLOR;
                        ctx.arc(p.x, p.y, (_c = style.pointRadius) !== null && _c !== void 0 ? _c : POINT_RADIUS_PX, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    break;
                }
                case 'LineString': {
                    const points = transformRing(geometry.coordinates, matrix);
                    if (points.length === 0)
                        break;
                    ctx.beginPath();
                    ctx.strokeStyle = (_d = style.strokeStyle) !== null && _d !== void 0 ? _d : VECTOR_LAYER_LINE_COLOR;
                    ctx.lineWidth = (_e = style.lineWidth) !== null && _e !== void 0 ? _e : DEFAULT_LINE_WIDTH;
                    ctx.setLineDash((_f = style.dash) !== null && _f !== void 0 ? _f : DEFAULT_DASH);
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
                    ctx.fillStyle = (_g = style.fillStyle) !== null && _g !== void 0 ? _g : VECTOR_LAYER_FILL_COLOR;
                    for (const ring of rings) {
                        if (ring.length === 0)
                            continue;
                        ctx.moveTo(ring[0].x, ring[0].y);
                        for (let i = 1; i < ring.length; i++)
                            ctx.lineTo(ring[i].x, ring[i].y);
                        ctx.closePath();
                    }
                    ctx.fill('evenodd');
                    // Unlike LineString, a Polygon/MultiPolygon outline is opt-in: only drawn when this
                    // feature's own style explicitly sets `strokeStyle` (no fallback color here — that's
                    // the difference from the LineString case above) — same path, same rings, stroked over
                    // the fill without an intervening beginPath()/fill() reset.
                    if (style.strokeStyle) {
                        ctx.strokeStyle = style.strokeStyle;
                        ctx.lineWidth = (_h = style.lineWidth) !== null && _h !== void 0 ? _h : DEFAULT_LINE_WIDTH;
                        ctx.setLineDash((_j = style.dash) !== null && _j !== void 0 ? _j : DEFAULT_DASH);
                        ctx.stroke();
                    }
                    break;
                }
            }
        }
        // ctx.lineWidth/ctx.setLineDash are shared canvas *state*, not scoped to this draw() call —
        // the per-feature reset above (unconditional before every stroke()) only keeps features within
        // THIS layer from bleeding onto each other. Without this, the last feature drawn above (if it
        // set a custom lineWidth/dash) would leave that state on map.ctx for whatever layer draws next
        // this frame (e.g. map_grid/drawTileDebug in src/layers.ts, neither of which sets its own
        // lineWidth/dash — they rely on the canvas's ambient default, exactly what this restores) —
        // the same class of leak as the per-feature case, just at this layer's own outer boundary.
        ctx.lineWidth = DEFAULT_LINE_WIDTH;
        ctx.setLineDash(DEFAULT_DASH);
    }
    /**
     * VEC-4: which feature, if any, sits under `screenPoint` (actual canvas pixel coordinates,
     * top-left origin — the same domain as `event.offsetX/offsetY` and MapWidget.screenToWorld's
     * input). Compares in already screen-transformed space — the geometry is run through the exact
     * same matrix/transform* helpers draw() uses, rather than inverting the matrix and comparing in
     * this layer's local coordinates — specifically so hit-testing reuses code draw() already
     * exercises instead of adding new, separately-tested inverse math.
     *
     * An invisible layer (`!this.visible`) never reports a hit — same "what's not drawn can't be
     * clicked" contract as a feature whose own style() returns null/undefined below (this is also why
     * this method calls `this.style(feature, map)` per feature, exactly like draw() does: a feature
     * hidden by its own style at the current zoom is exactly as unclickable as one hidden by the
     * layer being invisible altogether).
     *
     * Iterates `this.features` back-to-front: draw() paints features in array order, so the LAST one
     * drawn is the one visually on top at any point two features overlap — checking from the end
     * means the first hit found is also the topmost one, matching what's actually visible under the
     * cursor.
     */
    getFeatureAt(screenPoint, map) {
        var _a, _b, _c;
        if (!this.visible)
            return undefined;
        const matrix = computeLayerToScreenMatrix(map.camera, this.transform, map.canvas.width, map.canvas.height);
        for (let i = this.features.length - 1; i >= 0; i--) {
            const feature = this.features[i];
            const style = this.style(feature, map);
            if (!style)
                continue; // not drawn this frame => not hittable, exactly like draw()'s own skip.
            const geometry = feature.geometry;
            switch (geometry.type) {
                case 'Point': {
                    const p = transformCoordinate(geometry.coordinates, matrix);
                    if (style.icon) {
                        // Same top-left-corner math draw() uses for ctx.drawImage — a point is "hit" when the
                        // cursor falls inside the icon's on-screen bounding box, not just within some radius.
                        const [iw, ih] = (_a = style.iconSize) !== null && _a !== void 0 ? _a : getNaturalIconSize(style.icon);
                        const left = p.x - iw / 2;
                        const top = p.y - ih / 2;
                        if (screenPoint.x >= left && screenPoint.x <= left + iw && screenPoint.y >= top && screenPoint.y <= top + ih) {
                            return feature;
                        }
                    }
                    else {
                        const radius = Math.max((_b = style.pointRadius) !== null && _b !== void 0 ? _b : POINT_RADIUS_PX, MIN_HIT_RADIUS_PX);
                        if (Math.hypot(screenPoint.x - p.x, screenPoint.y - p.y) <= radius)
                            return feature;
                    }
                    break;
                }
                case 'LineString': {
                    const points = transformRing(geometry.coordinates, matrix);
                    const tolerance = Math.max(((_c = style.lineWidth) !== null && _c !== void 0 ? _c : DEFAULT_LINE_WIDTH) / 2, MIN_LINE_HIT_TOLERANCE_PX);
                    for (let j = 1; j < points.length; j++) {
                        if (distanceToSegment(screenPoint, points[j - 1], points[j]) <= tolerance)
                            return feature;
                    }
                    break;
                }
                case 'Polygon':
                case 'MultiPolygon': {
                    const rings = getPolygonRingsScreenPoints(geometry, matrix);
                    if (pointInRings(screenPoint, rings))
                        return feature;
                    break;
                }
            }
        }
        return undefined;
    }
    /**
     * VEC-4: wires this layer's `onFeatureClick`/`onFeatureHover` (if any — either or both may be
     * unset, in which case this just attaches listeners that never call anything) to live mouse
     * events on `map.canvas`. Not called automatically anywhere — `Layer` has no "added to a map"
     * lifecycle hook (deliberately out of MVP scope, see the class comment), and the constructor
     * doesn't know about `map` at all — so a host that wants click/hover behavior must call this
     * itself once the layer and map both exist, the same way DEMO-6 (src/index.ts) adds its own
     * `document.addEventListener('keydown', ...)` alongside MapWidget's own internal handler rather
     * than replacing it: these listeners coexist with whatever MapWidget.constructor already attached
     * to this same canvas (pan/zoom/rotate), they don't touch or replace those.
     *
     * Hover fires `onFeatureHover` only when the feature under the cursor actually changes (by
     * object reference, `undefined` included) — not on every mousemove over the same feature.
     *
     * Click deliberately does NOT use a plain 'click' listener: a native DOM click fires whenever
     * mousedown and mouseup land on the same element, even if the mouse moved a lot in between (e.g.
     * a drag-pan of the map) — unlike this file's touch handling, plain mouse movement doesn't
     * suppress it on its own. Using 'click' directly would misfire a feature click after every
     * drag-pan release. Instead this reuses `isTap` (src/map.ts) — the exact same duration/movement
     * gate already used to distinguish a touch tap from a touch drag — measured between this
     * listener's own mousedown and mouseup, so a real click (fast, near-stationary) fires
     * onFeatureClick, while mouseup after a drag-pan does not. A click that lands on no feature
     * simply calls nothing (unlike hover, there is no `undefined` "clicked on nothing" case).
     *
     * Returns an unsubscribe function that removes every listener this call added — ordinary cleanup
     * hygiene, useful for tests and for any future caller (e.g. VEC-7) that needs to detach.
     */
    enableFeatureEvents(map) {
        let hoveredFeature;
        let mouseDownStart = null;
        const handleMouseMove = (e) => {
            const feature = this.getFeatureAt({ x: e.offsetX, y: e.offsetY }, map);
            if (feature !== hoveredFeature) {
                hoveredFeature = feature;
                if (this.onFeatureHover)
                    this.onFeatureHover(feature, map);
            }
        };
        const handleMouseDown = (e) => {
            mouseDownStart = { time: performance.now(), pos: { x: e.offsetX, y: e.offsetY } };
        };
        const handleMouseUp = (e) => {
            if (!mouseDownStart)
                return;
            const pos = { x: e.offsetX, y: e.offsetY };
            const duration = performance.now() - mouseDownStart.time;
            const movement = Math.hypot(pos.x - mouseDownStart.pos.x, pos.y - mouseDownStart.pos.y);
            mouseDownStart = null;
            if (!isTap(duration, movement))
                return; // a drag-pan's mouseup, not a real click.
            const feature = this.getFeatureAt(pos, map);
            if (feature && this.onFeatureClick)
                this.onFeatureClick(feature, map);
        };
        map.canvas.addEventListener('mousemove', handleMouseMove);
        map.canvas.addEventListener('mousedown', handleMouseDown);
        map.canvas.addEventListener('mouseup', handleMouseUp);
        return () => {
            map.canvas.removeEventListener('mousemove', handleMouseMove);
            map.canvas.removeEventListener('mousedown', handleMouseDown);
            map.canvas.removeEventListener('mouseup', handleMouseUp);
        };
    }
}
//# sourceMappingURL=vector_layer.js.map
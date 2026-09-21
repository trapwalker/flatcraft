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
// `this.features` — still just a plain in-memory array.
//
// VEC-6 adds per-feature billboard text labels (FeatureStyle.label/labelColor, drawn via
// ctx.fillText at a geometry-type-dependent anchor point — see computeLabelAnchor below). "Billboard"
// here needs NO special mechanism at all, unlike a typical map library where un-rotating text against
// a rotating map view takes deliberate work: this codebase's canvas is NEVER globally rotated in the
// first place (no ctx.rotate/ctx.setTransform on the camera's angle anywhere — see the ROT-4
// retrospective in BACKLOG.md and the "never calls ctx.setTransform" comment/test below) — every
// geometry coordinate is hand-transformed into a screen point BEFORE it reaches a ctx drawing call,
// so the whole canvas is always in plain screen space. Text drawn with ctx.fillText at an already-
// computed screen point is therefore automatically billboard (it never rotates with the map) with no
// flag or extra transform needed — see BACKLOG.md's ROT-4-billboard retrospective, which reached the
// same conclusion for drawTileDebug's debug labels ("a separate `billboard: boolean` flag wasn't
// needed — 'don't rotate, but position correctly' was the only sensible behavior"). VEC-6's job is
// exactly that "position correctly" half: computing the right anchor point per geometry type.
//
// Still fixed-in-advance, out of scope here (see BACKLOG.md, "Фаза 7"): any notion of a data
// *source* — static or tiled (VEC-3a/b/c) — and the demo wiring in src/layers.ts/src/index.ts
// (VEC-7, already done separately). VectorSource (VEC-3a) is a separate later abstraction, not
// anticipated here.
import { computeLayerToScreenMatrix, isTap, Layer } from './map.js';
import { VECTOR_LAYER_FILL_COLOR, VECTOR_LAYER_LABEL_COLOR, VECTOR_LAYER_LINE_COLOR, VECTOR_LAYER_POINT_COLOR } from './defines.js';
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
// VEC-6: fixed MVP label appearance — not exposed through FeatureStyle (only the label text and
// color are data-driven; see FeatureStyle.label/labelColor above). This is a deliberate scope
// decision for this S-sized ticket, not an oversight: a real font/offset-per-style knob can follow
// later if a use case actually needs it.
const LABEL_FONT = '12px sans-serif';
const LABEL_OFFSET_PX = 4; // gap between a feature's own anchor point and its label text
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
/** Where (and how to align) a feature's billboard label, given its geometry, its resolved style
 * (only pointRadius/icon/iconSize are read — label/labelColor are the caller's concern), and the
 * same screen-transform matrix draw() itself uses. `undefined` means there is nothing sensible to
 * anchor a label to (currently: only an empty LineString) — the caller should draw no label at all
 * in that case, exactly like the geometry itself draws nothing. */
export function computeLabelAnchor(geometry, style, matrix) {
    var _a, _b, _c;
    switch (geometry.type) {
        case 'Point': {
            const p = transformCoordinate(geometry.coordinates, matrix);
            // Half the on-screen size of whatever the point itself is actually drawn as (icon height, or
            // circle radius) — same values draw()'s own Point case reads, so the label sits flush above
            // the marker regardless of which one is in play.
            const halfHeight = style.icon
                ? ((_a = style.iconSize) !== null && _a !== void 0 ? _a : getNaturalIconSize(style.icon))[1] / 2
                : ((_b = style.pointRadius) !== null && _b !== void 0 ? _b : POINT_RADIUS_PX);
            return {
                point: { x: p.x, y: p.y - halfHeight - LABEL_OFFSET_PX },
                textAlign: 'center',
                textBaseline: 'bottom'
            };
        }
        case 'LineString': {
            const points = transformRing(geometry.coordinates, matrix);
            if (points.length === 0)
                return undefined; // nothing drawn => nothing to anchor a label to.
            // MVP simplification, deliberate (not something to improve within this ticket): anchored at
            // the vertex at the MIDDLE INDEX of the line's point list, not the point at half the line's
            // actual path length — for an evenly-spaced line these agree, but for one with very uneven
            // segment lengths they can differ noticeably. Good enough for the S-sized scope here.
            const mid = points[Math.floor(points.length / 2)];
            return { point: { x: mid.x, y: mid.y - LABEL_OFFSET_PX }, textAlign: 'center', textBaseline: 'bottom' };
        }
        case 'Polygon':
        case 'MultiPolygon': {
            // MVP simplification, deliberate (not something to improve within this ticket): only the
            // OUTER ring of the FIRST polygon gets a label anchor — a Polygon's holes never affect it (a
            // label centroid ignoring holes is a reasonable MVP choice, same spirit as the hole-oblivious
            // bounding-box shortcuts elsewhere in this file), and a MultiPolygon's other parts get no
            // label of their own at all. Proper multi-part label placement is out of scope here.
            const outerRing = geometry.type === 'Polygon' ? geometry.coordinates[0] : (_c = geometry.coordinates[0]) === null || _c === void 0 ? void 0 : _c[0];
            if (!outerRing || outerRing.length === 0)
                return undefined;
            const screenRing = transformRing(outerRing, matrix);
            // GeoJSON rings are closed (coordinates[0] === coordinates[n-1]): drop that duplicated closing
            // point before averaging, or it would double-count the first vertex and skew the centroid
            // toward it. A ring with only that one (degenerate) point left after dropping it has nothing
            // to average — same "nothing to anchor to" outcome as the empty-LineString case above.
            const n = screenRing.length > 1 ? screenRing.length - 1 : screenRing.length;
            if (n === 0)
                return undefined;
            let sumX = 0;
            let sumY = 0;
            for (let i = 0; i < n; i++) {
                sumX += screenRing[i].x;
                sumY += screenRing[i].y;
            }
            return { point: { x: sumX / n, y: sumY / n }, textAlign: 'center', textBaseline: 'middle' };
        }
    }
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
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
            // VEC-6: the label is drawn AFTER the feature's own geometry (shape first, label on top —
            // same paint order as everything else in this file), and only when style resolved a non-
            // empty label string; a feature with no `label` set draws nothing extra here at all.
            if (style.label) {
                const anchor = computeLabelAnchor(geometry, style, matrix);
                if (anchor) {
                    // ctx.font/textAlign/textBaseline are canvas *state*, exactly like lineWidth/dash above
                    // (see that comment) — set unconditionally on every label rather than assumed left over
                    // from a previous feature or a previous layer's drawing.
                    ctx.font = LABEL_FONT;
                    ctx.fillStyle = (_k = style.labelColor) !== null && _k !== void 0 ? _k : VECTOR_LAYER_LABEL_COLOR;
                    ctx.textAlign = anchor.textAlign;
                    ctx.textBaseline = anchor.textBaseline;
                    ctx.fillText(style.label, anchor.point.x, anchor.point.y);
                }
            }
        }
        // VEC-6: ctx.font/textAlign/textBaseline are shared canvas *state* too, just like
        // lineWidth/dash below — reset to the plain canvas defaults so a layer drawn after this one
        // doesn't inherit whatever the last label left behind. Unlike the lineWidth/dash reset (which
        // fixes a real, already-hit cross-layer leak — see VEC-2's retrospective in BACKLOG.md), no such
        // leak from THIS state is known to matter today — src/layers.ts's drawTileDebug/drawDebugInfo
        // already set their own font/textAlign unconditionally before every use (confirmed via `grep`
        // while building this ticket) — but the same discipline is applied here anyway, for whatever
        // less careful layer comes next.
        //
        // Found during independent review (not caught by this file's own DOM-free mock ctx, which
        // accepts any string as a plain property write): `ctx.font = ''` is NOT a working reset on a
        // real CanvasRenderingContext2D. Per the HTML spec, assigning `font` a value that fails to parse
        // as a CSS <font> shorthand is ignored outright — the property silently keeps its previous
        // value. An empty string is not a valid <font> value (a <font> shorthand requires at least a
        // size and a family), so `ctx.font = ''` here would leave the *previous* label's font (e.g.
        // '12px sans-serif') in effect on a real browser, not reset anything — the mock ctx has no such
        // validation, so a test asserting `ctx.font === ''` after this line passes despite the real
        // implementation doing nothing. '10px sans-serif' is the actual spec-default initial value of
        // `font` on a fresh 2D context, and — unlike '' — is itself a valid <font> value, so assigning
        // it here really does take effect.
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
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
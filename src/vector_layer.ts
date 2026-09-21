/// VectorLayer ///////////////////////////////////////////////////////////////////////////////////
// VEC-1: a Layer that draws GeoJSON-shaped Point/LineString/Polygon/MultiPolygon geometry, in the
// same per-layer coordinate system AFF-4 gave TiledLayer (this.transform, composed with the
// camera once per draw() call into a single Mat2D — see computeLayerToScreenMatrix in map.ts).
//
// VEC-2 adds data-driven per-feature styling (fill/stroke/width/dash/icon, plus zoom-dependent
// visibility via the style callback inspecting map.zoom_factor) on top of that. Still fixed-in-
// advance, out of scope here (see BACKLOG.md, "Фаза 7"): any notion of a data *source* — static or
// tiled (VEC-3a/b/c), hit-testing/click events (VEC-4), billboard labels (VEC-6), and the demo
// wiring in src/layers.ts/src/index.ts (VEC-7). `features` below is therefore just a plain
// in-memory array — VectorSource (VEC-3a) is a separate later abstraction, not anticipated here.

import type { Mat2D } from './mat2d.js';
import { computeLayerToScreenMatrix, Layer } from './map.js';
import type { LayerOptions, MapWidget } from './map.js';
import { VECTOR_LAYER_FILL_COLOR, VECTOR_LAYER_LINE_COLOR, VECTOR_LAYER_POINT_COLOR } from './defines.js';

/// Geometry /////////////////////////////////////////////////////////////////////////////////////
// GeoJSON-*shaped* (same coordinate nesting/field names, so a real GeoJSON `Feature.geometry`
// object drops straight in), but NOT GeoJSON-*valued*: GeoJSON coordinates are always lon/lat
// (WGS84) pairs. There is no projection layer in this codebase yet (see BACKLOG.md's `PROJ-*`,
// "Аудит: от прототипа к виджету") — every other coordinate this codebase touches (`Vector`,
// `MapWidget.c`, tile indices via `world_tile_edge`) is a "shared world" unit, i.e. a pixel
// position on the deepest tile-pyramid level (`zoom_level_max`), not a lon/lat pair. `Geometry`
// coordinates here follow that same convention deliberately, for consistency with the rest of the
// map: this is a conscious MVP limitation (real lon/lat GeoJSON needs `PROJ-*` first to be usable
// with this layer, not a forgotten detail), not an accident of copying the GeoJSON spec verbatim.
export interface PointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

// Rings follow the GeoJSON convention: `coordinates[0]` is the outer ring, every further ring is
// a hole cut out of it. Winding order is deliberately NOT relied on (see the `evenodd` fill rule
// used in `VectorLayer.draw` below) — a hole ring can be wound either way and still render
// correctly, which keeps this MVP from needing its own ring-orientation validation/repair pass.
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

export type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

/// Feature //////////////////////////////////////////////////////////////////////////////////////
// Deliberately source-agnostic: a Feature carries only its own geometry/properties, nothing about
// where it came from. That's what lets the *same* type serve both a "whole dataset" static source
// (VEC-3a) and a single tile's worth of features from a tiled vector source (VEC-3b) without
// either one needing a different shape — see BACKLOG.md's VEC-1 note.
export interface Feature<G extends Geometry = Geometry> {
  id?: string | number;
  geometry: G;
  properties?: Record<string, unknown>;
}

/// Style (VEC-2) /////////////////////////////////////////////////////////////////////////////////
// Per-feature, data-driven styling in the Leaflet/OpenLayers `style(feature)` tradition. Every
// field here is optional: whatever a feature's resolved style leaves unset falls back to the same
// fixed constants/defaults VEC-1 hard-coded (see resolveFeatureStyle below) — "leave a field out"
// and "the callback returns null/undefined for the whole feature" are deliberately different
// things (merge-with-defaults vs. don't draw this feature at all this frame).
export interface FeatureStyle {
  fillStyle?: string; // Polygon/MultiPolygon fill, and Point circle fill (when no `icon` is set).
  strokeStyle?: string; // LineString stroke, and an optional Polygon/MultiPolygon outline.
  lineWidth?: number; // ctx.lineWidth for both LineString strokes and polygon outlines.
  dash?: number[]; // ctx.setLineDash — [] or undefined means a solid line.
  pointRadius?: number; // Point circle radius in CSS pixels — not matrix-scaled, same as VEC-1.
  icon?: CanvasImageSource; // If set, Point is drawn via ctx.drawImage instead of a filled circle.
  iconSize?: [number, number]; // drawImage width/height; defaults to the image's natural size.
}

/**
 * `null`/`undefined` for a given feature means "don't draw this feature at all" — this is also how
 * zoom-dependent styling is meant to work: the callback inspects `map.zoom_factor` itself and
 * returns nothing for features too small/insignificant to show at the current zoom. Any field a
 * returned FeatureStyle leaves unset merges with VEC-1's original fixed defaults instead (see
 * resolveFeatureStyle) — "no style" (the whole callback result) and "a style with some fields
 * missing" are different things on purpose.
 */
export type FeatureStyleFn = (feature: Feature, map: MapWidget) => FeatureStyle | null | undefined;

export interface VectorLayerOptions extends LayerOptions {
  features?: Feature[];
  // Omitted entirely => every feature renders exactly as VEC-1 did (see DEFAULT_STYLE_FN below) —
  // this is the ticket's regression contract, not a coincidence of the defaults picked.
  style?: FeatureStyleFn;
}

// Fixed MVP visual size of a Point marker, in on-screen CSS pixels — NOT scaled by the layer/
// camera matrix (deliberately: geometry coordinates are matrix-transformed per point below, but
// this radius is applied afterwards, directly in screen space, the same way a marker/icon would
// be in any other map library).
const POINT_RADIUS_PX = 4;

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
const DEFAULT_DASH: number[] = [];

/** The `style` VectorLayer uses when none is passed to its constructor: an empty override for
 * every feature, so every geometry case in draw() falls all the way back to its own fixed
 * default — i.e. exactly VEC-1's old hard-coded drawing, expressed as a (feature, map) =>
 * FeatureStyle callback like every other style (never null/undefined, so nothing is ever
 * skipped). */
const DEFAULT_STYLE_FN: FeatureStyleFn = () => ({});

/** `CanvasImageSource` is a union of several DOM image-ish types; this picks out the "natural"
 * width/height each of them actually exposes, without assuming they all share one shape. Falls
 * back to [0, 0] for a source this MVP doesn't special-case (e.g. SVGImageElement/VideoFrame) —
 * such a source needs an explicit `iconSize` anyway, since there's no single reliable natural-size
 * field to read for it. */
function getNaturalIconSize(icon: CanvasImageSource): [number, number] {
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
  const sized = icon as unknown as { width?: number; height?: number };
  return [sized.width ?? 0, sized.height ?? 0];
}

/// Pure, DOM-free coordinate math /////////////////////////////////////////////////////////////////
// Split out from draw() below specifically so it's unit-testable without a live/mocked
// CanvasRenderingContext2D — see vector_layer.test.ts.

/** A single [x, y] geometry coordinate, transformed by `matrix` into screen pixels. */
export function transformCoordinate(coordinate: [number, number], matrix: Mat2D): XY {
  return matrix.transformPoint({ x: coordinate[0], y: coordinate[1] });
}

/** A geometry coordinate ring/line, transformed point-by-point (never via ctx.setTransform — see
 * VectorLayer.draw's own comment on why). */
export function transformRing(ring: [number, number][], matrix: Mat2D): XY[] {
  return ring.map((coordinate) => transformCoordinate(coordinate, matrix));
}

/**
 * Every ring of a Polygon or MultiPolygon, each already transformed to screen points — flattened
 * across polygons for MultiPolygon (rendering doesn't need to know which rings belong to which
 * polygon: a single `evenodd`-filled path over all of them, outer rings and holes alike, is
 * correct regardless of grouping — see VectorLayer.draw).
 */
export function getPolygonRingsScreenPoints(geometry: PolygonGeometry | MultiPolygonGeometry, matrix: Mat2D): XY[][] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings: XY[][] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      rings.push(transformRing(ring, matrix));
    }
  }
  return rings;
}

/// VectorLayer //////////////////////////////////////////////////////////////////////////////////
export class VectorLayer extends Layer {
  features: Feature[];
  // Defaults to DEFAULT_STYLE_FN (VEC-1's fixed look) when the constructor gets no `style` option
  // at all — see that constant's comment. Never `undefined` on the instance: draw() can always
  // just call `this.style(feature, map)` without an extra "is there a style fn" branch.
  style: FeatureStyleFn;

  constructor(options?: VectorLayerOptions) {
    super(options);
    this.features = (options && options.features && options.features.slice()) || [];
    this.style = (options && options.style) || DEFAULT_STYLE_FN;
  }

  addFeature(feature: Feature): void {
    this.features.push(feature);
  }

  /** No-op if no feature currently has this id (e.g. it was already removed, or every feature is
   * id-less) — same "removing something not there is fine" contract as, e.g., Set.delete/Map.delete. */
  removeFeature(id: string | number): void {
    this.features = this.features.filter((feature) => feature.id !== id);
  }

  setFeatures(features: Feature[]): void {
    this.features = features.slice();
  }

  draw(map: MapWidget): void {
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
      if (!style) continue;

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
            const [iw, ih] = style.iconSize ?? getNaturalIconSize(style.icon);
            // Center the icon on the same screen point a plain circle marker would occupy —
            // drawImage takes a top-left corner, so offset by half the (possibly custom) size.
            ctx.drawImage(style.icon, p.x - iw / 2, p.y - ih / 2, iw, ih);
          } else {
            ctx.beginPath();
            ctx.fillStyle = style.fillStyle ?? VECTOR_LAYER_POINT_COLOR;
            ctx.arc(p.x, p.y, style.pointRadius ?? POINT_RADIUS_PX, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }

        case 'LineString': {
          const points = transformRing(geometry.coordinates, matrix);
          if (points.length === 0) break;
          ctx.beginPath();
          ctx.strokeStyle = style.strokeStyle ?? VECTOR_LAYER_LINE_COLOR;
          ctx.lineWidth = style.lineWidth ?? DEFAULT_LINE_WIDTH;
          ctx.setLineDash(style.dash ?? DEFAULT_DASH);
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
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
          ctx.fillStyle = style.fillStyle ?? VECTOR_LAYER_FILL_COLOR;
          for (const ring of rings) {
            if (ring.length === 0) continue;
            ctx.moveTo(ring[0].x, ring[0].y);
            for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
            ctx.closePath();
          }
          ctx.fill('evenodd');
          // Unlike LineString, a Polygon/MultiPolygon outline is opt-in: only drawn when this
          // feature's own style explicitly sets `strokeStyle` (no fallback color here — that's
          // the difference from the LineString case above) — same path, same rings, stroked over
          // the fill without an intervening beginPath()/fill() reset.
          if (style.strokeStyle) {
            ctx.strokeStyle = style.strokeStyle;
            ctx.lineWidth = style.lineWidth ?? DEFAULT_LINE_WIDTH;
            ctx.setLineDash(style.dash ?? DEFAULT_DASH);
            ctx.stroke();
          }
          break;
        }
      }
    }
  }
}

import { Vector } from './vector.js';
import type { Tile, TileSource } from './tile_source.js';
import { isHeatableTileSource } from './tile_source.js';
import { Transform2D } from './transform2d.js';
import { AvgRing } from './tools.js';

/// MapWidget /////////////////////////////////////////////////////////////////////////////////////
// Recognized against both KeyboardEvent.key (works for the numpad too, as long as NumLock is
// on — browsers report "+"/"-" for it just like the main row) and KeyboardEvent.code (covers
// "NumpadAdd"/"NumpadSubtract" specifically, in case a layout ever reports a different `key`).
const DEFAULT_ZOOM_IN_KEYS = ['+', '=', 'NumpadAdd'];
const DEFAULT_ZOOM_OUT_KEYS = ['-', 'NumpadSubtract'];

export interface MapWidgetOptions {
  scrollType?: string;
  location?: Vector;
  onLocate?: (x: number, y: number) => void;
  onZoom?: (zoom: number) => void;
  layers?: Layer[];
  zoom_level_min?: number;
  zoom_level_max?: number;
  zoom_animation_factor?: number;
  zoom_step_factor?: number;
  zoomInKeys?: string[];
  zoomOutKeys?: string[];
}

export class MapWidget { // todo: setup layers
  fps_stat: AvgRing;
  dt_stat: AvgRing;
  layers: Layer[];
  zoom_animation_factor: number;
  zoom_step_factor: number;

  container: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  // AFF-3: world <-> "centered viewport space" (origin at the canvas center, no rotation yet)
  // transform, kept in sync with `c`/`zoom_factor` every frame in onRepaint(). See
  // screenToWorld/worldToScreen below for the remaining step to actual canvas pixel
  // coordinates (top-left origin) — deliberately not folded into `camera` itself, since that
  // offset depends on live canvas.width/height, not on a transform property. AFF-4/ROT-*/VP-*
  // build on this same node (nested layer transforms, rotation, child viewports).
  camera: Transform2D;

  c: Vector; // todo: use property notation with getter and setter
  is_scrolling_now: boolean;
  zoom_level_min: number;
  zoom_level_max: number;
  zoom_min: number; // todo: вычислять на основе слоёв или вынести в настройки...?
  zoom_max: number;
  zoom_factor: number;
  zoom_step: number;
  zoom_target: number;

  onResize_callback: () => void;
  onRepaint_callback: () => void;

  inertion_value: number;
  sliding_value: number;
  scrollType: string;
  location: Vector | string;

  onLocate?: (x: number, y: number) => void;
  onZoom?: (zoom: number) => void;
  zoomInKeys: string[];
  zoomOutKeys: string[];

  private _mouse_move_flag: number;
  private _mouse_down_flag: number;
  private _scroll_velocity: Vector;
  private _dx: number; // todo: rename
  private _dy: number;
  private t?: number;
  // ZOOM-1: screen point (canvas pixel coords) that a zoom gesture should keep fixed in place
  // while zoom_factor eases towards zoom_target across several frames — not just once at the
  // end. Set by the wheel handler to the cursor position; cleared (-> zoom around center) by
  // the keyboard shortcuts, which have no cursor position to anchor to.
  private _zoom_anchor_screen: XY | null;

  constructor(container_id: string, options?: MapWidgetOptions) {
    this.fps_stat = new AvgRing(100);
    this.dt_stat = new AvgRing(100);
    this.layers = (options && options.layers) || []; // todo: скопировать options.layers, привести его к стандартному списку
    this.zoom_animation_factor = (options && options.zoom_animation_factor) || 10; // 1~100
    this.zoom_step_factor = (options && options.zoom_step_factor) || 0.2; // 0.1~0.9

    this.container = document.getElementById(container_id) as HTMLElement; // todo: throw error if not found
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    // todo: add properties: width, height
    this.c = (options && options.location) || new Vector(0, 0);
    this.is_scrolling_now = false;
    this.zoom_level_min = (options && options.zoom_level_min) || 10;
    this.zoom_level_max = (options && options.zoom_level_max) || 18;
    this.zoom_min = 1 / Math.pow(2, this.zoom_level_max - this.zoom_level_min);
    this.zoom_max = 1;
    this.zoom_factor = 1;
    this.zoom_step = (this.zoom_max - this.zoom_min) / 64;
    this.zoom_target = this.zoom_factor;

    this.camera = new Transform2D();
    this.camera.setTranslation(this.c.x, this.c.y);
    this.camera.setScale(1 / this.zoom_factor);

    this.onResize_callback = () => { this.onResize(); }; // todo: узнать и сделать правильным способом
    this.onRepaint_callback = () => { this.onRepaint(); }; // todo: узнать и сделать правильным способом

    this.container.appendChild(this.canvas);

    this.inertion_value = 0.033;
    this.sliding_value = 0.15;
    this._mouse_move_flag = 0;
    this._mouse_down_flag = 0;
    this._scroll_velocity = new Vector(0, 0);

    this.scrollType = (options && options.scrollType) || 'simple';
    this.location = (options && options.location) || 'default';

    this.onLocate = options && options.onLocate;
    this.onZoom = options && options.onZoom;
    this.zoomInKeys = (options && options.zoomInKeys) || DEFAULT_ZOOM_IN_KEYS;
    this.zoomOutKeys = (options && options.zoomOutKeys) || DEFAULT_ZOOM_OUT_KEYS;

    this._dx = 0;
    this._dy = 0;
    this._zoom_anchor_screen = null;

    let old_x = 0;
    let old_y = 0;

    this.canvas.addEventListener('wheel', (e: WheelEvent) => {
      const dy = -e.deltaY;

      // ZOOM-1: keep whatever's under the cursor fixed in place as the zoom eases in.
      this._zoom_anchor_screen = { x: e.offsetX, y: e.offsetY };

      if (dy > 0) this.zoomIn();
      else if (dy < 0) this.zoomOut();

      e.preventDefault();
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.zoomInKeys.includes(e.key) || this.zoomInKeys.includes(e.code)) {
        // No cursor position to anchor a keyboard-triggered zoom to — zoom around the center.
        this._zoom_anchor_screen = null;
        this.zoomIn();
        e.preventDefault();
      } else if (this.zoomOutKeys.includes(e.key) || this.zoomOutKeys.includes(e.code)) {
        this._zoom_anchor_screen = null;
        this.zoomOut();
        e.preventDefault();
      }
    });

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      this._mouse_move_flag = 1;
      this._mouse_down_flag = 1;
      old_x = e.pageX;
      old_y = e.pageY;
    });

    this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (this._mouse_move_flag) {
        this._dx += old_x - e.pageX;
        this._dy += old_y - e.pageY;
        old_x = e.pageX;
        old_y = e.pageY;
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this._mouse_move_flag = 0;
    });

    this.canvas.addEventListener('dblclick', (e: MouseEvent) => {
      // AFF-3: was `e.pageX/pageY` against container-relative w/2,h/2 — only correct when the
      // canvas sits at the page origin with no scroll. `e.offsetX/offsetY` are relative to the
      // canvas itself, which is what screenToWorld expects.
      const worldPoint = this.screenToWorld({ x: e.offsetX, y: e.offsetY });
      this.locate(worldPoint.x, worldPoint.y);

      this.update_url_position();

      e.stopPropagation();
    });

    this.canvas.addEventListener('mouseout', () => {
      this._mouse_move_flag = 0;
    });

    window.onresize = this.onResize_callback;
    // todo: Попробовать повесить событие на ресайз контейнера а не окна. Убедиться, что не затёрли старый обработчик ресайза.

    this.onResize();
    this.onRepaint();
  }

  onResize(): void {
    this.canvas.height = this.container.clientHeight;
    this.canvas.width = this.container.clientWidth;
  }

  onRepaint(): void {
    const t1 = new Date().getTime() / 1000;
    const dt = this.t ? t1 - this.t : NaN;
    const fps = Math.round(1 / dt);
    this.fps_stat.add(fps);
    this.dt_stat.add(dt);
    this.t = t1;

    const layers = this.layers;

    // Time-based (not frame-based) exponential smoothing towards zoom_target: the old
    // `zoom_factor += (target - zoom_factor) / zoom_animation_factor` advanced by a fixed
    // fraction per *frame*, so the same zoom_animation_factor felt slower on a 30fps device
    // than on a 120fps one. `tau` below is calibrated so the feel at a nominal 60fps frame
    // matches the old per-frame formula (its per-frame decay constant was 1/zoom_animation_factor,
    // i.e. a time constant of zoom_animation_factor frames = zoom_animation_factor/60 seconds).
    // dt is clamped: NaN on the very first frame (this.t not set yet), and capped so a long
    // stall (e.g. a backgrounded tab) doesn't make zoom_factor jump straight to zoom_target.
    const zoom_dt = dt && isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 1 / 60;
    const tau = Math.max(this.zoom_animation_factor, 1) / 60;
    const zoom_alpha = 1 - Math.exp(-zoom_dt / tau);
    const old_zoom_factor = this.zoom_factor;
    this.zoom_factor += (this.zoom_target - this.zoom_factor) * zoom_alpha;
    if (Math.abs(this.zoom_target - this.zoom_factor) < Math.pow(2, -18)) {
      // todo: calc cutting edge by current zoom
      this.zoom_factor = this.zoom_target;
    }

    // ZOOM-1: re-anchor `c` so that whatever world point was under `_zoom_anchor_screen` before
    // this frame's zoom step is still under it after — applied every frame the zoom is easing,
    // not just once at the end, so the anchor doesn't drift mid-animation. Derived directly from
    // screenToWorld's formula (world = centered/zoom + c): the drift introduced by changing zoom
    // alone, at a fixed `c`, is `centered * (1/old_zoom - 1/new_zoom)` — subtracting it out of
    // `c` is what keeps `centered` (and so the anchor) pointing at the same world position.
    if (this._zoom_anchor_screen && this.zoom_factor !== old_zoom_factor) {
      const centered = {
        x: this._zoom_anchor_screen.x - this.canvas.width / 2,
        y: this._zoom_anchor_screen.y - this.canvas.height / 2
      };
      const drift = 1 / old_zoom_factor - 1 / this.zoom_factor;
      this.c.x += centered.x * drift;
      this.c.y += centered.y * drift;
    }

    this._dx /= this.zoom_factor;
    this._dy /= this.zoom_factor;

    // Простой скроллинг
    if (this.scrollType === 'simple') this.scroll(this._dx, this._dy);

    // Скроллинг с инерцией
    if (this.scrollType === 'inertial') {
      this.scroll(this._dx, this._dy);

      if (this._mouse_move_flag) {
        this._scroll_velocity.set(this._dx, this._dy);
      } else {
        if (this._scroll_velocity.length2()) this.scroll(this._scroll_velocity.x, this._scroll_velocity.y); // todo: Добавить поддержку вектора

        this._scroll_velocity.div(this.inertion_value + 1);

        if (this._scroll_velocity.length2() < 0.1) this._scroll_velocity.set(0, 0);
      }
    }

    // Скроллинг с инерцией и скольжением
    if (this.scrollType === 'sliding') {
      this.scroll(this._dx, this._dy);
      if (this._mouse_down_flag) this._scroll_velocity.set(0, 0);

      if (this._mouse_move_flag) this._scroll_velocity.add(this._dx * this.sliding_value, this._dy * this.sliding_value);

      if (this._scroll_velocity.length2()) this.c.add(this._scroll_velocity);

      this._scroll_velocity.div(this.inertion_value + 1);

      if (this._scroll_velocity.length2() < 0.1) this._scroll_velocity.set(0, 0);
    }

    this._dx = 0;
    this._dy = 0;

    // AFF-3: keep the camera in sync with this frame's resolved position/zoom. Transform2D's
    // setters no-op when the value hasn't actually changed, so this is cheap even though it
    // runs every frame regardless of whether pan/zoom actually moved this tick.
    this.camera.x = this.c.x;
    this.camera.y = this.c.y;
    this.camera.setScale(1 / this.zoom_factor);

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer.visible) layer.draw(this);
    }

    this._mouse_down_flag = 0;

    window.requestAnimationFrame(this.onRepaint_callback);
  }

  update_url_position(): void {
    // update URL
    const redirect = '#[' + Math.round(this.c.x) + ',' + Math.round(this.c.y) + ']';
    history.pushState('', '', redirect);
  }

  locate(x: XArg, y?: number): void {
    this.c = new Vector(x, y);
    if (this.onLocate) this.onLocate(this.c.x, this.c.y);

    //this.update_url_position();
    // todo: some recalculate?
  }

  scroll(dx: number, dy: number): void {
    this.locate(this.c.x + dx, this.c.y + dy);
  }

  /** Actual canvas pixel coordinates (top-left origin, e.g. from `event.offsetX/offsetY`) -> world coordinates. */
  screenToWorld(screenPoint: XY): XY {
    const centered = { x: screenPoint.x - this.canvas.width / 2, y: screenPoint.y - this.canvas.height / 2 };
    return this.camera.localToWorld(centered);
  }

  /** World coordinates -> actual canvas pixel coordinates (top-left origin). */
  worldToScreen(worldPoint: XY): XY {
    const centered = this.camera.worldToLocal(worldPoint);
    return { x: centered.x + this.canvas.width / 2, y: centered.y + this.canvas.height / 2 };
  }

  zoomIn(): void {
    this.zoom_target = Math.min(this.zoom_target * (1 + this.zoom_step_factor), this.zoom_max);
  }

  zoomOut(): void {
    this.zoom_target = Math.max(this.zoom_target * (1 - this.zoom_step_factor), this.zoom_min);
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/// Layer /////////////////////////////////////////////////////////////////////////////////////////
export interface LayerOptions {
  name?: string;
  shift?: Vector;
  onDraw?: (this: Layer, map: MapWidget) => void;
  visible?: boolean;
  color?: string;
  textColor?: string;
  frameColor?: string;
  [key: string]: unknown;
}

export class Layer {
  name?: string;
  shift: Vector;
  onDraw?: (this: Layer, map: MapWidget) => void;
  visible: boolean;
  options: LayerOptions; // todo: разобраться как лучше интегрировать дополнительные опции

  constructor(options?: LayerOptions) {
    this.name = options && options.name;
    this.shift = (options && options.shift) || new Vector(0, 0);
    this.onDraw = options && options.onDraw;
    this.visible = Boolean(options && (options.visible === undefined ? true : options.visible));
    this.options = options || {};
  }

  draw(map: MapWidget): void {
    if (this.onDraw) {
      this.onDraw(map);
    }
  }
}

/// TiledLayer ////////////////////////////////////////////////////////////////////////////////////
export interface TiledLayerOptions extends LayerOptions {
  tile_source?: TileSource;
  tile_size?: number;
  onTileDraw?: (
    this: TiledLayer,
    map: MapWidget,
    ix: number,
    iy: number,
    iz: number,
    x: number,
    y: number,
    tsize: number,
    tile?: Tile | null
  ) => void; // function(ix, iy, x, y, tile)
  z_max?: number;
}

export interface LevelParams {
  z: number;
  k: number;
  tile_size: number;
  c: Vector;
  tx: number;
  ty: number;
  dx: number;
  dy: number;
}

export class TiledLayer extends Layer {
  tile_source?: TileSource;
  tile_size: number;
  onTileDraw?: TiledLayerOptions['onTileDraw'];
  z_max?: number;

  constructor(options?: TiledLayerOptions) {
    super(options);
    this.tile_source = options && options.tile_source;
    this.tile_size = (options && options.tile_size) || (this.tile_source && this.tile_source.tile_size) || 0;
    this.onTileDraw = options && options.onTileDraw; // function(ix, iy, x, y, tile)
    this.z_max = options && options.z_max;
  }

  getLevelParams(position: Vector, zf: number, w: number, h: number): LevelParams {
    const z = Math.ceil(Math.log2(zf));
    const k = zf / Math.pow(2, z);
    const tile_size = this.tile_size * k;
    const c = position.clone().mul(zf); // todo: use "-this.shift"
    return {
      z: z + (this.z_max || 0),
      k,
      tile_size,
      c,
      tx: Math.floor(c.x / tile_size),
      ty: Math.floor(c.y / tile_size),
      dx: Math.ceil(w / tile_size / 2),
      dy: Math.ceil(h / tile_size / 2)
    };
  }

  draw(map: MapWidget): void {
    super.draw(map);
    const w = map.canvas.width; // todo: use property
    const h = map.canvas.height;

    const level_params = this.getLevelParams(map.c, map.zoom_factor, w, h);
    const z = level_params.z;
    const tile_size = level_params.tile_size;
    const c = level_params.c;
    const tx = level_params.tx;
    const ty = level_params.ty;
    const dx = level_params.dx;
    const dy = level_params.dy;

    for (let y = ty - dy; y <= ty + dy; y++) {
      for (let x = tx - dx; x <= tx + dx; x++) {
        this.tileDraw(
          map,
          x, y, z,
          x * tile_size - c.x + w / 2,
          y * tile_size - c.y + h / 2,
          tile_size
        );
      }
    }

    // LOAD-1: drive background preloading from whatever's actually on screen, instead of
    // requiring call sites to remember to invoke tile_source.heat() themselves (nothing did,
    // previously — see BACKLOG.md). r1 starts right at the visible edge, so the preload ring
    // is the "next ring out" beyond what tileDraw() above already fetched directly.
    if (this.tile_source && isHeatableTileSource(this.tile_source)) {
      const r1 = Math.max(dx, dy);
      this.tile_source.heat(tx, ty, z, r1, r1 * 2);
    }
  }

  tileDraw(map: MapWidget, ix: number, iy: number, iz: number, x: number, y: number, tsize: number): void {
    let tile: Tile | null | undefined;
    if (this.tile_source) tile = this.tile_source.get(ix, iy, iz);

    if (tile && tile.image) {
      map.ctx.drawImage(tile.image, 0, 0, this.tile_size, this.tile_size, x, y, tsize, tsize);
    }

    if (this.onTileDraw) this.onTileDraw(map, ix, iy, iz, x, y, tsize, tile);
  }
}

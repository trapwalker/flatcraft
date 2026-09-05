import { Vector } from './vector.js';
import type { Tile, TileSource } from './tile_source.js';
import { isHeatableTileSource } from './tile_source.js';
import { Transform2D } from './transform2d.js';
import { Mat2D } from './mat2d.js';
import { AvgRing } from './tools.js';

/// MapWidget /////////////////////////////////////////////////////////////////////////////////////
// KEY-1: matched primarily against KeyboardEvent.code (the physical key position — "KeyW",
// "Equal", "BracketLeft" — fixed regardless of the active keyboard layout/language) rather than
// .key (the character the layout actually produces there — e.g. physical "W" reports .key "ц" on
// a Russian ЙЦУКЕН layout, silently breaking any match against the letter 'w'). Direct user
// report: hotkeys stopped responding under a non-Latin layout. .key values are still listed
// alongside (see the keydown handler's `includes(e.key) || includes(e.code)`) purely so a caller
// who passes a custom, `.key`-style array through the options (e.g. a literal '+') keeps working
// — new defaults below are `.code` first.
const DEFAULT_ZOOM_IN_KEYS = ['Equal', 'NumpadAdd', '+', '='];
const DEFAULT_ZOOM_OUT_KEYS = ['Minus', 'NumpadSubtract', '-'];

// Continuous-hold navigation (WASD/arrows/Z/X/Q/E) — distinct from the discrete, one-shot
// zoomInKeys/rotateLeftKeys above (+/-, [/]): these are meant to be held down, like a game
// camera, and re-evaluated every frame in onRepaint rather than acted on once per keydown.
// KEY-1: matched against KeyboardEvent.code exclusively (see the keydown/keyup handlers) — "KeyW"
// etc. is the physical key position, unaffected by layout/language, unlike .key.
const DEFAULT_PAN_UP_KEYS = ['KeyW', 'ArrowUp'];
const DEFAULT_PAN_DOWN_KEYS = ['KeyS', 'ArrowDown'];
const DEFAULT_PAN_LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const DEFAULT_PAN_RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const DEFAULT_ZOOM_IN_HOLD_KEYS = ['KeyX'];
const DEFAULT_ZOOM_OUT_HOLD_KEYS = ['KeyZ'];
const DEFAULT_ROTATE_LEFT_HOLD_KEYS = ['KeyQ'];
const DEFAULT_ROTATE_RIGHT_HOLD_KEYS = ['KeyE'];

// Screen pixels/second, scaled by 1/zoom_factor in use (see onRepaint) so holding a pan key
// feels consistent with mouse-drag panning — the same screen distance per second regardless of
// current zoom, rather than crawling at deep zoom or flying at shallow zoom.
const KEYBOARD_PAN_SPEED_PX_PER_SEC = 600;
// zoom_target is multiplied/divided by this factor per second held — reuses zoomBy()'s existing
// soft-edge clamping (ZOOM_EDGE_SOFTNESS), so holding Z/X into zoom_min/zoom_max eases to a stop
// there too, same as a sustained scroll-wheel would.
const KEYBOARD_ZOOM_RATE_PER_SEC = 2;
// Radians/second while Q/E is held — applied directly into `_drotation` (see onRepaint), the
// same accumulator Shift+drag uses, so it's immediate/un-eased like a drag rather than trailing
// behind a moving target the way rotateBy()'s discrete steps do.
const KEYBOARD_ROTATE_SPEED_RAD_PER_SEC = Math.PI / 2;

// ZOOM-5: fraction of the remaining distance to zoom_min/zoom_max covered by a single step once
// the naive step would cross the boundary — see MapWidget.zoomBy(). Chosen over full rubber-band
// overshoot+spring-back (BACKLOG.md's other option) since it needs no "is the user still
// interacting" timer: pushing further into the limit always just takes a smaller and smaller
// bite out of what's left, asymptotically approaching it rather than slamming into a wall.
const ZOOM_EDGE_SOFTNESS = 0.5;

// Reference |deltaY| magnitude for one wheel step — see the `wheel` listener below. ~100 is what
// Chrome/Firefox/Safari report for a single physical mouse-wheel notch on every OS tested during
// this fix (WheelEvent.DOM_DELTA_PIXEL mode); trackpads report much smaller, continuously-varying
// magnitudes for the same gesture, which is exactly the point of scaling by it rather than
// treating every event as one full step.
const WHEEL_DELTA_PER_STEP = 100;

// ROT-1: radians per pixel of horizontal Shift+drag — chosen so a full 180° turn takes a
// comfortable ~300px drag, not a tuned/measured value.
const ROTATE_DRAG_SENSITIVITY = Math.PI / 300;
// ROT-1: radians per keyboard step (5°) — small enough to nudge, not so small it feels inert.
const ROTATE_KEY_STEP = Math.PI / 36;

export interface MapWidgetOptions {
  scrollType?: string;
  location?: Vector;
  rotation?: number; // ROT-1/ROT-2: initial rotation in radians
  onLocate?: (x: number, y: number) => void;
  onZoom?: (zoom: number) => void;
  layers?: Layer[];
  zoom_level_min?: number;
  zoom_level_max?: number;
  zoom_animation_factor?: number;
  zoom_step_factor?: number;
  zoomInKeys?: string[];
  zoomOutKeys?: string[];
  rotateLeftKeys?: string[];
  rotateRightKeys?: string[];
  resetRotationKeys?: string[];
  panUpKeys?: string[];
  panDownKeys?: string[];
  panLeftKeys?: string[];
  panRightKeys?: string[];
  zoomInHoldKeys?: string[];
  zoomOutHoldKeys?: string[];
  rotateLeftHoldKeys?: string[];
  rotateRightHoldKeys?: string[];
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
  rotateLeftKeys: string[];
  rotateRightKeys: string[];
  resetRotationKeys: string[];
  panUpKeys: string[];
  panDownKeys: string[];
  panLeftKeys: string[];
  panRightKeys: string[];
  zoomInHoldKeys: string[];
  zoomOutHoldKeys: string[];
  rotateLeftHoldKeys: string[];
  rotateRightHoldKeys: string[];

  // ROT-1: `rotation` is the live value synced into `camera.rotation` every frame (direct, like
  // `c` — a drag writes straight into it, no lag). `rotation_target` is only consulted for
  // discrete keyboard steps (rotateBy/resetRotation), eased the same way zoom_factor eases
  // towards zoom_target; a drag keeps the two in sync (see the mousemove handler) so the eased
  // approach doesn't fight it or spring back once the drag ends.
  rotation: number;
  rotation_target: number;

  private _mouse_move_flag: number;
  private _mouse_down_flag: number;
  private _scroll_velocity: Vector;
  private _dx: number; // todo: rename
  private _dy: number;
  private _drotation: number;
  private _rotate_drag: boolean;
  // Continuous-hold navigation: which of the tracked keys are currently down, checked every
  // frame in onRepaint rather than acted on once per keydown. Stores KeyboardEvent.key.toLowerCase().
  private _keysDown: Set<string>;
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

    this.rotation = (options && options.rotation) || 0;
    this.rotation_target = this.rotation;

    this.camera = new Transform2D();
    this.camera.setTranslation(this.c.x, this.c.y);
    this.camera.setScale(1 / this.zoom_factor);
    this.camera.rotation = this.rotation;

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
    // KEY-1: 'BracketLeft'/'BracketRight' are the .code values for the physical [/] key,
    // unaffected by layout — see the DEFAULT_* comment above.
    this.rotateLeftKeys = (options && options.rotateLeftKeys) || ['BracketLeft', '['];
    this.rotateRightKeys = (options && options.rotateRightKeys) || ['BracketRight', ']'];
    this.resetRotationKeys = (options && options.resetRotationKeys) || ['Home'];
    this.panUpKeys = (options && options.panUpKeys) || DEFAULT_PAN_UP_KEYS;
    this.panDownKeys = (options && options.panDownKeys) || DEFAULT_PAN_DOWN_KEYS;
    this.panLeftKeys = (options && options.panLeftKeys) || DEFAULT_PAN_LEFT_KEYS;
    this.panRightKeys = (options && options.panRightKeys) || DEFAULT_PAN_RIGHT_KEYS;
    this.zoomInHoldKeys = (options && options.zoomInHoldKeys) || DEFAULT_ZOOM_IN_HOLD_KEYS;
    this.zoomOutHoldKeys = (options && options.zoomOutHoldKeys) || DEFAULT_ZOOM_OUT_HOLD_KEYS;
    this.rotateLeftHoldKeys = (options && options.rotateLeftHoldKeys) || DEFAULT_ROTATE_LEFT_HOLD_KEYS;
    this.rotateRightHoldKeys = (options && options.rotateRightHoldKeys) || DEFAULT_ROTATE_RIGHT_HOLD_KEYS;

    this._dx = 0;
    this._dy = 0;
    this._drotation = 0;
    this._rotate_drag = false;
    this._keysDown = new Set();
    this._zoom_anchor_screen = null;

    let old_x = 0;
    let old_y = 0;

    this.canvas.addEventListener('wheel', (e: WheelEvent) => {
      const dy = -e.deltaY;
      if (dy === 0) return;

      // ZOOM-1: keep whatever's under the cursor fixed in place as the zoom eases in.
      this._zoom_anchor_screen = { x: e.offsetX, y: e.offsetY };

      // Scale the step by |deltaY| instead of always applying one fixed zoomIn()/zoomOut() step
      // per event (the old behavior): a discrete mouse wheel sends one notch per event (~100 on
      // most browsers/OSes — WHEEL_DELTA_PER_STEP calibrates to that, so a single notch still
      // reproduces the old fixed zoom_step_factor step exactly), but a trackpad sends a dense
      // stream of small, continuously-varying-magnitude events for one physical gesture — and
      // its momentum/inertia tail routinely trails off into a handful of tiny, SIGN-NOISY events
      // (e.g. -3, +2, -1, +1) as the gesture visually "stops". Treating every event as a full
      // step regardless of magnitude turned that noise into full-sized zoomIn()/zoomOut() calls
      // fired back-to-back in alternating directions — a real, visible zoom shake right as
      // scrolling settles.
      //
      // ZOOM-9 follow-up: scaling *up* without a ceiling made things worse, not better — a real
      // trackpad's deltaY during the active (non-tail) part of a gesture routinely reports
      // magnitudes well above the ~100 "one mouse notch" reference (a fast swipe can spike into
      // the several hundreds), so the naive `Math.pow(1 + step, dy / 100)` let a single event
      // apply a multi-hundred-percent zoom jump — a much bigger, more visible shake than the old
      // fixed 20% step ever produced, and no longer confined to the settling tail (any event with
      // an outsized magnitude triggers it). Clamping |dy| to WHEEL_DELTA_PER_STEP before scaling
      // keeps the proportional-for-small-noise behavior (fixes the original tail-shake) while
      // capping the largest possible single-event step at exactly the old zoomIn()/zoomOut() size
      // — a single event can now only ever do as much as the old code always did, never more.
      const clamped_dy = Math.max(-WHEEL_DELTA_PER_STEP, Math.min(WHEEL_DELTA_PER_STEP, dy));
      const multiplier = Math.pow(1 + this.zoom_step_factor, clamped_dy / WHEEL_DELTA_PER_STEP);
      this.zoomBy(multiplier);

      e.preventDefault();
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Don't steal keystrokes meant for a text field — e.g. typing into a dat.GUI number box
      // (this also fixes a pre-existing bug: typing a "-" into one would have triggered
      // zoomOut()).
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      // Continuous-hold navigation (WASD/arrows/Z/X/Q/E): just record that the key is down —
      // acted on every frame in onRepaint, not here. Held browser key-repeat re-fires keydown
      // but not keyup, so re-adding an already-present entry is a harmless no-op (Set.add is
      // idempotent). KEY-1: keyed by `.code` (physical key), not `.key.toLowerCase()` — see the
      // DEFAULT_PAN_*/DEFAULT_*_HOLD_KEYS comment above.
      this._keysDown.add(e.code);

      if (this.zoomInKeys.includes(e.key) || this.zoomInKeys.includes(e.code)) {
        // No cursor position to anchor a keyboard-triggered zoom to — zoom around the center.
        this._zoom_anchor_screen = null;
        this.zoomIn();
        e.preventDefault();
      } else if (this.zoomOutKeys.includes(e.key) || this.zoomOutKeys.includes(e.code)) {
        this._zoom_anchor_screen = null;
        this.zoomOut();
        e.preventDefault();
      } else if (this.rotateLeftKeys.includes(e.key) || this.rotateLeftKeys.includes(e.code)) {
        this.rotateBy(-ROTATE_KEY_STEP);
        e.preventDefault();
      } else if (this.rotateRightKeys.includes(e.key) || this.rotateRightKeys.includes(e.code)) {
        this.rotateBy(ROTATE_KEY_STEP);
        e.preventDefault();
      } else if (this.resetRotationKeys.includes(e.key) || this.resetRotationKeys.includes(e.code)) {
        this.resetRotation();
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e: KeyboardEvent) => {
      this._keysDown.delete(e.code);
    });

    // If focus leaves the window while a key is held (e.g. Alt+Tab), its keyup may never fire —
    // without this, that key would stay "stuck" down in _keysDown forever.
    window.addEventListener('blur', () => {
      this._keysDown.clear();
    });

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      this._mouse_move_flag = 1;
      this._mouse_down_flag = 1;
      // ROT-1: hold Shift while dragging to rotate instead of pan. Decided once at mousedown,
      // for the whole gesture — doesn't switch mid-drag if Shift is pressed/released partway.
      this._rotate_drag = e.shiftKey;
      old_x = e.pageX;
      old_y = e.pageY;
    });

    this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (this._mouse_move_flag) {
        if (this._rotate_drag) {
          this._drotation += (old_x - e.pageX) * ROTATE_DRAG_SENSITIVITY;
        } else {
          this._dx += old_x - e.pageX;
          this._dy += old_y - e.pageY;
        }
        old_x = e.pageX;
        old_y = e.pageY;
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this._mouse_move_flag = 0;
      this._rotate_drag = false;
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
      this._rotate_drag = false;
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
    // `performance.now()` (sub-millisecond resolution, monotonic) instead of the previous
    // `new Date().getTime()` (whole milliseconds only, and can jump if the system clock is
    // adjusted): at 120Hz+ refresh rates two consecutive frames landing in the same millisecond
    // is routine, giving dt=0 and fps=1/0=Infinity, which used to permanently corrupt the fps
    // display (see AvgRing.add's comment) — sub-millisecond precision makes an exact dt=0 far
    // less likely, though the explicit finite-check below is the actual, unconditional fix.
    const t1 = performance.now() / 1000;
    const dt = this.t ? t1 - this.t : NaN;
    const fps = isFinite(dt) && dt > 0 ? Math.round(1 / dt) : NaN;
    this.fps_stat.add(fps);
    this.dt_stat.add(dt);
    this.t = t1;

    const layers = this.layers;

    // Clamped, frame-rate-independent delta time shared by every per-frame animation/continuous
    // input below (zoom/rotation easing, WASD/Z/X/Q/E continuous nav) — NaN on the very first
    // frame (this.t not set yet), and capped so a long stall (e.g. a backgrounded tab) doesn't
    // make everything jump/zoom/rotate all at once when it resumes.
    const frame_dt = dt && isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 1 / 60;

    // WASD/arrows: continuous pan while held, independent of `scrollType` (that governs
    // mouse-drag inertia/sliding; keyboard nav is always direct, like a game camera). Speed is
    // screen pixels/second scaled by 1/zoom_factor — see KEYBOARD_PAN_SPEED_PX_PER_SEC.
    let moveX = 0;
    let moveY = 0;
    if (this._isAnyKeyDown(this.panLeftKeys)) moveX -= 1;
    if (this._isAnyKeyDown(this.panRightKeys)) moveX += 1;
    if (this._isAnyKeyDown(this.panUpKeys)) moveY -= 1;
    if (this._isAnyKeyDown(this.panDownKeys)) moveY += 1;
    if (moveX !== 0 || moveY !== 0) {
      const norm = Math.hypot(moveX, moveY); // don't let diagonal movement (e.g. W+D) be faster
      const speed = (KEYBOARD_PAN_SPEED_PX_PER_SEC * frame_dt) / this.zoom_factor;
      this.scroll((moveX / norm) * speed, (moveY / norm) * speed);
    }

    // Z/X: continuous zoom while held, via the same zoomBy() the wheel/+/- use — inherits its
    // soft-edge clamping at zoom_min/zoom_max for free. No cursor position to anchor to, so
    // (like the discrete +/- keys) this zooms around the center.
    const zoomOutHeld = this._isAnyKeyDown(this.zoomOutHoldKeys);
    const zoomInHeld = this._isAnyKeyDown(this.zoomInHoldKeys);
    if (zoomOutHeld || zoomInHeld) {
      this._zoom_anchor_screen = null;
      if (zoomOutHeld) this.zoomBy(Math.pow(1 / KEYBOARD_ZOOM_RATE_PER_SEC, frame_dt));
      if (zoomInHeld) this.zoomBy(Math.pow(KEYBOARD_ZOOM_RATE_PER_SEC, frame_dt));
    }

    // Q/E: continuous rotate while held — added straight into `_drotation`, the same
    // accumulator Shift+drag uses (drained a little further down), so it's immediate like a
    // drag rather than trailing an eased target the way rotateBy()'s discrete steps do.
    if (this._isAnyKeyDown(this.rotateLeftHoldKeys)) this._drotation -= KEYBOARD_ROTATE_SPEED_RAD_PER_SEC * frame_dt;
    if (this._isAnyKeyDown(this.rotateRightHoldKeys)) this._drotation += KEYBOARD_ROTATE_SPEED_RAD_PER_SEC * frame_dt;

    // Time-based (not frame-based) exponential smoothing towards zoom_target: the old
    // `zoom_factor += (target - zoom_factor) / zoom_animation_factor` advanced by a fixed
    // fraction per *frame*, so the same zoom_animation_factor felt slower on a 30fps device
    // than on a 120fps one. `tau` below is calibrated so the feel at a nominal 60fps frame
    // matches the old per-frame formula (its per-frame decay constant was 1/zoom_animation_factor,
    // i.e. a time constant of zoom_animation_factor frames = zoom_animation_factor/60 seconds).
    const tau = Math.max(this.zoom_animation_factor, 1) / 60;
    const zoom_alpha = 1 - Math.exp(-frame_dt / tau);
    const old_zoom_factor = this.zoom_factor;
    this.zoom_factor += (this.zoom_target - this.zoom_factor) * zoom_alpha;
    if (Math.abs(this.zoom_target - this.zoom_factor) < Math.pow(2, -18)) {
      // todo: calc cutting edge by current zoom
      this.zoom_factor = this.zoom_target;
    }

    // ZOOM-1: re-anchor `c` so that whatever world point was under `_zoom_anchor_screen` before
    // this frame's zoom step is still under it after — applied every frame the zoom is easing,
    // not just once at the end, so the anchor doesn't drift mid-animation. Derived directly from
    // screenToWorld's formula (world = rotate(rotation, centered/zoom) + c): the drift introduced
    // by changing zoom alone, at a fixed `c`/`rotation`, is `rotate(rotation, centered) *
    // (1/old_zoom - 1/new_zoom)` — subtracting it out of `c` is what keeps `centered` (and so the
    // anchor) pointing at the same world position.
    //
    // ROT-6: `centered` is a *screen*-space vector (relative to the canvas center); screenToWorld
    // rotates it into world space before adding `c` (see its own body), so this correction must
    // rotate it the same way before subtracting — the original version added the un-rotated
    // vector straight into `c`, correct only at rotation 0 and drifting the anchor sideways at any
    // other angle (worse the further from 0, most visible at max zoom where the anchor correction
    // dominates `c`'s frame-to-frame movement).
    if (this._zoom_anchor_screen && this.zoom_factor !== old_zoom_factor) {
      const centered = {
        x: this._zoom_anchor_screen.x - this.canvas.width / 2,
        y: this._zoom_anchor_screen.y - this.canvas.height / 2
      };
      const drift = 1 / old_zoom_factor - 1 / this.zoom_factor;
      const rotated = Mat2D.rotation(this.rotation).transformVector(centered);
      this.c.x += rotated.x * drift;
      this.c.y += rotated.y * drift;
    }

    // ROT-1: a drag writes `rotation` directly (immediate feedback, like `c`) and keeps
    // `rotation_target` in sync so the easing below has nothing left to do once the drag ends.
    // Keyboard-driven steps (rotateBy/resetRotation) only move `rotation_target`, and ease
    // towards it the same way (and with the same time constant) zoom_factor eases towards
    // zoom_target — reused here rather than a second independent tau, for a consistent feel.
    //
    // Branches on whether `_drotation` actually accumulated anything this frame, NOT on the
    // live `_rotate_drag` flag: a fast enough drag (mousedown+move+up all before the next
    // animation frame — routine for a synthetic/test-driven drag, and not impossible for a real
    // one) would otherwise have `_rotate_drag` already false by the time this runs, sending the
    // just-accumulated delta into the easing branch instead of applying it, and silently
    // dropping it (mirrors why the `_dx`/`_dy` pan drain a few lines below is unconditional too,
    // not gated on `_mouse_move_flag`).
    if (this._drotation !== 0) {
      this.rotation += this._drotation;
      this.rotation_target = this.rotation;
      this._drotation = 0;
    } else {
      this.rotation += (this.rotation_target - this.rotation) * zoom_alpha;
      if (Math.abs(this.rotation_target - this.rotation) < 1e-9) this.rotation = this.rotation_target;
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

      // ROT-6: routed through scroll() (not a direct this.c.add()) so the same rotation
      // treatment as every other pan path applies here too — this velocity is a screen-oriented
      // vector same as _dx/_dy, just accumulated over time.
      if (this._scroll_velocity.length2()) this.scroll(this._scroll_velocity.x, this._scroll_velocity.y);

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
    this.camera.rotation = this.rotation;

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer.visible) layer.draw(this);
    }

    this._mouse_down_flag = 0;

    window.requestAnimationFrame(this.onRepaint_callback);
  }

  update_url_position(): void {
    // ROT-2: third component is rotation in whole degrees (human-readable in the URL bar),
    // converted back to radians on parse. Old two-component links (src/index.ts's regex still
    // accepts them) simply come back in with rotation 0.
    const degrees = Math.round((this.rotation * 180) / Math.PI);
    const redirect = '#[' + Math.round(this.c.x) + ',' + Math.round(this.c.y) + ',' + degrees + ']';
    history.pushState('', '', redirect);
  }

  locate(x: XArg, y?: number): void {
    this.c = new Vector(x, y);
    if (this.onLocate) this.onLocate(this.c.x, this.c.y);

    //this.update_url_position();
    // todo: some recalculate?
  }

  // ROT-6: `dx`/`dy` are a *screen*-oriented vector (already scaled by 1/zoom_factor by the
  // caller — see the mouse-drag `_dx`/`_dy` drain and the WASD speed calc in onRepaint) — e.g.
  // "dx>0" means "the view should move as if the content were pushed rightward on screen", the
  // same convention screenToWorld's `centered` uses. Once the camera is rotated, screen-right is
  // no longer world-+x, so the vector has to be rotated into world space before it's added to
  // `c` — every pan control (mouse-drag, WASD) otherwise stays tied to the ORIGINAL, unrotated
  // axes, so e.g. at a 180° rotation every direction comes out inverted from what's on screen
  // (direct user report). Matches Mat2D.rotation's convention, same as the ZOOM-1 anchor-drift
  // correction just above, which needed the identical fix for the identical reason.
  scroll(dx: number, dy: number): void {
    const rotated = Mat2D.rotation(this.rotation).transformVector({ x: dx, y: dy });
    this.locate(this.c.x + rotated.x, this.c.y + rotated.y);
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
    this.zoomBy(1 + this.zoom_step_factor);
  }

  zoomOut(): void {
    this.zoomBy(1 - this.zoom_step_factor);
  }

  /** multiplier > 1 zooms in, < 1 zooms out. See ZOOM_EDGE_SOFTNESS for the boundary behavior. */
  private zoomBy(multiplier: number): void {
    const naive = this.zoom_target * multiplier;
    const clamped = Math.min(Math.max(naive, this.zoom_min), this.zoom_max);
    if (Math.abs(clamped - naive) < 1e-12) {
      // Fully within range (or near enough it doesn't matter) — take the step as asked.
      this.zoom_target = naive;
      return;
    }
    // The naive step would cross zoom_min/zoom_max: rather than a hard stop (old behavior) or
    // snapping straight to the boundary, take only part of the remaining distance to it. Each
    // further push in the same direction takes a smaller bite, so the approach to the limit
    // feels like it's easing to a stop instead of hitting a wall. Moving the other way (out of
    // the naive-step-would-cross-boundary case) always takes the full step, immediately.
    this.zoom_target += (clamped - this.zoom_target) * ZOOM_EDGE_SOFTNESS;
  }

  private _isAnyKeyDown(keys: string[]): boolean {
    return keys.some((k) => this._keysDown.has(k));
  }

  /** Eases `rotation` by this many radians (positive = clockwise on screen, matching Mat2D.rotation). Unbounded — rotation can wind up past a full turn; see resetRotation(). */
  rotateBy(deltaRadians: number): void {
    this.rotation_target += deltaRadians;
  }

  /**
   * Eases back to "north" — but the *nearest* equivalent angle, not literal 0, so a view that's
   * wound around through several full drag-driven turns snaps back the short way instead of
   * visibly unspinning through every accumulated turn.
   */
  resetRotation(): void {
    this.rotation_target = Math.round(this.rotation / (2 * Math.PI)) * (2 * Math.PI);
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/// Layer /////////////////////////////////////////////////////////////////////////////////////////
export interface LayerOptions {
  name?: string;
  shift?: Vector;
  // AFF-4: independent of the shared camera zoom/rotation (that's ROT-*'s job) — a per-layer
  // knob, e.g. for an overlay that should sit at a different apparent scale/angle than the base
  // map. Both read once at construction into `transform`; see Layer.transform's own comment.
  scale?: number;
  rotation?: number;
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
  // AFF-4: this layer's own coordinate system, independent of (not parented to) `map.camera` —
  // see BACKLOG.md's AFF-4 note on why literally parenting it to camera doesn't compose: camera's
  // local/world directions are inverted on purpose (world = shared position space, local =
  // centered screen space, so that screenToWorld/worldToScreen read naturally at the MapWidget
  // level), which is backwards from what a nested child transform would need. `transform`
  // instead maps this layer's own local drawing space directly into that same shared *world*
  // (position) space; MapWidget.camera then takes it from there to the screen, same as any other
  // world point. Initialized from `shift`/`scale`/`rotation` once at construction — mutate
  // `transform` directly afterwards (not `shift`) to actually move a layer post-construction.
  transform: Transform2D;
  onDraw?: (this: Layer, map: MapWidget) => void;
  visible: boolean;
  options: LayerOptions; // todo: разобраться как лучше интегрировать дополнительные опции

  constructor(options?: LayerOptions) {
    this.name = options && options.name;
    this.shift = (options && options.shift) || new Vector(0, 0);
    this.transform = new Transform2D();
    this.transform.setTranslation(this.shift.x, this.shift.y);
    if (options && options.scale !== undefined) this.transform.setScale(options.scale);
    if (options && options.rotation !== undefined) this.transform.rotation = options.rotation;
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
    tile?: Tile | null,
    // ROT-4: the same per-layer matrix tileDraw() uses to place the actual tile image (camera +
    // this layer's own transform, composed once per frame — see computeTileGridMatrix). A caller
    // that draws in tile-index units through it (ctx.setTransform + a unit square at ix/iy, like
    // tileDraw()'s own ctx.drawImage call) rotates/scales rigidly with the rest of the layer
    // instead of coming out axis-aligned regardless of camera rotation; existing callbacks that
    // only take the precomputed pixel x/y/tsize (unaffected — optional, appended last) keep
    // working unchanged.
    gridMatrix?: Mat2D
  ) => void; // function(ix, iy, x, y, tile, gridMatrix)
  z_max?: number;
}

export interface LevelParams {
  z: number;
  k: number;
  tile_size: number; // on-screen size in pixels, at the current zoom
  world_tile_edge: number; // AFF-4: size of one tile's edge in shared world/position units
  tx: number;
  ty: number;
  dx: number;
  dy: number;
  // ROT-3: computed once here (needs the canvas corners projected through it — see below) and
  // reused by draw() for the actual per-tile placement, instead of building it twice.
  gridMatrix: Mat2D;
}

// AFF-4: the combined matrix mapping a tile's *index* (integer ix/iy, one unit = one tile) to
// actual canvas pixel coordinates — camera pan/zoom, this layer's own shift/scale/rotation, and
// the tile-index-to-world-units scaling, composed into one Mat2D instead of the old inline
// `x*tile_size - c.x + w/2` arithmetic. Exported and DOM-free specifically so it's unit-testable
// (see map.test.ts) against that old formula, independent of any live canvas/browser.
//
// `layerTransform` is intentionally not required to be parented to `camera` (see Layer.transform's
// comment on why that wouldn't compose the way it sounds) — this function reads its `worldMatrix`
// either way, so it works whether or not a caller has parented it to something.
export function computeTileGridMatrix(
  camera: Transform2D,
  layerTransform: Transform2D,
  canvasWidth: number,
  canvasHeight: number,
  world_tile_edge: number
): Mat2D {
  return Mat2D.translation(canvasWidth / 2, canvasHeight / 2)
    .multiply(camera.worldMatrix.invert())
    .multiply(layerTransform.worldMatrix)
    .multiply(Mat2D.scaling(world_tile_edge, world_tile_edge));
}

export class TiledLayer extends Layer {
  tile_source?: TileSource;
  tile_size: number;
  onTileDraw?: TiledLayerOptions['onTileDraw'];
  z_max?: number;
  // Debug-overlay support: how many tile slots this layer's draw() considered this frame
  // ((2*dx+1)*(2*dy+1)) — not how many actually have an image yet, just the size of the
  // currently-visible index range. Updated at the top of every draw() call.
  visible_tile_count = 0;

  constructor(options?: TiledLayerOptions) {
    super(options);
    this.tile_source = options && options.tile_source;
    this.tile_size = (options && options.tile_size) || (this.tile_source && this.tile_source.tile_size) || 0;
    this.onTileDraw = options && options.onTileDraw; // function(ix, iy, x, y, tile)
    this.z_max = options && options.z_max;
  }

  getLevelParams(map: MapWidget, w: number, h: number): LevelParams {
    const zf = map.zoom_factor;
    const z = Math.ceil(Math.log2(zf));
    const k = zf / Math.pow(2, z);
    const tile_size = this.tile_size * k;
    const world_tile_edge = this.tile_size / Math.pow(2, z);

    // AFF-4: one matrix for the whole layer this frame, replacing the old per-tile
    // `x*tile_size - c.x + w/2` arithmetic — see computeTileGridMatrix.
    const gridMatrix = computeTileGridMatrix(map.camera, this.transform, w, h, world_tile_edge);

    // ROT-3: the tile index range used to be derived as if the canvas were an axis-aligned,
    // unrotated rectangle in tile-index space (center from `position`, half-extents from
    // w/h/tile_size) — correct only at rotation 0. Once the camera is rotated, the actual
    // world-space area the canvas covers is a *rotated* rectangle; its axis-aligned bounding box
    // in tile-index space is wider/taller than the unrotated canvas (by up to sqrt(2) at 45°), so
    // the old dx/dy under-covered it — tiles (and grid lines) near the canvas corners were never
    // fetched or drawn, and the visible gap swings around as the rotation changes. Fixed by
    // projecting the canvas's four actual corners through the inverse of the very same
    // gridMatrix used below to place tiles (so this is guaranteed consistent with what actually
    // gets drawn, camera *and* this layer's own transform included) and taking the bounding box
    // of the results in tile-index space, instead of assuming an identity transform.
    const inv = gridMatrix.invert();
    const corners = [
      inv.transformPoint({ x: 0, y: 0 }),
      inv.transformPoint({ x: w, y: 0 }),
      inv.transformPoint({ x: 0, y: h }),
      inv.transformPoint({ x: w, y: h })
    ];
    let minX = corners[0].x, maxX = corners[0].x;
    let minY = corners[0].y, maxY = corners[0].y;
    for (let i = 1; i < corners.length; i++) {
      if (corners[i].x < minX) minX = corners[i].x;
      if (corners[i].x > maxX) maxX = corners[i].x;
      if (corners[i].y < minY) minY = corners[i].y;
      if (corners[i].y > maxY) maxY = corners[i].y;
    }
    // +1 tile of padding beyond the tight bounding box: the corners essentially never land
    // exactly on a tile boundary, so without this, a corner tile that only partially overlaps
    // the canvas (its index just past the ceil()/floor() cut) would be skipped, leaving a sliver
    // gap right at the edge — visible as missing tiles precisely where ROT-3 matters most.
    const tx = Math.round((minX + maxX) / 2);
    const ty = Math.round((minY + maxY) / 2);
    const dx = Math.ceil((maxX - minX) / 2) + 1;
    const dy = Math.ceil((maxY - minY) / 2) + 1;

    return {
      z: z + (this.z_max || 0),
      k,
      tile_size,
      world_tile_edge,
      tx,
      ty,
      dx,
      dy,
      gridMatrix
    };
  }

  draw(map: MapWidget): void {
    super.draw(map);
    const w = map.canvas.width; // todo: use property
    const h = map.canvas.height;

    const level_params = this.getLevelParams(map, w, h);
    const z = level_params.z;
    const tile_size = level_params.tile_size;
    const tx = level_params.tx;
    const ty = level_params.ty;
    const dx = level_params.dx;
    const dy = level_params.dy;
    const gridMatrix = level_params.gridMatrix;
    this.visible_tile_count = (2 * dx + 1) * (2 * dy + 1);

    for (let y = ty - dy; y <= ty + dy; y++) {
      for (let x = tx - dx; x <= tx + dx; x++) {
        const topLeft = gridMatrix.transformPoint({ x, y });
        this.tileDraw(map, x, y, z, topLeft.x, topLeft.y, tile_size, gridMatrix);
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

  // `gridMatrix`, when given, is used to draw the tile image through the canvas's actual
  // transform (ctx.setTransform + a unit square at this tile's index) instead of a manually
  // computed pixel rect — the AFF-4 rewrite. `x`/`y`/`tsize` stay in pixel coordinates regardless
  // (precomputed by the caller from the same matrix) so `onTileDraw` consumers (drawTileDebug,
  // map_grid's grid lines — see layers.ts) don't need to change: retrofitting them to draw in the
  // layer's local (tile-index) units would also mean compensating ctx.font/ctx.lineWidth for the
  // active scale (both are subject to the CTM same as any other drawing), for no benefit to
  // debug/grid overlays that have no need to be rotation- or matrix-aware themselves.
  tileDraw(map: MapWidget, ix: number, iy: number, iz: number, x: number, y: number, tsize: number, gridMatrix?: Mat2D): void {
    let tile: Tile | null | undefined;
    if (this.tile_source) tile = this.tile_source.get(ix, iy, iz);

    if (tile && tile.image) {
      const ctx = map.ctx;
      if (gridMatrix) {
        ctx.save();
        ctx.setTransform(gridMatrix.a, gridMatrix.b, gridMatrix.c, gridMatrix.d, gridMatrix.e, gridMatrix.f);
        ctx.drawImage(tile.image, 0, 0, this.tile_size, this.tile_size, ix, iy, 1, 1);
        ctx.restore();
      } else {
        // No matrix given (e.g. a direct call bypassing draw()) — same pixel-rect draw as before
        // this change.
        ctx.drawImage(tile.image, 0, 0, this.tile_size, this.tile_size, x, y, tsize, tsize);
      }
    }

    if (this.onTileDraw) this.onTileDraw(map, ix, iy, iz, x, y, tsize, tile, gridMatrix);
  }
}

import { Vector } from './vector.js';
import type { Tile, TileSource } from './tile_source.js';
import { isHeatableTileSource } from './tile_source.js';
import { Transform2D } from './transform2d.js';
import { Mat2D } from './mat2d.js';
import { AvgRing } from './tools.js';
import { BookmarkStore } from './bookmarks.js';

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

// ZOOM-14: multiplier applied to a trackpad pinch-to-zoom `wheel` event's `deltaY` before it
// enters _wheelZoom's existing clamped-proportional formula (see WHEEL_DELTA_PER_STEP above) — by
// direct user report, pinch-zoom on a Mac trackpad worked but felt "very weak, boost it several
// times over". Root cause: the pinch branch (`e.ctrlKey || e.metaKey`) shares the exact same
// formula as plain mouse-wheel, which is calibrated to a physical wheel notch's `|deltaY| ≈ 100`
// (WHEEL_DELTA_PER_STEP) — but a trackpad pinch reports `deltaY` an order of magnitude smaller per
// event (single digits — see classifyWheelEvent's own `Math.abs(value) < 4` "definitely trackpad"
// threshold and BACKLOG.md's ZOOM-12 citations), so the same formula gives pinch a barely
// perceptible step per event. Picked "on feel", not measured (no real trackpad in this sandbox —
// same limitation as ZOOM-10/ZOOM-12/ZOOM-13's own constants), safe to retune after testing on
// real hardware. The existing WHEEL_DELTA_PER_STEP clamp still applies AFTER this multiplier, so
// it also caps pinch's largest possible single-event step at the same ceiling as one mouse notch —
// this is deliberate (see _wheelZoom), not just a side effect.
const PINCH_ZOOM_SENSITIVITY = 10;

// ZOOM-12: device-classification heuristic for a `wheel` event — is this actually a mouse wheel,
// or a laptop trackpad synthesizing `wheel` events for a two-finger swipe/pinch? The web platform
// gives no reliable first-class signal for this (confirmed by several independent sources — see
// BACKLOG.md's ZOOM-12 entry); `e.ctrlKey`/`e.metaKey` catches pinch-to-zoom specifically (both a
// physical Ctrl+wheel and a trackpad pinch set it — a documented browser convention, Chrome since
// M35/Firefox since 55), but plain wheel-vs-swipe (both report `ctrlKey: false`) needs an actual
// heuristic. Ported near-verbatim from mapbox-gl-js's `src/ui/handler/scroll_zoom.ts` (MIT)
// rather than re-derived — its magic numbers are years of field experience across real
// devices/browsers, not something to re-tune from scratch (the same principle ZOOM-9/ZOOM-10
// already relied on). Extracted as a standalone, DOM-free pure function — rather than inlined in
// the `wheel` listener below — specifically so it's unit-testable without a live browser (see
// map.test.ts): MapWidget's `_wheel_state`/`_wheel_last_time` fields are the only real caller,
// threading state through call to call the same way a test fabricates it.
//
// `WHEEL_DOM_DELTA_LINE` mirrors `WheelEvent.DOM_DELTA_LINE`'s value (1) without depending on the
// DOM global itself, so this function stays callable under plain Node (vitest's default
// environment here has no DOM/jsdom).
const WHEEL_DOM_DELTA_LINE = 1;
// Empirically-measured magnitude of one physical mouse-wheel "notch" in Chrome/Firefox — mapbox's
// own comment calls this "a browser magic number, not meant to be understood". A normalized
// `value` that's an exact multiple of it is almost certainly a real wheel notch: trackpad output
// is continuously-varying, never neatly quantized like this.
const WHEEL_NOTCH_MODULUS = 4.000244140625;
// Below this magnitude, an event is almost certainly trackpad noise/momentum — no mouse-wheel
// notch is ever reported this small.
const WHEEL_DEFINITELY_TRACKPAD_BELOW = 4;
// A gap this long (ms) since the previous wheel event means a new gesture is starting — its
// device type can't be inferred from timing/cadence alone yet.
const WHEEL_NEW_GESTURE_GAP_MS = 400;
// Grace period (ms): if nothing else arrives to help classify a just-started gesture within this
// window, assume it was a single, isolated mouse-wheel notch — a real trackpad's momentum stream
// fires far more often than this. See MapWidget's `_wheel_grace_timer`.
const WHEEL_CLASSIFY_GRACE_MS = 40;
// Fallback once a gesture has repeated fast enough to classify from cadence: a small
// magnitude-per-millisecond reading means trackpad, a large one means a (fast, repeated) wheel.
const WHEEL_TRACKPAD_TIME_DELTA_THRESHOLD = 200;

export type WheelGestureType = 'wheel' | 'trackpad';

// Carried from one `wheel` event to the next by MapWidget's `_wheel_state` field. Threaded
// through classifyWheelEvent explicitly (rather than closed over) so the function can be called
// directly, with fabricated state, from a unit test — see map.test.ts.
export interface WheelClassifyState {
  type: WheelGestureType | null; // null = not decided yet for the current gesture
}

export interface WheelClassifyResult {
  // Classification for *this* event. null means "still in the grace window, not decided yet" —
  // MapWidget treats that the same as 'wheel' (defaults to the existing zoom behavior; see
  // BACKLOG.md's ZOOM-12 entry for why that default, not 'trackpad', is the safe choice).
  type: WheelGestureType | null;
  state: WheelClassifyState; // state to carry into the next call
  // True exactly when a new gesture was just detected (the WHEEL_NEW_GESTURE_GAP_MS branch) — the
  // caller should (re)start a WHEEL_CLASSIFY_GRACE_MS timer that finalizes `state.type` to
  // 'wheel' if nothing else resolves it first (see WHEEL_CLASSIFY_GRACE_MS's own comment).
  startGraceTimer: boolean;
}

export function classifyWheelEvent(
  deltaY: number,
  deltaMode: number,
  now: number,
  lastTime: number,
  state: WheelClassifyState
): WheelClassifyResult {
  const value = deltaMode === WHEEL_DOM_DELTA_LINE ? deltaY * 40 : deltaY;
  const timeDelta = now - lastTime;

  if (value !== 0 && value % WHEEL_NOTCH_MODULUS === 0) {
    // Definitely a real mouse wheel — checked first, and independent of timing/previous state,
    // same priority order as mapbox's own implementation.
    return { type: 'wheel', state: { type: 'wheel' }, startGraceTimer: false };
  }
  if (value !== 0 && Math.abs(value) < WHEEL_DEFINITELY_TRACKPAD_BELOW) {
    // Definitely trackpad — too small to ever be a real wheel notch.
    return { type: 'trackpad', state: { type: 'trackpad' }, startGraceTimer: false };
  }
  if (timeDelta > WHEEL_NEW_GESTURE_GAP_MS) {
    // A new gesture: not yet knowable from timing alone.
    return { type: null, state: { type: null }, startGraceTimer: true };
  }
  if (!state.type) {
    // Repeated event, still undecided from earlier in this same gesture — infer from
    // magnitude-per-millisecond, and remember the inference for the rest of the gesture.
    const inferred: WheelGestureType = Math.abs(timeDelta * value) < WHEEL_TRACKPAD_TIME_DELTA_THRESHOLD ? 'trackpad' : 'wheel';
    return { type: inferred, state: { type: inferred }, startGraceTimer: false };
  }
  // Repeated event, already decided earlier in this gesture — stick with it rather than
  // re-classifying every single event (a real gesture's later events can easily stray into the
  // opposite magnitude range, e.g. a trackpad's momentum tail briefly spiking, or a fast mouse
  // scroll's cadence looking "trackpad-slow" — once resolved, ride it out for the gesture).
  return { type: state.type, state: { type: state.type }, startGraceTimer: false };
}

// ROT-1: radians per pixel of horizontal Shift+drag — chosen so a full 180° turn takes a
// comfortable ~300px drag, not a tuned/measured value.
const ROTATE_DRAG_SENSITIVITY = Math.PI / 300;
// ROT-1: radians per keyboard step (5°) — small enough to nudge, not so small it feels inert.
const ROTATE_KEY_STEP = Math.PI / 36;

// ZOOM-13: one-finger double-tap-and-hold zoom+rotate — the standard mobile-map single-finger
// zoom gesture (Google Maps et al.), extended here (direct user request) to also rotate on the
// horizontal axis. See BACKLOG.md's ZOOM-13 entry for the full state machine
// (MapWidget._zoom_rotate_state/_tap_pending/_single_touch_start/etc.) these constants drive, and
// the touchstart/touchmove/touchend handlers below for where they're used. None of these are
// measured against a real device (this sandbox has none — see BACKLOG.md's ZOOM-10/ZOOM-12 notes
// on the same limitation) — chosen in the same "typical mobile gesture" ballpark other mobile UI
// conventions use, same spirit as TAP_MAX_DURATION_MS's own comment.

// A touch that starts and ends within this long, having moved no more than TAP_MAX_MOVEMENT_PX,
// counts as a tap rather than a drag (see MapWidget._single_touch_start/_tap_pending). In the same
// ballpark as Android's own tap/long-press disambiguation window — this project has no
// competing long-press gesture, so there's no pressure to shrink it further.
const TAP_MAX_DURATION_MS = 250;
// How far a touch may drift between its start and release and still count as a tap, not a
// micro-drag — a real finger is never perfectly still.
const TAP_MAX_MOVEMENT_PX = 10;
// Two taps count as a double-tap if the second one's touchstart lands within this long of the
// first one's touchend...
const DOUBLE_TAP_MAX_INTERVAL_MS = 300;
// ...and within this many px of it. Deliberately looser than TAP_MAX_MOVEMENT_PX — a real
// double-tap's second finger-down rarely lands exactly where the first one lifted.
const DOUBLE_TAP_MAX_DISTANCE_PX = 40;
// Once armed (see MapWidget._zoom_rotate_state), the second tap's finger has to move at least
// this far from where it landed before the gesture commits to 'active' — small enough that the
// zoom/rotate feels immediate once it starts, large enough that the finger merely settling back
// onto the screen for the second tap doesn't itself read as the start of a drag.
const ZOOM_ROTATE_ACTIVATION_PX = 10;
// Screen pixels of vertical drag per doubling/halving of zoom, once 'active' — see the touchmove
// handler's `Math.pow(2, -dy / ZOOM_DRAG_PX_PER_DOUBLING)`. Picked on the same "feel", not
// measured, footing as ROTATE_DRAG_SENSITIVITY above (which reaches its own "full effect", a 180°
// turn, over roughly the same ~300px), so a diagonal drag zooms and rotates at comparably paced
// rates instead of one axis visibly outrunning the other.
const ZOOM_DRAG_PX_PER_DOUBLING = 300;

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

// ZOOM-3: the subset of a multi-touch gesture's geometry the touchmove handler needs from one
// event to the next — see MapWidget._touchGestureState()/_touches.
interface TouchGestureState {
  count: number;
  centroid: XY; // average of every active touch's position — drives panning, any touch count
  // distance/angle are only meaningful (and only read) when count === 2 — see the touchmove
  // handler's own gating.
  distance: number;
  angle: number;
}

// ZOOM-13: a completed, still-pending single tap — set by touchend when a lone touch's duration
// and movement both stayed under TAP_MAX_DURATION_MS/TAP_MAX_MOVEMENT_PX. Matched against by the
// very next single-finger touchstart to decide whether that one is the second tap of a
// double-tap — see MapWidget._tap_pending and the touchstart handler below.
export interface PendingTap {
  time: number;
  pos: XY;
}

// ZOOM-13: bookkeeping for the touch currently down alone, not yet known to be a tap or a drag —
// recorded at touchstart so touchend can measure its final duration/movement against
// TAP_MAX_DURATION_MS/TAP_MAX_MOVEMENT_PX. Cleared (not just left stale) the moment a second
// finger joins, or the touch is consumed into an armed zoom/rotate gesture instead — see the
// touchstart handler.
interface SingleTouchStart {
  id: number;
  time: number;
  pos: XY;
}

// ZOOM-13: pure, DOM-free predicates for the tap/double-tap/activation-threshold timing-and-
// distance checks the touchstart/touchmove/touchend handlers below need — extracted specifically
// so they're unit-testable without a live touch device or Playwright (see map.test.ts), the same
// reasoning ZOOM-12's classifyWheelEvent extraction already established for this file. The rest of
// the gesture's state machine (transitions between null/'armed'/'active', which touch id is being
// tracked, draining deltas into zoomBy()/_drotation) stays inline in the handlers themselves —
// unlike classifyWheelEvent, that part is inseparable from live Touch/TouchEvent objects and
// MapWidget's other mutable fields (_zoom_anchor_screen, zoomBy(), _drotation) without either
// duplicating them here or threading half the class through as parameters; see BACKLOG.md's
// ZOOM-13 entry for this judgment call.
export function isTap(durationMs: number, movementPx: number): boolean {
  return durationMs <= TAP_MAX_DURATION_MS && movementPx <= TAP_MAX_MOVEMENT_PX;
}

export function isDoubleTapContinuation(pending: PendingTap | null, now: number, pos: XY): boolean {
  if (!pending) return false;
  const elapsed = now - pending.time;
  const distance = Math.hypot(pos.x - pending.pos.x, pos.y - pending.pos.y);
  return elapsed <= DOUBLE_TAP_MAX_INTERVAL_MS && distance <= DOUBLE_TAP_MAX_DISTANCE_PX;
}

export function hasCrossedActivationThreshold(start: XY, pos: XY): boolean {
  return Math.hypot(pos.x - start.x, pos.y - start.y) > ZOOM_ROTATE_ACTIVATION_PX;
}

export class MapWidget { // todo: setup layers
  fps_stat: AvgRing;
  dt_stat: AvgRing;
  layers: Layer[];
  zoom_animation_factor: number;
  zoom_step_factor: number;
  // BOOKMARK-1: empty by default — loading previously-saved bookmarks (e.g. from localStorage)
  // is entirely the host's job (see BookmarkStore's own doc comment, and the demo's DEMO-7),
  // same as MapWidget never reads state from the URL on its own either.
  bookmarks: BookmarkStore;

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
  // frame in onRepaint rather than acted on once per keydown. Stores KeyboardEvent.code (KEY-1 —
  // the physical key, unaffected by keyboard layout/language; see the DEFAULT_PAN_*/
  // DEFAULT_*_HOLD_KEYS comment near the top of this file).
  private _keysDown: Set<string>;
  private t?: number;
  // ZOOM-1: screen point (canvas pixel coords) that a zoom gesture should keep fixed in place
  // while zoom_factor eases towards zoom_target across several frames — not just once at the
  // end. Set by the wheel handler to the cursor position; cleared (-> zoom around center) by
  // the keyboard shortcuts, which have no cursor position to anchor to.
  private _zoom_anchor_screen: XY | null;
  // ZOOM-12: device-classification state carried from one `wheel` event to the next — see
  // classifyWheelEvent's own doc comment. `_wheel_last_time` is that event's `performance.now()`,
  // used to compute the gap/cadence classifyWheelEvent needs; `_wheel_grace_timer` is the pending
  // WHEEL_CLASSIFY_GRACE_MS timeout (if any) started when a new, not-yet-classified gesture began.
  private _wheel_state: WheelClassifyState;
  private _wheel_last_time: number;
  private _wheel_grace_timer: ReturnType<typeof setTimeout> | null;
  // ZOOM-3: canvas-local position of every currently active touch, keyed by
  // Touch.identifier (stable for the lifetime of that contact, unlike array index). Rebuilt
  // wholesale from the event's own touch list on every touchstart/touchmove/touchend — see
  // the handlers below — rather than patched incrementally, so it can never drift out of sync
  // with a missed or reordered event.
  private _touches: Map<number, XY>;
  // Snapshot of _touches reduced to what a gesture actually needs (see _touchGestureState) —
  // compared against the next touchmove's snapshot to get a *delta* (pan/scale/rotation since
  // the last event), the same incremental style the mouse-drag handlers use with old_x/old_y,
  // rather than tracking a fixed baseline from gesture start (which would drift as fingers are
  // added/removed mid-gesture). Reset (to a fresh snapshot of whatever touches remain) on every
  // touchstart/touchend so a finger being added or lifted never produces a spurious jump.
  private _touch_gesture: TouchGestureState | null;
  // ZOOM-13: one-finger double-tap-and-hold zoom+rotate — see BACKLOG.md's ZOOM-13 entry for the
  // full design. `_tap_pending` is the last completed single tap, if it's still within
  // DOUBLE_TAP_MAX_INTERVAL_MS/_DISTANCE_PX of becoming a double-tap's first half.
  // `_single_touch_start` tracks the touch currently down alone, so touchend can tell whether it
  // qualifies as a tap at all. `_zoom_rotate_state` is the gesture's own small state machine:
  // `null` (not running), `'armed'` (a double-tap just landed, waiting to see if the second tap's
  // finger moves enough to commit), or `'active'` (committed — every further move zooms/rotates).
  // `_zoom_rotate_touch_id` identifies which live touch the armed/active gesture is tracking, so
  // an unrelated touchmove/touchend for some other finger is never mistaken for it (though a
  // second finger joining at all immediately cancels the gesture regardless — see the touchstart
  // handler). `_zoom_rotate_start` is the second tap's own position: the reference point for the
  // armed->active activation-distance check, and — unchanged for the rest of the gesture — also
  // what `_zoom_anchor_screen` is set to once the gesture arms. `_zoom_rotate_last` is the most
  // recent position of the tracked touch, drained into zoomBy()/_drotation as an incremental delta
  // on every touchmove while 'active' (reset, not accumulated from `_zoom_rotate_start`, at the
  // moment the gesture crosses into 'active' — see the touchmove handler — so committing doesn't
  // itself apply a jump-sized delta for the whole armed-phase wobble). ZOOM-13 follow-up (axis
  // lock, BACKLOG.md): `_zoom_rotate_axis` is decided once, at the same armed->active crossing
  // that resets `_zoom_rotate_last` above, by comparing |dx|/|dy| of that one crossing move
  // (ties go to 'zoom') — it then stays fixed for the rest of the gesture so the 'active' branch
  // applies only that axis's effect, instead of re-deciding every frame (which would flicker
  // near a 45-degree diagonal).
  private _tap_pending: PendingTap | null;
  private _single_touch_start: SingleTouchStart | null;
  private _zoom_rotate_state: 'armed' | 'active' | null;
  private _zoom_rotate_touch_id: number | null;
  private _zoom_rotate_start: XY;
  private _zoom_rotate_last: XY;
  private _zoom_rotate_axis: 'zoom' | 'rotate' | null;

  constructor(container_id: string, options?: MapWidgetOptions) {
    this.fps_stat = new AvgRing(100);
    this.dt_stat = new AvgRing(100);
    this.layers = (options && options.layers) || []; // todo: скопировать options.layers, привести его к стандартному списку
    this.bookmarks = new BookmarkStore();
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
    this._wheel_state = { type: null };
    this._wheel_last_time = 0;
    this._wheel_grace_timer = null;
    this._touches = new Map();
    this._touch_gesture = null;
    this._tap_pending = null;
    this._single_touch_start = null;
    this._zoom_rotate_state = null;
    this._zoom_rotate_touch_id = null;
    this._zoom_rotate_start = { x: 0, y: 0 };
    this._zoom_rotate_last = { x: 0, y: 0 };
    this._zoom_rotate_axis = null;

    // ZOOM-3: without this, browsers apply their own gesture handling (page pinch-zoom,
    // scroll-by-touch, double-tap-to-zoom) to the canvas concurrently with ours — fighting each
    // other and, on some browsers, delaying or suppressing the touch events below entirely until
    // that gesture is resolved. `e.preventDefault()` in the handlers is the actual mechanism;
    // this is the CSS-level hint recommended alongside it.
    this.canvas.style.touchAction = 'none';

    let old_x = 0;
    let old_y = 0;

    // ZOOM-12: a laptop trackpad never sends TouchEvents to the browser (ZOOM-3's
    // touchstart/touchmove only ever hear from a real touchscreen) — every trackpad gesture
    // arrives here as `wheel` (and, Safari only, the separate gesturestart/gesturechange/
    // gestureend below). See BACKLOG.md's ZOOM-12 entry for the full design/citations.
    this.canvas.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaX === 0 && e.deltaY === 0) return;

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (trackpad two-finger pinch, or a physical Ctrl+wheel) — the browser sets
        // this flag specifically for that gesture (documented convention for canvas apps; Chrome
        // since M35, Firefox since 55), so it never needs the device-classification heuristic
        // below at all. Same zoom path a classified 'wheel' event uses (ZOOM-9/ZOOM-10), boosted
        // by PINCH_ZOOM_SENSITIVITY (ZOOM-14) since a pinch's per-event deltaY is much smaller
        // than a mouse notch's — see that constant's comment.
        this._wheelZoom(e, PINCH_ZOOM_SENSITIVITY);
        e.preventDefault();
        return;
      }

      // ctrlKey/metaKey is false here — a real mouse-wheel notch and a trackpad two-finger swipe
      // both report ctrlKey:false, so classifyWheelEvent's device-classification heuristic is
      // what tells them apart (imperfectly, per real-world field experience — see BACKLOG.md's
      // ZOOM-12 entry: this is an inherent Web Platform ambiguity, not a bug this eliminates).
      const now = performance.now();
      const result = classifyWheelEvent(e.deltaY, e.deltaMode, now, this._wheel_last_time, this._wheel_state);
      this._wheel_state = result.state;
      this._wheel_last_time = now;

      if (result.startGraceTimer) {
        // A new gesture just started and its type isn't knowable from timing alone yet — give it
        // WHEEL_CLASSIFY_GRACE_MS to either resolve (a follow-up event arrives fast enough to
        // classify by cadence) or, if nothing follows, default to 'wheel': a real mouse only ever
        // sends one event per notch, so a lone event with no fast follow-up is far more likely a
        // single click than the unwitnessed start of a trackpad stream.
        if (this._wheel_grace_timer !== null) clearTimeout(this._wheel_grace_timer);
        this._wheel_grace_timer = setTimeout(() => {
          if (this._wheel_state.type === null) this._wheel_state = { type: 'wheel' };
          this._wheel_grace_timer = null;
        }, WHEEL_CLASSIFY_GRACE_MS);
      } else if (this._wheel_grace_timer !== null) {
        // Classification resolved (or was already unambiguous) before the timer fired — nothing
        // left for it to default.
        clearTimeout(this._wheel_grace_timer);
        this._wheel_grace_timer = null;
      }

      if (result.type === 'trackpad') {
        this._wheelPan(e);
      } else {
        // 'wheel', or still undecided (grace window) — default to the existing zoom behavior:
        // safe for a real mouse (matches today, no regression) and the same bias mapbox itself
        // uses for the undecided case.
        this._wheelZoom(e);
      }

      e.preventDefault();
    });

    // ZOOM-12: two-finger trackpad *rotate* — Safari-only. Confirmed (BACKLOG.md's ZOOM-12
    // entry, several independent sources): no standard, and no Chrome/Firefox-proprietary event
    // either, exposes this gesture to JS at all — Safari's own nonstandard `gesturestart`/
    // `gesturechange`/`gestureend` (`.rotation` in degrees, cumulative since gesturestart) are the
    // only way any browser surfaces it. Feature-detected via `'ongesturestart' in window` rather
    // than UA sniffing, so this stays entirely inert (no listeners attached, nothing to throw) in
    // Chrome/Firefox, where these events never fire and `GestureEvent` doesn't even exist. This
    // is the complete, final fix for the audience it's technically possible for — not a partial
    // workaround pending a Chrome/Firefox equivalent that doesn't exist (see BACKLOG.md).
    if ('ongesturestart' in window) {
      let gestureLastRotation = 0;

      this.canvas.addEventListener('gesturestart', (e: GestureEvent) => {
        gestureLastRotation = e.rotation;
        e.preventDefault();
      });

      this.canvas.addEventListener('gesturechange', (e: GestureEvent) => {
        // `e.rotation` is cumulative degrees since gesturestart, not a per-event delta — take the
        // delta since the last gesturechange, the same incremental style the touchmove handler
        // below uses for its own two-finger angle (previous/current, not "since gesture start").
        const deltaDegrees = e.rotation - gestureLastRotation;
        gestureLastRotation = e.rotation;

        // Sign: per WebKit's own documentation, positive `.rotation` is a clockwise two-finger
        // turn. ZOOM-3's touch-rotate fix already established (by inspecting the actual
        // gridMatrix produced, not by guessing) that a physical CLOCKWISE two-finger turn needs
        // `rotation` to end up NEGATIVE for the map content to visibly turn clockwise on screen —
        // same subtraction here, for the same reason, applied straight into `_drotation` (the
        // same accumulator Shift+drag and touch-rotate already write into — see ROT-1/ZOOM-3).
        this._drotation -= (deltaDegrees * Math.PI) / 180;
        e.preventDefault();
      });

      this.canvas.addEventListener('gestureend', (e: GestureEvent) => {
        e.preventDefault();
      });
    }

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

    // ZOOM-3: one finger pans; two fingers pan+pinch-zoom+rotate simultaneously (the standard
    // mobile-map gesture set — Google/Apple/Leaflet all do the same three-in-one on two touches).
    // Reuses the existing pan/zoom/rotate machinery rather than duplicating it: pan goes through
    // the same `_dx`/`_dy` accumulator (and so the same scrollType/inertia handling) mouse-drag
    // uses, pinch through the same `zoomBy()` + `_zoom_anchor_screen` the wheel handler uses, and
    // twist through the same `_drotation` accumulator Shift+drag uses.
    const touchPoint = (t: Touch): XY => {
      // Touch (unlike MouseEvent) has no offsetX/offsetY — the canvas's own bounding rect is the
      // only way to get canvas-local coordinates from its page-relative clientX/clientY.
      const rect = this.canvas.getBoundingClientRect();
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };

    // Rebuilds `_touches` wholesale from `touches` (a TouchList — e.touches on every touch event
    // type) rather than patching it incrementally, so a missed or out-of-order event can't leave
    // it stale; see _touches's own doc comment.
    const syncTouches = (touches: TouchList): void => {
      this._touches.clear();
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        this._touches.set(t.identifier, touchPoint(t));
      }
    };

    // Centroid (pan reference, any touch count) plus, for exactly two touches, the distance and
    // angle between them (pinch-zoom/twist reference) — see TouchGestureState's own doc comment
    // on why only the reduced snapshot is kept rather than the raw touch list.
    const touchGestureState = (): TouchGestureState | null => {
      const points = Array.from(this._touches.values());
      if (points.length === 0) return null;
      let cx = 0, cy = 0;
      for (const p of points) { cx += p.x; cy += p.y; }
      cx /= points.length;
      cy /= points.length;
      let distance = 0;
      let angle = 0;
      if (points.length === 2) {
        const [a, b] = points;
        distance = Math.hypot(b.x - a.x, b.y - a.y);
        angle = Math.atan2(b.y - a.y, b.x - a.x);
      }
      return { count: points.length, centroid: { x: cx, y: cy }, distance, angle };
    };

    this.canvas.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length >= 2 && this._zoom_rotate_state !== null) {
        // ZOOM-13: a second finger joining while the one-finger double-tap-hold gesture is
        // armed/active is a deliberate, immediate cancel (BACKLOG.md is explicit about this, the
        // same "don't hedge further" reasoning as arming itself) — fall back to the existing
        // two-finger pan/pinch/rotate handling below completely unchanged.
        this._zoom_rotate_state = null;
        this._zoom_rotate_touch_id = null;
        this._zoom_rotate_axis = null;
      }

      if (e.touches.length === 1) {
        // A lone finger just went down — either the second tap of a double-tap (if it lands close
        // enough, soon enough, to `_tap_pending`), or just an ordinary touch that touchend will
        // later judge as a tap or a drag.
        const t = e.touches[0];
        const pos = touchPoint(t);
        const now = performance.now();
        if (isDoubleTapContinuation(this._tap_pending, now, pos)) {
          // ZOOM-13: second tap of a double-tap — arm the gesture. Ordinary single-finger pan for
          // THIS touch's subsequent movement is fully, deliberately suppressed from here on (see
          // the touchmove handler below), not merely deferred pending further evidence.
          this._zoom_rotate_state = 'armed';
          this._zoom_rotate_touch_id = t.identifier;
          this._zoom_rotate_start = pos;
          this._zoom_rotate_last = pos;
          // Fixed for the whole gesture, unlike the pinch/wheel anchor which tracks the live
          // touch/cursor position every event — see _zoom_rotate_start's own doc comment.
          this._zoom_anchor_screen = pos;
          this._tap_pending = null;
          this._single_touch_start = null;
        } else {
          // Not a double-tap continuation — an ordinary lone touch; touchend below decides whether
          // it actually qualifies as a (new pending) tap.
          this._single_touch_start = { id: t.identifier, time: now, pos };
        }
      } else {
        // Two or more fingers down — not a lone touch, so it can't itself become or continue a tap.
        this._single_touch_start = null;
      }

      syncTouches(e.touches);
      // Fresh baseline for the next touchmove's delta — see _touch_gesture's own doc comment on
      // why a finger being added mid-gesture must not produce a jump against a stale one.
      this._touch_gesture = touchGestureState();
      this._mouse_move_flag = 1;
      this._mouse_down_flag = 1;
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();

      if (this._zoom_rotate_state !== null) {
        // ZOOM-13: the one-finger double-tap-hold gesture owns this touch's movement completely —
        // see the touchstart handler above for why, and BACKLOG.md's ZOOM-13 entry for the full
        // design. Kept in sync for hygiene/consistency with the invariant _touch_gesture normally
        // upholds (see its own doc comment) even though this branch doesn't itself read it back.
        syncTouches(e.touches);
        this._touch_gesture = touchGestureState();

        let t: Touch | null = null;
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === this._zoom_rotate_touch_id) { t = e.touches[i]; break; }
        }
        if (t) {
          const pos = touchPoint(t);
          if (this._zoom_rotate_state === 'armed') {
            if (hasCrossedActivationThreshold(this._zoom_rotate_start, pos)) {
              // Crossing the activation threshold commits to 'active' — the incremental-delta
              // baseline resets to THIS point, not the original tap position, so the very move
              // that crosses the threshold doesn't itself apply a jump-sized delta for the whole
              // armed-phase wobble (BACKLOG.md is explicit about this).
              this._zoom_rotate_state = 'active';
              this._zoom_rotate_last = pos;
              // ZOOM-13 follow-up (BACKLOG.md, "не включались одновременно и вращение и
              // масштабирование"): decide the axis once, right here, off THIS crossing move only
              // (current position minus _zoom_rotate_start, not any later move) — whichever of
              // |dx|/|dy| is larger wins, a tie goes to 'zoom'. Fixed for the rest of the gesture
              // rather than re-decided every frame, so a diagonal move near 45 degrees doesn't
              // flicker between zoom and rotate.
              const crossDx = pos.x - this._zoom_rotate_start.x;
              const crossDy = pos.y - this._zoom_rotate_start.y;
              this._zoom_rotate_axis = Math.abs(crossDx) > Math.abs(crossDy) ? 'rotate' : 'zoom';
            }
          } else {
            // 'active': only the axis locked at the armed->active transition applies — the other
            // axis's update is not called at all (not just zeroed/suppressed after computing it),
            // per BACKLOG.md's follow-up.
            const last = this._zoom_rotate_last;
            const dy = pos.y - last.y;
            const dx = pos.x - last.x;
            this._zoom_rotate_last = pos;

            if (this._zoom_rotate_axis === 'zoom') {
              if (dy !== 0) {
                // Up (dy<0) = zoom in, down = zoom out — same sign as Google Maps' own one-finger
                // double-tap-drag zoom (BACKLOG.md). `_zoom_anchor_screen` stays whatever it was
                // set to at arm time (the second tap's position, fixed for the whole gesture) —
                // zoomBy()/onRepaint's existing anchor-drift correction does the rest, same as
                // pinch/wheel zoom.
                this.zoomBy(Math.pow(2, -dy / ZOOM_DRAG_PX_PER_DOUBLING));
              }
            } else if (this._zoom_rotate_axis === 'rotate') {
              if (dx !== 0) {
                // Same formula, same ROTATE_DRAG_SENSITIVITY, and the same sign convention as
                // Shift+drag above (`old_x - new_x`, i.e. `last.x - pos.x` here) — reused verbatim
                // rather than re-derived, per BACKLOG.md, so both inputs feel identical.
                this._drotation += (last.x - pos.x) * ROTATE_DRAG_SENSITIVITY;
              }
            }
          }
        }
        return;
      }

      const previous = this._touch_gesture;
      syncTouches(e.touches);
      const current = touchGestureState();

      if (previous && current) {
        // Pan: same delta convention as the mousemove handler above (old position minus new,
        // accumulated into _dx/_dy and drained every frame in onRepaint) — works for any touch
        // count, including a mid-gesture change (e.g. lifting one of two fingers), since it's
        // always just "how far did the centroid move since the last event".
        this._dx += previous.centroid.x - current.centroid.x;
        this._dy += previous.centroid.y - current.centroid.y;

        if (previous.count === 2 && current.count === 2 && previous.distance > 0) {
          // Pinch-zoom, anchored at the pinch midpoint (same idea as the wheel handler's cursor
          // anchor) so whatever's between the fingers stays there as the zoom eases in.
          this._zoom_anchor_screen = current.centroid;
          this.zoomBy(current.distance / previous.distance);

          // Two-finger twist, applied directly into `_drotation` (immediate/un-eased, like
          // Shift+drag) rather than easing towards a target the way the discrete [/] keys do.
          // atan2's result wraps at +-PI, so a naive subtraction would jump by ~2*PI right as the
          // fingers' relative angle crosses that boundary — normalized back into (-PI, PI] via
          // atan2(sin(d), cos(d)), the standard trick for a correct *shortest* angular delta.
          //
          // Subtracted, not added: `current.angle - previous.angle` is the change in the
          // fingers' angle in *screen/canvas pixel* coordinates (y grows downward). `rotation`
          // instead measures how much the camera has turned relative to the *world* — rotating
          // the camera by +delta turns the world under it by -delta as seen on screen (the same
          // relationship screenToWorld/worldToScreen use camera.worldMatrix vs. its inverse for).
          // Adding the raw screen-angle delta therefore turned the map opposite to the fingers —
          // direct user report ("вращение крутит карту не в ту сторону"), confirmed by reasoning
          // through that relationship rather than by a sign that merely "looked" plausible.
          const rawDelta = current.angle - previous.angle;
          this._drotation -= Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
        }
      }

      this._touch_gesture = current;
    }, { passive: false });

    const onTouchEnd = (e: TouchEvent): void => {
      e.preventDefault();

      if (this._zoom_rotate_state !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this._zoom_rotate_touch_id) {
            // ZOOM-13: ends the gesture either way — 'active' had an explicit drag (not a tap);
            // 'armed' without ever crossing the activation threshold is BACKLOG.md's "clean
            // double-tap, no drag" case, reset with no special action and — per BACKLOG.md — not
            // re-entered into tap matching (this touch's own tap was already consumed when it
            // armed the gesture at touchstart, see there).
            this._zoom_rotate_state = null;
            this._zoom_rotate_touch_id = null;
            this._zoom_rotate_axis = null;
            break;
          }
        }
      } else if (e.type === 'touchend') {
        // Not touchcancel — an aborted contact never completes a tap. Did the touch that just
        // ended qualify as an ordinary tap? If so, it becomes the new pending tap for the very
        // next touchstart to potentially pair with (see the touchstart handler above).
        for (let i = 0; i < e.changedTouches.length; i++) {
          const ct = e.changedTouches[i];
          if (this._single_touch_start && this._single_touch_start.id === ct.identifier) {
            const pos = touchPoint(ct);
            const now = performance.now();
            const start = this._single_touch_start;
            const duration = now - start.time;
            const moved = Math.hypot(pos.x - start.pos.x, pos.y - start.pos.y);
            if (isTap(duration, moved)) {
              this._tap_pending = { time: now, pos };
            }
            this._single_touch_start = null;
            break;
          }
        }
      }

      syncTouches(e.touches);
      // Fresh baseline again (see touchstart) — covers going from two fingers down to one (keeps
      // panning, cleanly drops pinch/twist) as well as the last finger lifting.
      this._touch_gesture = touchGestureState();
      if (this._touches.size === 0) this._mouse_move_flag = 0;
    };
    this.canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

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
      // Exact tracking every frame regardless of state — see ZOOM-11 below for why this can no
      // longer also get an extra, decaying `_scroll_velocity` blended in while still in contact.
      this.scroll(this._dx, this._dy);
      if (this._mouse_down_flag) this._scroll_velocity.set(0, 0); // new press/touch cancels any residual glide from a previous release

      if (this._mouse_move_flag) {
        // ZOOM-11: in contact (mouse button down, or a touch active) — track the cursor/fingers
        // exactly, with no inertia blended in yet. `_scroll_velocity` here is only ever a
        // *candidate* release velocity: `.set()`, not `.add()`, so it's overwritten every frame
        // with just this frame's motion rather than accumulating while held — otherwise a long,
        // steady drag would keep piling an ever-growing "hangover" on top of the already-exact
        // `scroll()` above, making tracking increasingly inexact the longer contact lasted (the
        // bug reported: "карта должна следовать за пальцами в точности... инерция должна
        // сохраняться только при отпускании"). Whatever this holds at the exact frame contact
        // ends is what carries on below.
        this._scroll_velocity.set(this._dx * this.sliding_value, this._dy * this.sliding_value);
      } else if (this._scroll_velocity.length2()) {
        // Released: let the velocity captured the instant contact ended continue and decay.
        // ROT-6: routed through scroll() (not a direct this.c.add()) so the same rotation
        // treatment as every other pan path applies here too.
        this.scroll(this._scroll_velocity.x, this._scroll_velocity.y);
        this._scroll_velocity.div(this.inertion_value + 1);
        if (this._scroll_velocity.length2() < 0.1) this._scroll_velocity.set(0, 0);
      }
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

  /**
   * BOOKMARK-1: jump to a previously saved Bookmark by id. A no-op if `id` isn't in
   * `this.bookmarks`. MVP behavior — direct assignment, no animation, same as the demo's
   * pre-existing `locations[...].go()` pattern (src/index.ts) this generalizes: `flyTo`/`jumpTo`
   * (BACKLOG.md's FLY-*) can replace this once that phase lands, but doesn't block BOOKMARK-1.
   *
   * Layer resolution: this codebase has no stable per-layer id concept to hook into (no field on
   * `Layer` is documented/guaranteed unique — see BACKLOG.md's BOOKMARK-1 note). Reusing `Layer.name`
   * — already present and already used to identify a layer for display (e.g. the demo's layer-
   * visibility checkboxes) — is the smallest reasonable addition: no new field on `Layer`, no new
   * lookup structure on `MapWidget`. A bookmark whose `layerId` doesn't match any current layer's
   * `name` (renamed/removed layer, or a typo) silently does nothing to layer visibility rather than
   * throwing — the position/zoom/rotation part of the jump should still happen either way.
   */
  goToBookmark(id: string): void {
    const bookmark = this.bookmarks.get(id);
    if (!bookmark) return;

    this.locate(bookmark.position);
    if (bookmark.zoom !== undefined) this.zoom_target = bookmark.zoom;
    if (bookmark.rotation !== undefined) this.rotation_target = bookmark.rotation;
    if (bookmark.layerId !== undefined) {
      const layer = this.layers.find((l) => l.name === bookmark.layerId);
      if (layer) layer.visible = true;
    }
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

  // ZOOM-9/ZOOM-10/ZOOM-12: the wheel-driven zoom step, pulled out of the `wheel` listener so
  // ZOOM-12's ctrlKey/pinch branch and its 'wheel'-classified branch can both reach it without
  // duplicating the logic. `sensitivity` (ZOOM-14) defaults to 1 — the 'wheel'-classified call
  // site below passes nothing and behaves exactly as before; only the ctrlKey/pinch branch passes
  // PINCH_ZOOM_SENSITIVITY.
  private _wheelZoom(e: WheelEvent, sensitivity: number = 1): void {
    const dy = -e.deltaY * sensitivity;
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
  }

  // ZOOM-12: trackpad two-finger swipe, classified by classifyWheelEvent — panned instead of
  // zoomed (this project's own deliberate choice for canvas apps, the way Figma/tldraw treat a
  // trackpad swipe, unlike mapbox-gl-js itself — mapbox only ever uses this same classification
  // to pick a zoom *rate*, never to switch to panning). Routed through scroll() (ROT-6: already
  // rotation-aware) with the same divide-by-zoom_factor convention `_dx`/`_dy` get everywhere
  // else in this file (the mouse-drag drain and the WASD speed calc in onRepaint) before reaching
  // it.
  //
  // Sign: deltaX/deltaY are applied directly, with NO extra negation — derived, not copied from
  // an existing convention verbatim, but cross-checked against the mouse-drag pan below rather
  // than guessed. A `wheel` event's deltaX/deltaY use the same convention as an ordinary page
  // scroll: positive means "reveal more content in that direction" (scrolling down/right) — the
  // same on-screen *effect* dragging the content up/left produces. That's exactly the existing
  // mouse-drag pan's sign (see the mousemove handler above: dragging up, `e.pageY` decreasing,
  // yields a positive `_dy`, which increases `c.y` — the same "reveal what's below" effect). So
  // deltaX/deltaY need no sign flip here to match it — unlike the wheel-zoom path above, which
  // does negate deltaY, but for the unrelated "scroll up = zoom in" map-UX convention, not pan
  // direction.
  //
  // No inertia/velocity accumulation of our own here — deliberate, see BACKLOG.md's ZOOM-12
  // entry: macOS/Windows Precision Touchpad momentum scroll already re-fires a naturally-decaying
  // stream of `wheel` events after the fingers lift (`preventDefault()` doesn't stop them), so
  // applying each classified event as an exact scroll() (the same "exact during contact"
  // principle ZOOM-11 already established for touch/mouse-drag) already produces a natural
  // flick-and-glide, without duplicating `_scroll_velocity`'s physics for a second input source.
  private _wheelPan(e: WheelEvent): void {
    this.scroll(e.deltaX / this.zoom_factor, e.deltaY / this.zoom_factor);
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

  /**
   * Eases `rotation` by this many radians. Unbounded — rotation can wind up past a full turn;
   * see resetRotation().
   *
   * Sign note (corrected while tracking down ZOOM-3's backwards multitouch-rotate bug — verified
   * by inspecting the actual gridMatrix `camera.rotation` produces, not just by inference): this
   * previously claimed "positive = clockwise on screen, matching Mat2D.rotation", which is
   * backwards. `rotation` is the *camera's* turn relative to the world; camera.worldMatrix.invert()
   * (what actually places content on screen — see computeTileGridMatrix) applies the *negated*
   * angle, so increasing `rotation` turns the displayed content COUNTER-clockwise, not clockwise.
   */
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
  // LAYER-6: see Layer.kind's own doc comment. Optional, defaults to 'cartographic' — existing
  // layer configs don't need to set this.
  kind?: 'cartographic' | 'local';
  [key: string]: unknown;
}

export class Layer {
  name?: string;
  // LAYER-6: metadata only for MVP — no runtime enforcement/gating in core rendering. Lets the
  // demo layer panel (DEMO-1) and future LAYER-1 layer manager group base layers by kind (e.g.
  // separate radio-groups for "map-like" vs. "arbitrary" backgrounds) instead of one flat list.
  // Defaults to 'cartographic' so every existing layer config (none of which sets this) keeps
  // behaving exactly as before.
  kind: 'cartographic' | 'local';
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
    this.kind = (options && options.kind) || 'cartographic';
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
// LAYER-6: the actual real-data extent of a tile source, in shared *world* units (the same units
// as `map.c`/`Vector` — NOT lon/lat; there's no PROJ-* yet to convert). Deliberately a separate,
// differently-named type from the existing `z_max` field just below (which, despite its name, is
// a z-*offset* applied to every layer, not a limit — see the many `// todo: rename to z_deep`
// comments already in this file) — see TiledLayerOptions.bounds/zLevelMin/zLevelMax's own
// comments for why `z_max` is deliberately left untouched here.
export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

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
  // LAYER-6: intentionally NOT touched/renamed/reinterpreted — see WorldBounds's comment above.
  z_max?: number;
  // LAYER-6: the real pyramid-depth range this tile source has data for. Optional — unset means
  // today's behavior (the computed level tracks zoom_factor unclamped). When set,
  // getLevelParams()/draw() clamp the *final* level (after the z_max offset above is applied) into
  // this range, so a source that has, say, no tiles deeper than z=18 stops requesting/drawing
  // levels past that instead of asking for tiles that don't exist.
  zLevelMin?: number;
  zLevelMax?: number;
  // LAYER-6: real-data extent in world units — see WorldBounds. Optional — unset means today's
  // behavior (tiles are requested/drawn across the whole visible index range with no cutoff).
  // When set, draw() skips (does not call tile_source.get() for, does not draw) any tile whose
  // index square falls entirely outside it — useful for a source that only covers a finite region
  // of the world (e.g. XKCD's comic) or any future regional dataset.
  bounds?: WorldBounds;
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
  // LAYER-6: this layer's `bounds` (world units) converted into tile-*index* space, ready for
  // draw()'s per-tile skip check below — undefined when the layer has no `bounds` set (today's
  // unbounded behavior).
  tileIndexBounds?: WorldBounds;
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

// LAYER-6: converts `bounds` (a rect in shared *world* units — see WorldBounds) into the
// equivalent rect in this layer's tile-*index* space (one unit = one tile — the same space
// tx/ty/dx/dy and the draw() loop's ix/iy already live in), so draw() can cheaply test each
// candidate tile index against it. Goes through `layerTransform` (not just `world_tile_edge`)
// so a layer with its own nonzero shift/scale/rotation (AFF-4) is bounded correctly too, the same
// way computeTileGridMatrix folds `layerTransform` into tile placement; the four corners of
// `bounds` are projected through the inverse and re-bounded, mirroring the exact approach
// getLevelParams already uses for the canvas viewport corners (ROT-3) — necessary in general
// since a rotated transform turns an axis-aligned world rect into a non-axis-aligned one in
// index space, so only its bounding box is used here (slightly permissive at the very corners of
// a rotated bounds under a rotated layer transform — an edge case with no real layer today).
// DOM-free and exported for the same reason as computeTileGridMatrix — unit-testable independent
// of any live canvas/browser (see map.test.ts).
export function computeTileIndexBounds(
  layerTransform: Transform2D,
  world_tile_edge: number,
  bounds: WorldBounds
): WorldBounds {
  const inv = layerTransform.worldMatrix.invert();
  const corners = [
    inv.transformPoint({ x: bounds.minX, y: bounds.minY }),
    inv.transformPoint({ x: bounds.maxX, y: bounds.minY }),
    inv.transformPoint({ x: bounds.minX, y: bounds.maxY }),
    inv.transformPoint({ x: bounds.maxX, y: bounds.maxY })
  ];
  let minX = corners[0].x, maxX = corners[0].x;
  let minY = corners[0].y, maxY = corners[0].y;
  for (let i = 1; i < corners.length; i++) {
    if (corners[i].x < minX) minX = corners[i].x;
    if (corners[i].x > maxX) maxX = corners[i].x;
    if (corners[i].y < minY) minY = corners[i].y;
    if (corners[i].y > maxY) maxY = corners[i].y;
  }
  return {
    minX: minX / world_tile_edge,
    minY: minY / world_tile_edge,
    maxX: maxX / world_tile_edge,
    maxY: maxY / world_tile_edge
  };
}

export class TiledLayer extends Layer {
  tile_source?: TileSource;
  tile_size: number;
  onTileDraw?: TiledLayerOptions['onTileDraw'];
  // LAYER-6: intentionally NOT touched/renamed/reinterpreted — see WorldBounds's comment above.
  z_max?: number;
  // LAYER-6: see TiledLayerOptions' own comments.
  zLevelMin?: number;
  zLevelMax?: number;
  bounds?: WorldBounds;
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
    this.zLevelMin = options && options.zLevelMin;
    this.zLevelMax = options && options.zLevelMax;
    this.bounds = options && options.bounds;
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

    // LAYER-6: clamp the *final* level (z_max offset already applied) into [zLevelMin, zLevelMax]
    // when either is set — z_max itself stays the untouched offset it always was (see its own
    // comment); this only bounds what comes out the other end. Unset (the default) means no
    // clamping at all, i.e. today's behavior.
    let level = z + (this.z_max || 0);
    if (this.zLevelMin !== undefined) level = Math.max(level, this.zLevelMin);
    if (this.zLevelMax !== undefined) level = Math.min(level, this.zLevelMax);

    return {
      z: level,
      k,
      tile_size,
      world_tile_edge,
      tx,
      ty,
      dx,
      dy,
      gridMatrix,
      // LAYER-6: undefined when `bounds` isn't set — draw() only does the per-tile skip check
      // when this is present.
      tileIndexBounds: this.bounds ? computeTileIndexBounds(this.transform, world_tile_edge, this.bounds) : undefined
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
    const tileIndexBounds = level_params.tileIndexBounds;
    this.visible_tile_count = (2 * dx + 1) * (2 * dy + 1);

    for (let y = ty - dy; y <= ty + dy; y++) {
      for (let x = tx - dx; x <= tx + dx; x++) {
        // LAYER-6: a tile index square is [x, x+1) x [y, y+1) in index space (see
        // computeTileIndexBounds) — skip it (no tile_source.get(), no draw) if that square falls
        // entirely outside `bounds`. No-op (tileIndexBounds undefined) when `bounds` isn't set.
        if (
          tileIndexBounds &&
          (x + 1 <= tileIndexBounds.minX ||
            x >= tileIndexBounds.maxX ||
            y + 1 <= tileIndexBounds.minY ||
            y >= tileIndexBounds.maxY)
        ) {
          continue;
        }
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
        // ZOOM-10: setTransform to `gridMatrix` AS-IS (its own e/f) and draw at the tile's raw
        // index (ix, iy) — the original AFF-4 approach — bakes the *combined* translation
        // (camera position folded in, tens of millions at this world's scale) into the canvas's
        // internal transform. That CTM is stored in single precision by the browser's rasterizer
        // (confirmed empirically — see BACKLOG.md), so at deep zoom (tile indices in the
        // 10^5-10^6 range, translation to match) it loses several *device pixels* of accuracy —
        // invisible while every frame rounds the same way, but the true (double-precision)
        // translation is shifting by a fraction of a pixel every frame during any zoom easing or
        // rotation, and each frame's rounding lands differently: the tile visibly trembles by a
        // few pixels, at any zoom (worst at max, where translation magnitude — and so absolute
        // rounding error — is largest) and independent of what's driving the change (wheel,
        // keyboard, rotation all recompute this matrix every frame alike). The grid/debug
        // overlays never had this problem because they compute each point in JS double precision
        // (`gridMatrix.transformPoint`) and hand the rasterizer already-small screen coordinates
        // directly, never a huge number baked into the CTM itself — see map_grid's onTileDraw.
        //
        // Fix: reuse `gridMatrix`'s linear part (a/b/c/d — its magnitude is always moderate,
        // nowhere near float32's precision limit) but replace its translation with this tile's
        // own precomputed on-screen top-left corner (`x`/`y`, already an ordinary screen-pixel
        // value, computed the same way map_grid computes its corners) and draw at local (0,0)
        // instead of (ix, iy). Mathematically identical placement (verified: local (0,0) maps to
        // exactly (x, y), same as gridMatrix.transformPoint({x: ix, y: iy}) does) — the only
        // change is which numbers the CTM itself has to carry.
        ctx.save();
        ctx.setTransform(gridMatrix.a, gridMatrix.b, gridMatrix.c, gridMatrix.d, x, y);
        ctx.drawImage(tile.image, 0, 0, this.tile_size, this.tile_size, 0, 0, 1, 1);
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

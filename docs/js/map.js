import { Vector } from './vector.js';
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
export function classifyWheelEvent(deltaY, deltaMode, now, lastTime, state) {
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
        const inferred = Math.abs(timeDelta * value) < WHEEL_TRACKPAD_TIME_DELTA_THRESHOLD ? 'trackpad' : 'wheel';
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
export function isTap(durationMs, movementPx) {
    return durationMs <= TAP_MAX_DURATION_MS && movementPx <= TAP_MAX_MOVEMENT_PX;
}
export function isDoubleTapContinuation(pending, now, pos) {
    if (!pending)
        return false;
    const elapsed = now - pending.time;
    const distance = Math.hypot(pos.x - pending.pos.x, pos.y - pending.pos.y);
    return elapsed <= DOUBLE_TAP_MAX_INTERVAL_MS && distance <= DOUBLE_TAP_MAX_DISTANCE_PX;
}
export function hasCrossedActivationThreshold(start, pos) {
    return Math.hypot(pos.x - start.x, pos.y - start.y) > ZOOM_ROTATE_ACTIVATION_PX;
}
export class MapWidget {
    constructor(container_id, options) {
        this.fps_stat = new AvgRing(100);
        this.dt_stat = new AvgRing(100);
        this.layers = (options && options.layers) || []; // todo: скопировать options.layers, привести его к стандартному списку
        this.bookmarks = new BookmarkStore();
        this.zoom_animation_factor = (options && options.zoom_animation_factor) || 10; // 1~100
        this.zoom_step_factor = (options && options.zoom_step_factor) || 0.2; // 0.1~0.9
        this.container = document.getElementById(container_id); // todo: throw error if not found
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
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
        this.canvas.addEventListener('wheel', (e) => {
            if (e.deltaX === 0 && e.deltaY === 0)
                return;
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
                if (this._wheel_grace_timer !== null)
                    clearTimeout(this._wheel_grace_timer);
                this._wheel_grace_timer = setTimeout(() => {
                    if (this._wheel_state.type === null)
                        this._wheel_state = { type: 'wheel' };
                    this._wheel_grace_timer = null;
                }, WHEEL_CLASSIFY_GRACE_MS);
            }
            else if (this._wheel_grace_timer !== null) {
                // Classification resolved (or was already unambiguous) before the timer fired — nothing
                // left for it to default.
                clearTimeout(this._wheel_grace_timer);
                this._wheel_grace_timer = null;
            }
            if (result.type === 'trackpad') {
                this._wheelPan(e);
            }
            else {
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
            this.canvas.addEventListener('gesturestart', (e) => {
                gestureLastRotation = e.rotation;
                e.preventDefault();
            });
            this.canvas.addEventListener('gesturechange', (e) => {
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
            this.canvas.addEventListener('gestureend', (e) => {
                e.preventDefault();
            });
        }
        document.addEventListener('keydown', (e) => {
            // Don't steal keystrokes meant for a text field — e.g. typing into a dat.GUI number box
            // (this also fixes a pre-existing bug: typing a "-" into one would have triggered
            // zoomOut()).
            const target = e.target;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
                return;
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
            }
            else if (this.zoomOutKeys.includes(e.key) || this.zoomOutKeys.includes(e.code)) {
                this._zoom_anchor_screen = null;
                this.zoomOut();
                e.preventDefault();
            }
            else if (this.rotateLeftKeys.includes(e.key) || this.rotateLeftKeys.includes(e.code)) {
                this.rotateBy(-ROTATE_KEY_STEP);
                e.preventDefault();
            }
            else if (this.rotateRightKeys.includes(e.key) || this.rotateRightKeys.includes(e.code)) {
                this.rotateBy(ROTATE_KEY_STEP);
                e.preventDefault();
            }
            else if (this.resetRotationKeys.includes(e.key) || this.resetRotationKeys.includes(e.code)) {
                this.resetRotation();
                e.preventDefault();
            }
        });
        document.addEventListener('keyup', (e) => {
            this._keysDown.delete(e.code);
        });
        // If focus leaves the window while a key is held (e.g. Alt+Tab), its keyup may never fire —
        // without this, that key would stay "stuck" down in _keysDown forever.
        window.addEventListener('blur', () => {
            this._keysDown.clear();
        });
        this.canvas.addEventListener('mousedown', (e) => {
            this._mouse_move_flag = 1;
            this._mouse_down_flag = 1;
            // ROT-1: hold Shift while dragging to rotate instead of pan. Decided once at mousedown,
            // for the whole gesture — doesn't switch mid-drag if Shift is pressed/released partway.
            this._rotate_drag = e.shiftKey;
            old_x = e.pageX;
            old_y = e.pageY;
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (this._mouse_move_flag) {
                if (this._rotate_drag) {
                    this._drotation += (old_x - e.pageX) * ROTATE_DRAG_SENSITIVITY;
                }
                else {
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
        this.canvas.addEventListener('dblclick', (e) => {
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
        const touchPoint = (t) => {
            // Touch (unlike MouseEvent) has no offsetX/offsetY — the canvas's own bounding rect is the
            // only way to get canvas-local coordinates from its page-relative clientX/clientY.
            const rect = this.canvas.getBoundingClientRect();
            return { x: t.clientX - rect.left, y: t.clientY - rect.top };
        };
        // Rebuilds `_touches` wholesale from `touches` (a TouchList — e.touches on every touch event
        // type) rather than patching it incrementally, so a missed or out-of-order event can't leave
        // it stale; see _touches's own doc comment.
        const syncTouches = (touches) => {
            this._touches.clear();
            for (let i = 0; i < touches.length; i++) {
                const t = touches[i];
                this._touches.set(t.identifier, touchPoint(t));
            }
        };
        // Centroid (pan reference, any touch count) plus, for exactly two touches, the distance and
        // angle between them (pinch-zoom/twist reference) — see TouchGestureState's own doc comment
        // on why only the reduced snapshot is kept rather than the raw touch list.
        const touchGestureState = () => {
            const points = Array.from(this._touches.values());
            if (points.length === 0)
                return null;
            let cx = 0, cy = 0;
            for (const p of points) {
                cx += p.x;
                cy += p.y;
            }
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
        this.canvas.addEventListener('touchstart', (e) => {
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
                }
                else {
                    // Not a double-tap continuation — an ordinary lone touch; touchend below decides whether
                    // it actually qualifies as a (new pending) tap.
                    this._single_touch_start = { id: t.identifier, time: now, pos };
                }
            }
            else {
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
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this._zoom_rotate_state !== null) {
                // ZOOM-13: the one-finger double-tap-hold gesture owns this touch's movement completely —
                // see the touchstart handler above for why, and BACKLOG.md's ZOOM-13 entry for the full
                // design. Kept in sync for hygiene/consistency with the invariant _touch_gesture normally
                // upholds (see its own doc comment) even though this branch doesn't itself read it back.
                syncTouches(e.touches);
                this._touch_gesture = touchGestureState();
                let t = null;
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === this._zoom_rotate_touch_id) {
                        t = e.touches[i];
                        break;
                    }
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
                    }
                    else {
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
                        }
                        else if (this._zoom_rotate_axis === 'rotate') {
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
        const onTouchEnd = (e) => {
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
            }
            else if (e.type === 'touchend') {
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
            if (this._touches.size === 0)
                this._mouse_move_flag = 0;
        };
        this.canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        this.canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
        window.onresize = this.onResize_callback;
        // todo: Попробовать повесить событие на ресайз контейнера а не окна. Убедиться, что не затёрли старый обработчик ресайза.
        this.onResize();
        this.onRepaint();
    }
    onResize() {
        this.canvas.height = this.container.clientHeight;
        this.canvas.width = this.container.clientWidth;
    }
    onRepaint() {
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
        if (this._isAnyKeyDown(this.panLeftKeys))
            moveX -= 1;
        if (this._isAnyKeyDown(this.panRightKeys))
            moveX += 1;
        if (this._isAnyKeyDown(this.panUpKeys))
            moveY -= 1;
        if (this._isAnyKeyDown(this.panDownKeys))
            moveY += 1;
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
            if (zoomOutHeld)
                this.zoomBy(Math.pow(1 / KEYBOARD_ZOOM_RATE_PER_SEC, frame_dt));
            if (zoomInHeld)
                this.zoomBy(Math.pow(KEYBOARD_ZOOM_RATE_PER_SEC, frame_dt));
        }
        // Q/E: continuous rotate while held — added straight into `_drotation`, the same
        // accumulator Shift+drag uses (drained a little further down), so it's immediate like a
        // drag rather than trailing an eased target the way rotateBy()'s discrete steps do.
        if (this._isAnyKeyDown(this.rotateLeftHoldKeys))
            this._drotation -= KEYBOARD_ROTATE_SPEED_RAD_PER_SEC * frame_dt;
        if (this._isAnyKeyDown(this.rotateRightHoldKeys))
            this._drotation += KEYBOARD_ROTATE_SPEED_RAD_PER_SEC * frame_dt;
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
        }
        else {
            this.rotation += (this.rotation_target - this.rotation) * zoom_alpha;
            if (Math.abs(this.rotation_target - this.rotation) < 1e-9)
                this.rotation = this.rotation_target;
        }
        this._dx /= this.zoom_factor;
        this._dy /= this.zoom_factor;
        // Простой скроллинг
        if (this.scrollType === 'simple')
            this.scroll(this._dx, this._dy);
        // Скроллинг с инерцией
        if (this.scrollType === 'inertial') {
            this.scroll(this._dx, this._dy);
            if (this._mouse_move_flag) {
                this._scroll_velocity.set(this._dx, this._dy);
            }
            else {
                if (this._scroll_velocity.length2())
                    this.scroll(this._scroll_velocity.x, this._scroll_velocity.y); // todo: Добавить поддержку вектора
                this._scroll_velocity.div(this.inertion_value + 1);
                if (this._scroll_velocity.length2() < 0.1)
                    this._scroll_velocity.set(0, 0);
            }
        }
        // Скроллинг с инерцией и скольжением
        if (this.scrollType === 'sliding') {
            // Exact tracking every frame regardless of state — see ZOOM-11 below for why this can no
            // longer also get an extra, decaying `_scroll_velocity` blended in while still in contact.
            this.scroll(this._dx, this._dy);
            if (this._mouse_down_flag)
                this._scroll_velocity.set(0, 0); // new press/touch cancels any residual glide from a previous release
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
            }
            else if (this._scroll_velocity.length2()) {
                // Released: let the velocity captured the instant contact ended continue and decay.
                // ROT-6: routed through scroll() (not a direct this.c.add()) so the same rotation
                // treatment as every other pan path applies here too.
                this.scroll(this._scroll_velocity.x, this._scroll_velocity.y);
                this._scroll_velocity.div(this.inertion_value + 1);
                if (this._scroll_velocity.length2() < 0.1)
                    this._scroll_velocity.set(0, 0);
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
            if (layer.visible)
                layer.draw(this);
        }
        this._mouse_down_flag = 0;
        window.requestAnimationFrame(this.onRepaint_callback);
    }
    update_url_position() {
        // ROT-2: third component is rotation in whole degrees (human-readable in the URL bar),
        // converted back to radians on parse. Old two-component links (src/index.ts's regex still
        // accepts them) simply come back in with rotation 0.
        const degrees = Math.round((this.rotation * 180) / Math.PI);
        const redirect = '#[' + Math.round(this.c.x) + ',' + Math.round(this.c.y) + ',' + degrees + ']';
        history.pushState('', '', redirect);
    }
    locate(x, y) {
        this.c = new Vector(x, y);
        if (this.onLocate)
            this.onLocate(this.c.x, this.c.y);
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
    goToBookmark(id) {
        const bookmark = this.bookmarks.get(id);
        if (!bookmark)
            return;
        this.locate(bookmark.position);
        if (bookmark.zoom !== undefined)
            this.zoom_target = bookmark.zoom;
        if (bookmark.rotation !== undefined)
            this.rotation_target = bookmark.rotation;
        if (bookmark.layerId !== undefined) {
            const layer = this.layers.find((l) => l.name === bookmark.layerId);
            if (layer)
                layer.visible = true;
        }
    }
    /**
     * STATE-1: snapshots the current viewport — position, zoom, rotation — into a plain,
     * JSON-friendly object. Reads the *target* values (`zoom_target`/`rotation_target`), not the
     * currently-eased `zoom_factor`/`rotation` — same choice BOOKMARK-1's `goToBookmark` makes in
     * reverse (assigning into `zoom_target`/`rotation_target`, not the eased fields directly), so a
     * save-then-restore round trip lands exactly where the user left off rather than wherever the
     * easing animation happened to be mid-flight at the moment of saving.
     */
    serializeState() {
        return {
            x: this.c.x,
            y: this.c.y,
            zoom: this.zoom_target,
            rotation: this.rotation_target
        };
    }
    /**
     * STATE-1: the inverse of serializeState() — applies a (possibly partial) previously-serialized
     * state to this widget. Every field is optional and applied independently: `x`/`y` only take
     * effect as a pair (a lone `x` or `y` isn't a valid position, so both are required together),
     * while `zoom`/`rotation` each apply on their own. Fields left out (or malformed — anything that
     * fails `Number.isFinite`) are simply skipped, leaving whatever the widget's current value
     * already is untouched — this is what lets callers (STATE-3/DEMO-11's URL-hash restoration) feed
     * in a partial or old-format saved state without throwing or needing their own fallback logic.
     *
     * Genuinely instant, un-animated assignment — into `c` directly (via `locate()`) AND into the
     * live `zoom_factor`/`rotation` fields, not just `zoom_target`/`rotation_target`. Direct user
     * report (2026-09-22): a page reload restoring a saved zoom from the URL rendered at the
     * WRONG zoom (whatever the constructor's own default, `zoom_factor = 1`, happens to be) and
     * then visibly animated/mutated frame-by-frame to the correct one — this method's own doc
     * comment already claimed "instant", but only ever set `zoom_target`/`rotation_target` (the
     * *eased* fields' destination, drained by onRepaint's exponential smoothing over many frames —
     * see MapWidget.onRepaint), identical to `goToBookmark`'s intentional "fly to" animation. That's
     * the right feel for jumping to a bookmark mid-session; it's wrong for restoring where the user
     * already was before a reload, which should look like nothing ever moved. `goToBookmark` has its
     * own separate, still-eased assignment (`src/map.ts`) and is deliberately untouched by this fix.
     */
    deserializeState(state) {
        if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
            this.locate(state.x, state.y);
        }
        if (Number.isFinite(state.zoom)) {
            this.zoom_target = state.zoom;
            this.zoom_factor = state.zoom;
        }
        if (Number.isFinite(state.rotation)) {
            this.rotation_target = state.rotation;
            this.rotation = state.rotation;
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
    scroll(dx, dy) {
        const rotated = Mat2D.rotation(this.rotation).transformVector({ x: dx, y: dy });
        this.locate(this.c.x + rotated.x, this.c.y + rotated.y);
    }
    /** Actual canvas pixel coordinates (top-left origin, e.g. from `event.offsetX/offsetY`) -> world coordinates. */
    screenToWorld(screenPoint) {
        const centered = { x: screenPoint.x - this.canvas.width / 2, y: screenPoint.y - this.canvas.height / 2 };
        return this.camera.localToWorld(centered);
    }
    /** World coordinates -> actual canvas pixel coordinates (top-left origin). */
    worldToScreen(worldPoint) {
        const centered = this.camera.worldToLocal(worldPoint);
        return { x: centered.x + this.canvas.width / 2, y: centered.y + this.canvas.height / 2 };
    }
    // ZOOM-9/ZOOM-10/ZOOM-12: the wheel-driven zoom step, pulled out of the `wheel` listener so
    // ZOOM-12's ctrlKey/pinch branch and its 'wheel'-classified branch can both reach it without
    // duplicating the logic. `sensitivity` (ZOOM-14) defaults to 1 — the 'wheel'-classified call
    // site below passes nothing and behaves exactly as before; only the ctrlKey/pinch branch passes
    // PINCH_ZOOM_SENSITIVITY.
    _wheelZoom(e, sensitivity = 1) {
        const dy = -e.deltaY * sensitivity;
        if (dy === 0)
            return;
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
    _wheelPan(e) {
        this.scroll(e.deltaX / this.zoom_factor, e.deltaY / this.zoom_factor);
    }
    zoomIn() {
        this.zoomBy(1 + this.zoom_step_factor);
    }
    zoomOut() {
        this.zoomBy(1 - this.zoom_step_factor);
    }
    /** multiplier > 1 zooms in, < 1 zooms out. See ZOOM_EDGE_SOFTNESS for the boundary behavior. */
    zoomBy(multiplier) {
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
    _isAnyKeyDown(keys) {
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
    rotateBy(deltaRadians) {
        this.rotation_target += deltaRadians;
    }
    /**
     * Eases back to "north" — but the *nearest* equivalent angle, not literal 0, so a view that's
     * wound around through several full drag-driven turns snaps back the short way instead of
     * visibly unspinning through every accumulated turn.
     */
    resetRotation() {
        this.rotation_target = Math.round(this.rotation / (2 * Math.PI)) * (2 * Math.PI);
    }
}
export class Layer {
    constructor(options) {
        this.name = options && options.name;
        this.kind = (options && options.kind) || 'cartographic';
        this.shift = (options && options.shift) || new Vector(0, 0);
        this.transform = new Transform2D();
        this.transform.setTranslation(this.shift.x, this.shift.y);
        if (options && options.scale !== undefined)
            this.transform.setScale(options.scale);
        if (options && options.rotation !== undefined)
            this.transform.rotation = options.rotation;
        this.onDraw = options && options.onDraw;
        this.visible = Boolean(options && (options.visible === undefined ? true : options.visible));
        this.options = options || {};
    }
    draw(map) {
        if (this.onDraw) {
            this.onDraw(map);
        }
    }
}
export class BufferedLayer extends Layer {
    constructor(options) {
        super(options);
        this._buffer = null;
        this._bufferCtx = null;
        // What the buffer's current content was last built for — a plain equality/reference check
        // against this frame's (zoom_factor, c, diag) below decides whether drawContent() needs to run
        // again. Deliberately does NOT include `rotation` — that's the whole performance point (see the
        // class doc comment above and the reopened ROT-3's historical-plan note): a pure rotation
        // gesture, with pan/zoom untouched, costs one `drawImage` blit per frame, not a full rebuild.
        this._builtZoom = null;
        this._builtC = null;
        this._createBufferCanvas = (options && options.createBufferCanvas) || (() => document.createElement('canvas'));
    }
    // Subclasses override this to draw their content into the offscreen buffer — `ctx` is the
    // buffer's own 2D context (already `clearRect`-ed for this rebuild), `unrotatedMatrix` maps this
    // layer's own local units to BUFFER PIXEL coordinates via translate+scale ONLY (see
    // computeUnrotatedLayerToScreenMatrix) — never rotated; rotating anything drawn in here
    // reintroduces the exact crack this class exists to avoid. `bufferSize` is the buffer's edge
    // length in pixels (always square — see computeBufferDiag). Called only when the buffer's
    // content actually needs rebuilding (see `_builtZoom`/`_builtC` above), not every frame.
    drawContent(_ctx, _unrotatedMatrix, _map, _bufferSize) {
        // No-op by default — a subclass that never overrides this just blits a permanently empty
        // (fully transparent) buffer, which is a harmless, well-defined "draws nothing" layer.
    }
    // Forces the NEXT draw() call to rebuild the buffer regardless of whether zoom_factor/c/size
    // actually changed. Direct user report (2026-09-22): a hard reload showed the background/grid
    // immediately but no tiles at all, until the map was nudged — because zoom_factor/c genuinely
    // don't change while a bunch of tile images are still loading asynchronously in the background
    // (the common case for the first second or two after page load), the buffer built its ONE
    // (empty) frame before any image arrived and then never rebuilt again on its own, even as every
    // in-flight request resolved. A subclass whose content can change independently of camera state
    // — TiledLayer (ROT-9) is the only one today, calling this whenever the set of tiles that
    // actually have an image grows since the last rebuild — calls this to opt back into "redraw
    // when my content changed" for exactly that case, without losing the camera-driven skip for a
    // pure rotation gesture (untouched by this).
    invalidateBuffer() {
        this._builtZoom = null;
    }
    draw(map) {
        super.draw(map); // keeps Layer.onDraw support, same contract TiledLayer.draw() already had.
        const w = map.canvas.width;
        const h = map.canvas.height;
        const diag = computeBufferDiag(w, h);
        if (!this._buffer || this._buffer.width !== diag || this._buffer.height !== diag) {
            // A fresh or resized canvas element starts blank (setting .width/.height on an existing
            // <canvas> also clears it, same as a brand-new one) — forcing `_builtZoom = null` below
            // guarantees the rebuild check further down always rebuilds after this, even if zoom_factor
            // and c happen to numerically match whatever they were before the resize.
            this._buffer = this._createBufferCanvas();
            this._buffer.width = diag;
            this._buffer.height = diag;
            this._bufferCtx = this._buffer.getContext('2d');
            this._builtZoom = null;
        }
        const c = map.c;
        const needsRebuild = this._builtZoom !== map.zoom_factor ||
            !this._builtC ||
            this._builtC.x !== c.x ||
            this._builtC.y !== c.y;
        if (needsRebuild) {
            const bufferCtx = this._bufferCtx;
            bufferCtx.clearRect(0, 0, diag, diag);
            const unrotatedMatrix = computeUnrotatedLayerToScreenMatrix(map.camera, this.transform, diag, diag);
            this.drawContent(bufferCtx, unrotatedMatrix, map, diag);
            this._builtZoom = map.zoom_factor;
            this._builtC = { x: c.x, y: c.y };
        }
        // The one-and-only rotated draw per frame: the whole composited buffer, placed so its own
        // center (which represents the same world point, `c`, that the real canvas's center does)
        // lands exactly at the real canvas's center, rotated by the camera's live `rotation`.
        const blit = computeBufferBlitMatrix(map.rotation, diag / 2, diag / 2, w / 2, h / 2);
        const screenCtx = map.ctx;
        screenCtx.save();
        screenCtx.setTransform(blit.a, blit.b, blit.c, blit.d, blit.e, blit.f);
        screenCtx.drawImage(this._buffer, 0, 0);
        screenCtx.restore();
    }
}
// AFF-4/VEC-1: the combined matrix mapping a point in this layer's own local drawing space to
// actual canvas pixel coordinates — camera pan/zoom/rotation composed with this layer's own
// shift/scale/rotation, as one Mat2D. This is the shared core of `computeTileGridMatrix` (which
// tacks on a further tile-index-to-world-units scaling below) and of `VectorLayer.draw`
// (src/vector_layer.ts), which draws directly in shared world units — pulled out here, rather
// than duplicated in both, so the two layer kinds are guaranteed to agree pixel-for-pixel on
// where "the same world point" lands on screen. Exported and DOM-free specifically so it's
// unit-testable (see map.test.ts) independent of any live canvas/browser.
//
// `layerTransform` is intentionally not required to be parented to `camera` (see Layer.transform's
// comment on why that wouldn't compose the way it sounds) — this function reads its `worldMatrix`
// either way, so it works whether or not a caller has parented it to something.
export function computeLayerToScreenMatrix(camera, layerTransform, canvasWidth, canvasHeight) {
    return Mat2D.translation(canvasWidth / 2, canvasHeight / 2)
        .multiply(camera.worldMatrix.invert())
        .multiply(layerTransform.worldMatrix);
}
// AFF-4: the combined matrix mapping a tile's *index* (integer ix/iy, one unit = one tile) to
// actual canvas pixel coordinates — computeLayerToScreenMatrix above, plus the tile-index-to-
// world-units scaling, composed into one Mat2D instead of the old inline
// `x*tile_size - c.x + w/2` arithmetic. Exported and DOM-free specifically so it's unit-testable
// (see map.test.ts) against that old formula, independent of any live canvas/browser.
export function computeTileGridMatrix(camera, layerTransform, canvasWidth, canvasHeight, world_tile_edge) {
    return computeLayerToScreenMatrix(camera, layerTransform, canvasWidth, canvasHeight)
        .multiply(Mat2D.scaling(world_tile_edge, world_tile_edge));
}
// ROT-7 (BACKLOG.md, reopened ROT-3): `computeLayerToScreenMatrix` above with `camera`'s rotation
// forced to 0 — the "as if the camera were facing north" version, i.e. exactly what a layer draws
// on screen today when `camera.rotation === 0` (the case ROT-3 already proved seamless: two
// adjacent axis-aligned `drawImage` quads share a bit-identical edge coordinate, and Skia's
// exact-rect fast path snaps/anti-aliases that edge identically for both, so no crack can appear
// regardless of fractional zoom or camera position — see the reopened ROT-3 entry for the full
// empirical writeup). `BufferedLayer` (ROT-8) targets this matrix at an offscreen buffer instead
// of the real screen, so every seam-prone rotation happens exactly once, to the finished buffer
// image as a whole, via `computeBufferBlitMatrix` below — never to individual tiles/sprites.
//
// Implemented as a same-position/scale, zero-rotation *sibling* `Transform2D` fed straight into
// the existing function, rather than a new code path — cheaper to review (bugs in
// `computeLayerToScreenMatrix` itself can't silently diverge between the two), and needs no
// `rotationOverride` parameter threaded through every caller. Preserves `camera.parent` (always
// null for `MapWidget.camera` today, but this stays correct if that ever changes — e.g. a future
// `VP-*` nested viewport camera).
export function computeUnrotatedLayerToScreenMatrix(camera, layerTransform, canvasWidth, canvasHeight) {
    const unrotatedCamera = new Transform2D(camera.parent);
    unrotatedCamera.setTranslation(camera.x, camera.y);
    unrotatedCamera.setScale(camera.scaleX, camera.scaleY);
    return computeLayerToScreenMatrix(unrotatedCamera, layerTransform, canvasWidth, canvasHeight);
}
// ROT-7: `computeUnrotatedLayerToScreenMatrix` above, plus the same tile-index-to-world-units
// scaling `computeTileGridMatrix` adds to `computeLayerToScreenMatrix` — the buffer-space
// counterpart `TiledLayer` (ROT-9) composites its tiles through.
export function computeUnrotatedTileGridMatrix(camera, layerTransform, canvasWidth, canvasHeight, world_tile_edge) {
    return computeUnrotatedLayerToScreenMatrix(camera, layerTransform, canvasWidth, canvasHeight)
        .multiply(Mat2D.scaling(world_tile_edge, world_tile_edge));
}
// ROT-7: "rotate the whole picture by `rotation`, around its own center point" — i.e. exactly the
// rotation `computeLayerToScreenMatrix` folds into every individual tile/sprite today, factored
// out into its own matrix so `BufferedLayer` (ROT-8) can apply it ONCE, to an already-composited
// buffer image, instead. `fromCenter` is the buffer's own center in buffer-pixel coordinates
// (`diag/2, diag/2` — see `computeBufferDiag`); `toCenter` is where that center should land on
// the real screen (`canvas.width/2, canvas.height/2`) — kept as two separate points, not one,
// since the buffer is deliberately NOT the same size as the real canvas (see `computeBufferDiag`).
//
// Angle sign matches `computeLayerToScreenMatrix`'s own convention (`camera.worldMatrix.invert()`
// applies `rotate(-rotation)` — see `MapWidget.rotateBy`'s doc comment: increasing `rotation`
// turns displayed content counter-clockwise) — verified algebraically, not just by inference: for
// `fromCenter === toCenter`,
//
//   computeBufferBlitMatrix(rotation, cx, cy, cx, cy).multiply(computeUnrotatedLayerToScreenMatrix(...))
//     === computeLayerToScreenMatrix(camera, ...)   (camera.rotation === rotation)
//
// exactly — because `camera.worldMatrix`'s scale is isotropic (`scaleX === scaleY`, true for both
// `MapWidget.camera` and every `Layer.transform` today — `Transform2D.setScale`'s own default
// `sy = sx` means nothing in this codebase ever sets them unequal), which commutes with rotation;
// see map.test.ts's ROT-7 tests for the identity checked both at matching and at mismatched
// from/to centers (the actual `diag`-buffer-vs-real-canvas case `BufferedLayer` uses). If a
// non-isotropic camera or layer scale is ever introduced, this factorization breaks and the whole
// buffered-rotation approach (ROT-8/9/10) needs revisiting.
export function computeBufferBlitMatrix(rotation, fromCenterX, fromCenterY, toCenterX, toCenterY) {
    return Mat2D.translation(toCenterX, toCenterY)
        .multiply(Mat2D.rotation(-rotation))
        .multiply(Mat2D.translation(-fromCenterX, -fromCenterY));
}
// ROT-8: edge length (device px) of the square offscreen buffer `BufferedLayer` composites into.
// A square of this size, rotated by ANY angle around its own center and overlaid so that center
// coincides with the real canvas's center, is guaranteed to fully cover a `canvasWidth x
// canvasHeight` real canvas — because every point of that real canvas is within
// `sqrt(canvasWidth^2 + canvasHeight^2) / 2` of its own center, i.e. within the circle the square
// circumscribes. This is the "запас на диагональ" from ROT-3's original (historical) buffer plan,
// and it's rotation-agnostic by construction — no rotated-corner-projection (the old ROT-3-range)
// needed to size it. Rounded UP to the nearest `granularity` device px so ordinary sub-pixel or
// small layout-driven canvas resizes don't reallocate/rebuild the buffer canvas every frame.
export const DEFAULT_BUFFER_SIZE_GRANULARITY = 32;
export function computeBufferDiag(canvasWidth, canvasHeight, granularity = DEFAULT_BUFFER_SIZE_GRANULARITY) {
    const diag = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight);
    return Math.ceil(diag / granularity) * granularity;
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
export function computeTileIndexBounds(layerTransform, world_tile_edge, bounds) {
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
        if (corners[i].x < minX)
            minX = corners[i].x;
        if (corners[i].x > maxX)
            maxX = corners[i].x;
        if (corners[i].y < minY)
            minY = corners[i].y;
        if (corners[i].y > maxY)
            maxY = corners[i].y;
    }
    return {
        minX: minX / world_tile_edge,
        minY: minY / world_tile_edge,
        maxX: maxX / world_tile_edge,
        maxY: maxY / world_tile_edge
    };
}
export class TiledLayer extends BufferedLayer {
    constructor(options) {
        super(options);
        // Debug-overlay support: how many tile slots this layer's draw() considered this frame
        // ((2*dx+1)*(2*dy+1)) — not how many actually have an image yet, just the size of the
        // currently-visible index range. Updated at the top of every draw() call.
        this.visible_tile_count = 0;
        // ROT-9: this frame's already-fetched tiles, in visible-range order — set by draw() BEFORE it
        // calls super.draw() (BufferedLayer), read back by drawContent() (called synchronously from
        // within that same super.draw() call, but only on frames that actually rebuild the buffer — see
        // BufferedLayer's own invalidation notes). This hand-off exists so drawContent() never calls
        // tile_source.get() a second time for a tile draw()'s own onTileDraw loop already fetched this
        // frame: get() has real, cumulative side effects (LOAD-8's requested_count/cache_hit_count, the
        // debug overlay's "requested="/"hits=" — see src/tile_source.ts) that must fire exactly once per
        // tile per frame, matching this class's behavior before this ticket. onTileDraw itself can't
        // move into drawContent() to share one loop directly — onTileDraw needs to run EVERY frame (live
        // rotated positions), while drawContent() only runs on the subset of frames the buffer actually
        // needs rebuilding.
        this._frameTiles = [];
        this._frameWorldTileEdge = 0;
        // How many of the currently-visible tiles had an image the last time the buffer was actually
        // rebuilt — see draw()'s own comment on why this drives an extra invalidateBuffer() trigger
        // beyond BufferedLayer's own zoom/c/size checks. -1: never built yet (matches the pre-any-load
        // readyCount of 0 being different, so the very first frame always triggers correctly too).
        this._lastBuildReadyCount = -1;
        this.tile_source = options && options.tile_source;
        this.tile_size = (options && options.tile_size) || (this.tile_source && this.tile_source.tile_size) || 0;
        this.onTileDraw = options && options.onTileDraw; // function(ix, iy, x, y, tile)
        this.z_max = options && options.z_max;
        this.zLevelMin = options && options.zLevelMin;
        this.zLevelMax = options && options.zLevelMax;
        this.bounds = options && options.bounds;
    }
    getLevelParams(map, w, h) {
        const zf = map.zoom_factor;
        const z = Math.ceil(Math.log2(zf));
        const k = zf / Math.pow(2, z);
        const tile_size = this.tile_size * k;
        const world_tile_edge = this.tile_size / Math.pow(2, z);
        // AFF-4: one matrix for the whole layer this frame, replacing the old per-tile
        // `x*tile_size - c.x + w/2` arithmetic — see computeTileGridMatrix. Still built here (even
        // though tile IMAGES no longer draw through it directly, post-ROT-9 — see BufferedLayer) for
        // onTileDraw's own live, rotated placement (map_grid/map_debug/xkcd_debug/drawDebugInfo — see
        // BufferedLayer's class doc comment for why those stay off the buffer).
        const gridMatrix = computeTileGridMatrix(map.camera, this.transform, w, h, world_tile_edge);
        // ROT-9 (BACKLOG.md, reopened ROT-3): tile-index range, now derived from the same
        // rotation-agnostic buffer diagonal BufferedLayer sizes its offscreen buffer with
        // (computeBufferDiag), instead of the old ROT-3-range rotated-corner-projection (retired —
        // see BACKLOG.md). `diag` is, by construction, >= the bounding box that projection would have
        // produced for ANY rotation angle, so this simpler, axis-aligned radius is always at least as
        // permissive — and unlike the old code, it never needs recomputing when only `rotation`
        // changes (the buffer itself is always axis-aligned; only the final on-screen blit rotates).
        const diag = computeBufferDiag(w, h);
        const unrotatedMatrix = computeUnrotatedTileGridMatrix(map.camera, this.transform, diag, diag, world_tile_edge);
        const centerIndex = unrotatedMatrix.invert().transformPoint({ x: diag / 2, y: diag / 2 });
        const tx = Math.round(centerIndex.x);
        const ty = Math.round(centerIndex.y);
        // +1: same corner-padding rationale the old code had — the buffer's own edge essentially
        // never lands exactly on a tile boundary.
        const dx = Math.ceil(diag / 2 / tile_size) + 1;
        const dy = dx; // the buffer is always square, so the radius is identical on both axes.
        // LAYER-6: clamp the *final* level (z_max offset already applied) into [zLevelMin, zLevelMax]
        // when either is set — z_max itself stays the untouched offset it always was (see its own
        // comment); this only bounds what comes out the other end. Unset (the default) means no
        // clamping at all, i.e. today's behavior.
        let level = z + (this.z_max || 0);
        if (this.zLevelMin !== undefined)
            level = Math.max(level, this.zLevelMin);
        if (this.zLevelMax !== undefined)
            level = Math.min(level, this.zLevelMax);
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
            unrotatedMatrix,
            // LAYER-6: undefined when `bounds` isn't set — draw() only does the per-tile skip check
            // when this is present.
            tileIndexBounds: this.bounds ? computeTileIndexBounds(this.transform, world_tile_edge, this.bounds) : undefined
        };
    }
    draw(map) {
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
        this._frameWorldTileEdge = level_params.world_tile_edge;
        this._frameTiles = [];
        for (let y = ty - dy; y <= ty + dy; y++) {
            for (let x = tx - dx; x <= tx + dx; x++) {
                // LAYER-6: a tile index square is [x, x+1) x [y, y+1) in index space (see
                // computeTileIndexBounds) — skip it (no tile_source.get(), no draw) if that square falls
                // entirely outside `bounds`. No-op (tileIndexBounds undefined) when `bounds` isn't set.
                if (tileIndexBounds &&
                    (x + 1 <= tileIndexBounds.minX ||
                        x >= tileIndexBounds.maxX ||
                        y + 1 <= tileIndexBounds.minY ||
                        y >= tileIndexBounds.maxY)) {
                    continue;
                }
                const tile = this.tile_source ? this.tile_source.get(x, y, z) : undefined;
                this._frameTiles.push({ x, y, tile });
                if (this.onTileDraw) {
                    // ROT-9: still runs every frame, straight to the real screen through the LIVE (rotated)
                    // gridMatrix — see BufferedLayer's own class doc comment for why debug/grid overlays
                    // stay off the buffer entirely.
                    const topLeft = gridMatrix.transformPoint({ x, y });
                    this.onTileDraw(map, x, y, z, topLeft.x, topLeft.y, tile_size, tile, gridMatrix);
                }
            }
        }
        // Direct user report (2026-09-22): on a hard reload, tiles never appeared at all — only the
        // background/grid — until the map was nudged. BufferedLayer only rebuilds on its own when
        // zoom_factor/c/size change; it has no way to notice a tile's async image arriving while the
        // camera sits perfectly still (routine for the first second or two after load, with a screen's
        // worth of tiles all mid-flight). Force a rebuild whenever the number of currently-visible
        // tiles that actually have an image has grown since the buffer's last rebuild — monotonic for
        // a static viewport (a loaded tile doesn't un-load), so this can only ever fire on genuinely
        // new content, never spuriously on an already-fully-loaded, idle view.
        const readyCount = this._frameTiles.reduce((n, t) => n + (t.tile && t.tile.image ? 1 : 0), 0);
        if (readyCount !== this._lastBuildReadyCount)
            this.invalidateBuffer();
        this._lastBuildReadyCount = readyCount;
        // BufferedLayer.draw(): runs Layer.onDraw, and — only on frames where the camera panned/
        // zoomed, the canvas resized, or invalidateBuffer() was just called above — rebuilds the
        // offscreen buffer via drawContent() below (consuming `_frameTiles` set just above), then
        // blits it (every frame) with the live rotation applied exactly once. Must run AFTER the loop
        // above: drawContent(), when it runs, does so synchronously from inside this call.
        super.draw(map);
        // LOAD-1: drive background preloading from whatever's actually on screen, instead of
        // requiring call sites to remember to invoke tile_source.heat() themselves (nothing did,
        // previously — see BACKLOG.md). r1 starts right at the visible edge, so the preload ring
        // is the "next ring out" beyond what the loop above already fetched directly. Unchanged by
        // ROT-9 — runs every frame regardless of whether the buffer itself was rebuilt.
        if (this.tile_source && isHeatableTileSource(this.tile_source)) {
            const r1 = Math.max(dx, dy);
            this.tile_source.heat(tx, ty, z, r1, r1 * 2);
        }
    }
    // ROT-9/ROT-8: draws this frame's already-fetched tile images (`_frameTiles`, set by draw()
    // above) into the offscreen buffer, through `unrotatedMatrix` (buffer-pixel coordinates, no
    // rotation — see BufferedLayer's class doc comment) composed with this layer's own
    // tile-index-to-world scaling, the same way computeTileGridMatrix composes it for the live,
    // rotated matrix.
    drawContent(ctx, unrotatedMatrix, _map, _bufferSize) {
        const bufferMatrix = unrotatedMatrix.multiply(Mat2D.scaling(this._frameWorldTileEdge, this._frameWorldTileEdge));
        for (const { x, y, tile } of this._frameTiles) {
            if (!tile || !tile.image)
                continue;
            // ZOOM-10 (carried forward verbatim in spirit — see the original comment's full reasoning,
            // still accurate, in git history/BACKLOG.md): reuse `bufferMatrix`'s linear part (a/b/c/d —
            // moderate magnitude, nowhere near float32's precision limit) but replace its translation
            // with THIS tile's own small, precomputed buffer-local corner, and draw at local (0,0)
            // instead of baking the combined (huge) tile index straight into the CTM.
            const local = bufferMatrix.transformPoint({ x, y });
            ctx.save();
            ctx.setTransform(bufferMatrix.a, bufferMatrix.b, bufferMatrix.c, bufferMatrix.d, local.x, local.y);
            ctx.drawImage(tile.image, 0, 0, this.tile_size, this.tile_size, 0, 0, 1, 1);
            ctx.restore();
        }
    }
}
export class ImageOverlayLayer extends BufferedLayer {
    constructor(options) {
        super(options);
        this.sprites = (options && options.sprites) || [];
    }
    drawContent(ctx, unrotatedMatrix, _map, _bufferSize) {
        for (const sprite of this.sprites) {
            // Source-image-pixel space -> world space: translate to the sprite's own position, apply
            // its own rotation (around that same top-left corner), then scale native pixels up/down to
            // the requested world-space size — the same "translate ∘ rotate ∘ scale" composition order
            // Transform2D.localMatrix already uses everywhere else in this codebase.
            const placement = Mat2D.translation(sprite.x, sprite.y)
                .multiply(Mat2D.rotation(sprite.rotation || 0))
                .multiply(Mat2D.scaling(sprite.width / sprite.imageWidth, sprite.height / sprite.imageHeight));
            // World space -> buffer-pixel space, composed in JS double precision (ordinary Mat2D
            // multiplication, not a canvas CTM) — same ZOOM-10 precision-safety property TiledLayer's
            // per-tile draw relies on: however large `sprite.x`/`sprite.y` are (a real map location is
            // typically in the tens of millions, same magnitude as `DEFAULT_START_POSITION` — see
            // src/index.ts), `bufferMatrix`'s own translation comes out already small (relative to the
            // current camera position, same as every tile's), safe to hand the rasterizer directly.
            const bufferMatrix = unrotatedMatrix.multiply(placement);
            ctx.save();
            ctx.setTransform(bufferMatrix.a, bufferMatrix.b, bufferMatrix.c, bufferMatrix.d, bufferMatrix.e, bufferMatrix.f);
            ctx.drawImage(sprite.image, 0, 0, sprite.imageWidth, sprite.imageHeight, 0, 0, sprite.imageWidth, sprite.imageHeight);
            ctx.restore();
        }
    }
}
//# sourceMappingURL=map.js.map
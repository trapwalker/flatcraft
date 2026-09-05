// ZOOM-12: ambient typing for Safari's nonstandard `gesturestart`/`gesturechange`/`gestureend`
// events (two-finger trackpad pinch/rotate) — no TypeScript lib carries these, unlike
// Touch/TouchEvent (which ARE part of a standard, just not implemented by every engine).
// `GestureEvent` has existed in WebKit since Safari 10 (2016) but was never adopted by any other
// browser and never standardized; see BACKLOG.md's ZOOM-12 entry for the citations. Declared in
// its own ambient file (no top-level import/export, like geometry.d.ts and dat-gui.d.ts
// alongside it) rather than folded into geometry.d.ts, since this is DOM-event typing, not
// geometry — kept separate by concern, same as dat-gui.d.ts/tiles-data.d.ts are from each other.
//
// Only the member MapWidget actually reads is declared (see its gesturechange handler) —
// `.scale` is deliberately omitted, since ZOOM-12 only uses these events for *rotation*;
// pinch-zoom already goes through the ordinary `wheel`+ctrlKey path on Safari too (Safari fires
// both), so a parallel scale-driven zoom path isn't needed.
interface GestureEvent extends UIEvent {
  // Cumulative rotation in degrees since the gesture's `gesturestart`, NOT a per-event delta.
  // Per WebKit's own documentation, positive values are a clockwise two-finger turn.
  readonly rotation: number;
}

// Declaration-merges with lib.dom.d.ts's own (unconditional) HTMLElementEventMap — this just adds
// three more keys to it, so `canvas.addEventListener('gesturestart', ...)` etc. type-check
// without an `as any` cast, on every target (Chrome/Firefox included) even though only Safari
// ever actually constructs or fires one. Feature-detected at runtime via `'ongesturestart' in
// window` (see MapWidget's constructor) — this file only affects compile-time types, never
// runtime behavior.
interface HTMLElementEventMap {
  gesturestart: GestureEvent;
  gesturechange: GestureEvent;
  gestureend: GestureEvent;
}

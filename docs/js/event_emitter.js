/// EventEmitter //////////////////////////////////////////////////////////////////////////////////
//
// EVT-1 (BACKLOG.md, "Фаза 8. Событийная модель"): a small, dependency-free, typed on/off/once/
// fire emitter, meant to be shared by MapWidget, Layer and TileSource once EVT-2..EVT-5 wire real
// events through them (movestart/move/moveend, zoomstart/zoom/zoomend, tile:loaded, etc. — see
// that section's intro on following Leaflet/MapLibre naming). Nothing here hardcodes any of those
// event names; a consumer parameterizes the class with its own event-name -> payload-shape map:
//
//   type MapEvents = { move: {c: Vector}; zoomtargetchange: {target: number} };
//   class MapWidget {
//     private _events = new EventEmitter<MapEvents>();
//     on<K extends keyof MapEvents>(event: K, handler: (data: MapEvents[K]) => void) {
//       return this._events.on(event, handler);
//     }
//     // ...and this._events.fire('move', {c: this.center}) wherever the value actually changes.
//   }
//
// Composition, not a mixin/base class: MapWidget, Layer and TileSource (see TiledLayer/
// XYZTileSource in map.ts/tile_source.ts) are three unrelated hierarchies that share nothing else,
// and each may pick up its own base-class concerns later (LAYER-*, SRC-*) — spending their one
// `extends` slot on this, or funnelling them all through a shared mixin base, buys nothing over a
// `private _events = new EventEmitter<...>()` field plus a couple of one-line forwarding methods
// (sketch above). It also lets each consumer decide independently whether `on`/`off` become public
// API verbatim or stay wrapped (e.g. EVT-5's planned onLocate/onZoom-as-thin-wrappers), without
// this class presupposing either.
//
// EventMap has no fixed shape (no fields *required* to exist) beyond "an object of payload types
// keyed by event name" — a class instantiating this with its own map gets full autocomplete/type
// checking on `on`/`once`/`fire`, and a generic/test caller can still use a loose map like
// `Record<string, unknown>` (the default) when no fixed event set is known ahead of time.
export class EventEmitter {
    constructor() {
        // One listener array per event name. A Map (not a plain object) sidesteps prototype-property
        // collisions (an event literally named "constructor" or "toString") for free.
        this._listeners = new Map();
    }
    /** Subscribe `handler` to `event`. Returns an unsubscribe function, so callers who don't want to
     *  keep the original handler reference around (e.g. an inline arrow) can still remove it later:
     *  `const off = emitter.on('move', d => ...); ... off();` */
    on(event, handler) {
        let list = this._listeners.get(event);
        if (!list) {
            list = [];
            this._listeners.set(event, list);
        }
        list.push(handler);
        return () => this.off(event, handler);
    }
    /** Subscribe `handler` to `event`, automatically unsubscribing after it fires once. */
    once(event, handler) {
        // Wrap rather than special-case in fire(): the wrapper removes *itself* (via the closed-over
        // `off`) before delegating to the real handler, so it composes with the same off()-during-
        // iteration handling that plain listeners get (see fire()'s copy-before-iterate note below) —
        // no separate "once" bookkeeping needed anywhere else.
        const wrapped = (data) => {
            off();
            handler(data);
        };
        const off = this.on(event, wrapped);
        return off;
    }
    /** Unsubscribe `handler` from `event`. A no-op if it isn't (or is no longer) subscribed — e.g.
     *  called twice, or after `once` already auto-removed it. */
    off(event, handler) {
        const list = this._listeners.get(event);
        if (!list)
            return;
        const idx = list.indexOf(handler);
        if (idx !== -1)
            list.splice(idx, 1);
        // Deliberately not deleting the Map entry when `list` becomes empty: fire() may be mid-
        // iteration over this exact array (see below) and holds its own reference to it, so there's
        // nothing unsafe about leaving an empty array behind — the next on() for this event reuses it.
    }
    /** Invoke every listener currently subscribed to `event` with `data`, in subscription order. A
     *  no-op (no throw) if nothing is subscribed. */
    fire(event, data) {
        const list = this._listeners.get(event);
        if (!list || list.length === 0)
            return;
        // Iterate a snapshot, not `list` itself. Handlers commonly call off() on themselves (once())
        // or on a sibling listener while they run; splicing the live array mid-for-loop would shift
        // later indices under the loop counter and either skip the listener right after the removed
        // one or (removing the *current* index, as once() does) rerun something already-handled.
        // Slicing first means an off() during this fire() only ever affects *future* fire() calls,
        // which is the least-surprising contract for callers — nobody sees a listener list that
        // mutates itself out from under a fire in progress.
        const snapshot = list.slice();
        for (const handler of snapshot) {
            handler(data);
        }
    }
}
//# sourceMappingURL=event_emitter.js.map
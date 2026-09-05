/// Bookmarks /////////////////////////////////////////////////////////////////////////////////////
//
// BOOKMARK-1 (BACKLOG.md, "Фаза 15. Закладки"): a pure, DOM-free module (same style as
// event_emitter.ts — no browser dependencies, no ties to MapWidget's own class hierarchy, unit-
// testable in complete isolation). Generalizes the demo's old hand-rolled `locations` object
// (src/index.ts — a hardcoded `{pos, caption, go()}` record) into a real, runtime-mutable API:
// bookmarks can now be created/removed while the app is running, not only hand-written in source.
//
// Same separation-of-concerns already established for STATE-1 (serializeState/deserializeState):
// this module has no idea *where* a serialized bookmark list is persisted — no localStorage, no
// URL, no network. That decision belongs entirely to the host (the demo's DEMO-7, see
// DEMO_BACKLOG.md), which is free to put it in localStorage, send it to a server, or both.
import { Vector } from './vector.js';
// Simple counter + timestamp, not a cryptographic/collision-proof id — good enough for a handful
// of user-created bookmarks in one browser tab (per BOOKMARK-1's own note: "generate an id if not
// given — a simple counter or timestamp-based string is fine, doesn't need to be cryptographically
// unique"). Module-level (not per-store) so ids stay unique even across multiple BookmarkStore
// instances created in the same page load (e.g. one loaded from localStorage plus one built fresh
// while seeding defaults — see the demo's DEMO-7).
let _nextBookmarkId = 1;
function generateBookmarkId() {
    return 'bm_' + Date.now().toString(36) + '_' + (_nextBookmarkId++).toString(36);
}
export class BookmarkStore {
    constructor() {
        // Map, not an array: add/remove/get by id are the common operations here, and a Map keeps all
        // three O(1) without a linear scan — list() below is the only place insertion order actually
        // matters, and Map preserves that too.
        this._bookmarks = new Map();
    }
    /** Adds a bookmark, generating an id if one isn't given. Returns the stored Bookmark (with its
     *  resolved id) so a caller that didn't pass one can still get it back immediately. */
    add(bookmark) {
        const id = bookmark.id || generateBookmarkId();
        const stored = {
            id,
            name: bookmark.name,
            position: bookmark.position,
            zoom: bookmark.zoom,
            rotation: bookmark.rotation,
            layerId: bookmark.layerId
        };
        this._bookmarks.set(id, stored);
        return stored;
    }
    /** Removes the bookmark with this id, if any. Returns whether one was actually removed. */
    remove(id) {
        return this._bookmarks.delete(id);
    }
    get(id) {
        return this._bookmarks.get(id);
    }
    /** Every bookmark currently in the store, in insertion order. A fresh array each call — safe
     *  for a caller to hold onto without it silently changing under them, but not "live". */
    list() {
        return Array.from(this._bookmarks.values());
    }
    /** Plain, JSON-serializable snapshot of every bookmark in the store — see SerializedBookmark's
     *  own doc comment on why `position` needs converting rather than being handed through as-is. */
    serialize() {
        return this.list().map((bookmark) => ({
            id: bookmark.id,
            name: bookmark.name,
            position: { x: bookmark.position.x, y: bookmark.position.y },
            zoom: bookmark.zoom,
            rotation: bookmark.rotation,
            layerId: bookmark.layerId
        }));
    }
    /** Builds a fresh BookmarkStore from a previously-serialize()'d array. */
    static deserialize(data) {
        const store = new BookmarkStore();
        for (const item of data) {
            store.add({
                id: item.id,
                name: item.name,
                position: new Vector(item.position.x, item.position.y),
                zoom: item.zoom,
                rotation: item.rotation,
                layerId: item.layerId
            });
        }
        return store;
    }
}
//# sourceMappingURL=bookmarks.js.map
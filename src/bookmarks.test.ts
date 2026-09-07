import { describe, expect, it } from 'vitest';
import { Vector } from './vector.js';
import { BookmarkStore } from './bookmarks.js';
import type { SerializedBookmark } from './bookmarks.js';

describe('BookmarkStore', () => {
  it('add() generates an id when none is given, and get()/list() see it', () => {
    const store = new BookmarkStore();
    const bookmark = store.add({ name: 'Home', position: new Vector(1, 2) });

    expect(bookmark.id).toBeTruthy();
    expect(store.get(bookmark.id)).toEqual(bookmark);
    expect(store.list()).toEqual([bookmark]);
  });

  it('add() keeps a caller-provided id instead of generating one', () => {
    const store = new BookmarkStore();
    const bookmark = store.add({ id: 'mine', name: 'Home', position: new Vector(0, 0) });

    expect(bookmark.id).toBe('mine');
    expect(store.get('mine')).toEqual(bookmark);
  });

  it('generated ids are unique across multiple add() calls with no id given', () => {
    const store = new BookmarkStore();
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(store.add({ name: 'p' + i, position: new Vector(i, i) }).id);
    }
    expect(ids.size).toBe(20);
  });

  it('remove() deletes a bookmark and reports whether one actually existed', () => {
    const store = new BookmarkStore();
    const bookmark = store.add({ name: 'Home', position: new Vector(1, 2) });

    expect(store.remove(bookmark.id)).toBe(true);
    expect(store.get(bookmark.id)).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(store.remove(bookmark.id)).toBe(false); // already gone
  });

  it('get() returns undefined for an id that was never added', () => {
    const store = new BookmarkStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('list() returns every bookmark, in insertion order', () => {
    const store = new BookmarkStore();
    const a = store.add({ name: 'A', position: new Vector(0, 0) });
    const b = store.add({ name: 'B', position: new Vector(1, 1) });
    const c = store.add({ name: 'C', position: new Vector(2, 2) });

    expect(store.list()).toEqual([a, b, c]);
  });

  it('list() returns a fresh array each call, not a live view into the store', () => {
    const store = new BookmarkStore();
    store.add({ name: 'A', position: new Vector(0, 0) });
    const first = store.list();
    store.add({ name: 'B', position: new Vector(1, 1) });
    expect(first.length).toBe(1); // unaffected by the later add()
    expect(store.list().length).toBe(2);
  });

  // BOOKMARK-2: rename(id, name) updates an existing Bookmark's `name` in place (same object,
  // same id) and reports whether a bookmark with that id was found.
  describe('rename()', () => {
    it('renames an existing bookmark and returns true', () => {
      const store = new BookmarkStore();
      const bookmark = store.add({
        name: 'Old name',
        position: new Vector(1, 2),
        zoom: 0.5,
        rotation: 1.2,
        layerId: 'some-layer'
      });

      const result = store.rename(bookmark.id, 'New name');

      expect(result).toBe(true);
      expect(store.get(bookmark.id)?.name).toBe('New name');
    });

    it('renaming a nonexistent id returns false and changes nothing', () => {
      const store = new BookmarkStore();
      const bookmark = store.add({ name: 'Untouched', position: new Vector(0, 0) });

      const result = store.rename('does-not-exist', 'New name');

      expect(result).toBe(false);
      // The store's actual (existing) bookmark is untouched.
      expect(store.get(bookmark.id)?.name).toBe('Untouched');
      // No new entry was created for the nonexistent id either.
      expect(store.list().length).toBe(1);
    });

    it('keeps id/position/zoom/rotation/layerId unchanged, and mutates the same object in place', () => {
      const store = new BookmarkStore();
      const bookmark = store.add({
        name: 'Before',
        position: new Vector(10, 20),
        zoom: 0.25,
        rotation: 3.14,
        layerId: 'layer-x'
      });
      const idBefore = bookmark.id;

      store.rename(bookmark.id, 'After');

      const renamed = store.get(idBefore);
      expect(renamed).toBe(bookmark); // same object identity, not remove()+add()
      expect(renamed?.id).toBe(idBefore);
      expect(renamed?.name).toBe('After');
      expect(renamed?.position.x).toBe(10);
      expect(renamed?.position.y).toBe(20);
      expect(renamed?.zoom).toBe(0.25);
      expect(renamed?.rotation).toBe(3.14);
      expect(renamed?.layerId).toBe('layer-x');
    });
  });

  describe('serialize()/deserialize()', () => {
    it('round-trips a bookmark with no layerId/zoom/rotation set', () => {
      const store = new BookmarkStore();
      store.add({ id: 'plain', name: 'Plain spot', position: new Vector(10, -20) });

      const data = store.serialize();
      expect(data).toEqual([
        { id: 'plain', name: 'Plain spot', position: { x: 10, y: -20 }, zoom: undefined, rotation: undefined, layerId: undefined }
      ]);

      // JSON.stringify/parse drops keys whose value is `undefined` — this is the shape that
      // actually crosses a real localStorage/JSON boundary, not the `data` array above verbatim.
      const roundTripped = JSON.parse(JSON.stringify(data)) as SerializedBookmark[];
      const restored = BookmarkStore.deserialize(roundTripped);

      const bookmark = restored.get('plain');
      expect(bookmark).toBeDefined();
      expect(bookmark!.name).toBe('Plain spot');
      expect(bookmark!.position).toBeInstanceOf(Vector);
      expect(bookmark!.position.x).toBe(10);
      expect(bookmark!.position.y).toBe(-20);
      expect(bookmark!.zoom).toBeUndefined();
      expect(bookmark!.rotation).toBeUndefined();
      expect(bookmark!.layerId).toBeUndefined();
    });

    it('round-trips a bookmark with layerId (and zoom/rotation) set', () => {
      const store = new BookmarkStore();
      store.add({
        id: 'tied',
        name: 'Tied spot',
        position: new Vector(5, 6),
        zoom: 0.25,
        rotation: Math.PI / 4,
        layerId: 'xkcd_tiles'
      });

      const roundTripped = JSON.parse(JSON.stringify(store.serialize())) as SerializedBookmark[];
      const restored = BookmarkStore.deserialize(roundTripped);
      const bookmark = restored.get('tied');

      expect(bookmark).toBeDefined();
      expect(bookmark!.position.x).toBe(5);
      expect(bookmark!.position.y).toBe(6);
      expect(bookmark!.zoom).toBe(0.25);
      expect(bookmark!.rotation).toBeCloseTo(Math.PI / 4, 12);
      expect(bookmark!.layerId).toBe('xkcd_tiles');
    });

    it('serialize() turns `position` into a plain {x, y}, not a Vector instance', () => {
      const store = new BookmarkStore();
      store.add({ id: 'a', name: 'A', position: new Vector(3, 4) });

      const [serialized] = store.serialize();
      expect(serialized.position).not.toBeInstanceOf(Vector);
      expect(serialized.position).toEqual({ x: 3, y: 4 });
    });

    it('deserialize() builds an independent store — mutating one leaves the other alone', () => {
      const store = new BookmarkStore();
      store.add({ id: 'a', name: 'A', position: new Vector(0, 0) });

      const restored = BookmarkStore.deserialize(JSON.parse(JSON.stringify(store.serialize())));
      restored.remove('a');

      expect(restored.get('a')).toBeUndefined();
      expect(store.get('a')).toBeDefined(); // original untouched
    });

    it('deserialize() of an empty array produces an empty store', () => {
      const restored = BookmarkStore.deserialize([]);
      expect(restored.list()).toEqual([]);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { Transform2D } from './transform2d';

function expectPointClose(p: XY, x: number, y: number, precision = 9): void {
  expect(p.x).toBeCloseTo(x, precision);
  expect(p.y).toBeCloseTo(y, precision);
}

describe('Transform2D', () => {
  it('a fresh root node is the identity: localToWorld/worldToLocal are no-ops', () => {
    const t = new Transform2D();
    expectPointClose(t.localToWorld({ x: 3, y: -5 }), 3, -5);
    expectPointClose(t.worldToLocal({ x: 3, y: -5 }), 3, -5);
  });

  it('setTranslation moves points into world space', () => {
    const t = new Transform2D();
    t.setTranslation(10, -4);
    expectPointClose(t.localToWorld({ x: 1, y: 2 }), 11, -2);
    expectPointClose(t.worldToLocal({ x: 11, y: -2 }), 1, 2);
  });

  it('setScale and rotation combine as translate ∘ rotate ∘ scale', () => {
    const t = new Transform2D();
    t.setTranslation(10, 0);
    t.rotation = Math.PI / 2;
    t.setScale(2);
    // local (1, 0) -> scale -> (2, 0) -> rotate 90 -> (0, 2) -> translate -> (10, 2)
    expectPointClose(t.localToWorld({ x: 1, y: 0 }), 10, 2);
  });

  describe('caching', () => {
    it('worldMatrix returns the same cached instance when nothing changed', () => {
      const t = new Transform2D();
      t.setTranslation(1, 2);
      const m1 = t.worldMatrix;
      const m2 = t.worldMatrix;
      expect(m1).toBe(m2);
    });

    it('worldMatrix is invalidated (a new instance) after a real property change', () => {
      const t = new Transform2D();
      t.setTranslation(1, 2);
      const before = t.worldMatrix;
      t.x = 5;
      const after = t.worldMatrix;
      expect(after).not.toBe(before);
      expectPointClose(t.localToWorld({ x: 0, y: 0 }), 5, 2);
    });

    it('assigning the same value again does not invalidate the cache', () => {
      const t = new Transform2D();
      t.setTranslation(1, 2);
      const before = t.worldMatrix;
      t.x = 1; // same value
      const after = t.worldMatrix;
      expect(after).toBe(before);
    });
  });

  describe('parenting', () => {
    it("a child's worldMatrix combines the parent's transform with its own", () => {
      const parent = new Transform2D();
      parent.setTranslation(100, 0);

      const child = new Transform2D(parent);
      child.setScale(2);

      // local (1, 1) -> scale by child -> (2, 2) -> translate by parent -> (102, 2)
      expectPointClose(child.localToWorld({ x: 1, y: 1 }), 102, 2);
    });

    it("a change in an ancestor invalidates a grandchild's cached worldMatrix too (pull-based)", () => {
      const grandparent = new Transform2D();
      const parent = new Transform2D(grandparent);
      const child = new Transform2D(parent);

      const before = child.worldMatrix;
      grandparent.x = 50;
      const after = child.worldMatrix;

      expect(after).not.toBe(before);
      expectPointClose(child.localToWorld({ x: 0, y: 0 }), 50, 0);
    });

    it('reparenting (reassigning .parent) is picked up on the next read', () => {
      const parentA = new Transform2D();
      parentA.setTranslation(100, 0);
      const parentB = new Transform2D();
      parentB.setTranslation(0, 100);

      const child = new Transform2D(parentA);
      expectPointClose(child.localToWorld({ x: 0, y: 0 }), 100, 0);

      child.parent = parentB;
      expectPointClose(child.localToWorld({ x: 0, y: 0 }), 0, 100);
    });

    it('worldToLocal/localToWorld round-trip through 3 nested, rotated+scaled+translated levels (AFF-5)', () => {
      const a = new Transform2D();
      a.setTranslation(37, -11);
      a.rotation = 0.4;
      a.setScale(1.7, 1.7);

      const b = new Transform2D(a);
      b.setTranslation(-5, 20);
      b.rotation = -0.9;
      b.setScale(0.6, 1.3);

      const c = new Transform2D(b);
      c.setTranslation(8, 8);
      c.rotation = 1.234;
      c.setScale(3, 0.4);

      const original = { x: 12, y: -7 };
      const roundTripped = c.worldToLocal(c.localToWorld(original));
      expectPointClose(roundTripped, original.x, original.y, 6);

      // And the inverse direction: a point authored in c's local space, taken out to the
      // shared root (a's space) and back, should also round-trip.
      const worldPoint = c.localToWorld(original);
      const backToLocal = c.worldToLocal(worldPoint);
      expectPointClose(backToLocal, original.x, original.y, 6);
    });
  });
});

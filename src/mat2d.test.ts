import { describe, expect, it } from 'vitest';
import { Mat2D } from './mat2d';

function expectPointClose(p: XY, x: number, y: number, epsilon = 1e-9): void {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
  void epsilon;
}

describe('Mat2D', () => {
  it('identity leaves points unchanged', () => {
    const m = Mat2D.identity();
    expectPointClose(m.transformPoint({ x: 3, y: -5 }), 3, -5);
  });

  it('translation moves points, but not vectors/directions', () => {
    const m = Mat2D.translation(10, -4);
    expectPointClose(m.transformPoint({ x: 1, y: 2 }), 11, -2);
    expectPointClose(m.transformVector({ x: 1, y: 2 }), 1, 2);
  });

  it('scaling scales points around the origin', () => {
    const m = Mat2D.scaling(2, 3);
    expectPointClose(m.transformPoint({ x: 5, y: 5 }), 10, 15);
  });

  it('scaling with a single argument scales both axes uniformly', () => {
    const m = Mat2D.scaling(2);
    expectPointClose(m.transformPoint({ x: 4, y: -3 }), 8, -6);
  });

  it('rotation by 90° maps (1,0) -> (0,1) and (0,1) -> (-1,0), matching Canvas2D ctx.rotate()', () => {
    const m = Mat2D.rotation(Math.PI / 2);
    expectPointClose(m.transformPoint({ x: 1, y: 0 }), 0, 1);
    expectPointClose(m.transformPoint({ x: 0, y: 1 }), -1, 0);
  });

  it('rotation by a full turn is (approximately) the identity', () => {
    const m = Mat2D.rotation(Math.PI * 2);
    expectPointClose(m.transformPoint({ x: 7, y: -2 }), 7, -2);
  });

  it('multiply composes so that this.multiply(other) applies other first, then this', () => {
    const translate = Mat2D.translation(10, 0);
    const scale = Mat2D.scaling(2);

    // translate ∘ scale: scale first, then translate.
    const translateThenScale = translate.multiply(scale);
    expectPointClose(translateThenScale.transformPoint({ x: 3, y: 1 }), 16, 2); // (3*2+10, 1*2)

    // scale ∘ translate: translate first, then scale.
    const scaleThenTranslate = scale.multiply(translate);
    expectPointClose(scaleThenTranslate.transformPoint({ x: 3, y: 1 }), 26, 2); // ((3+10)*2, 1*2)
  });

  it('multiplying by identity on either side is a no-op', () => {
    const m = Mat2D.translation(5, 7).multiply(Mat2D.rotation(0.3)).multiply(Mat2D.scaling(2, 0.5));
    const identity = Mat2D.identity();
    expect(m.multiply(identity).equals(m)).toBe(true);
    expect(identity.multiply(m).equals(m)).toBe(true);
  });

  it('invert(m).multiply(m) and m.multiply(invert(m)) are both ≈ identity, for a combined transform', () => {
    const m = Mat2D.translation(12, -8)
      .multiply(Mat2D.rotation(0.7))
      .multiply(Mat2D.scaling(2.5, 0.6));

    const inv = m.invert();
    expect(inv.multiply(m).equals(Mat2D.identity(), 1e-9)).toBe(true);
    expect(m.multiply(inv).equals(Mat2D.identity(), 1e-9)).toBe(true);
  });

  it('screenToWorld/worldToScreen round trip: transformPoint then invert().transformPoint ≈ original', () => {
    const m = Mat2D.translation(100, 50).multiply(Mat2D.rotation(1.234)).multiply(Mat2D.scaling(3, 3));
    const inv = m.invert();

    const original = { x: -17, y: 42 };
    const roundTripped = inv.transformPoint(m.transformPoint(original));
    expectPointClose(roundTripped, original.x, original.y, 1e-6);
  });

  it('invert() throws on a singular (non-invertible) matrix', () => {
    const singular = Mat2D.scaling(0, 1); // determinant is 0
    expect(() => singular.invert()).toThrow();
  });

  it('fromDOMMatrix copies the six components', () => {
    const source = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const m = Mat2D.fromDOMMatrix(source);
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('clone produces an independent copy', () => {
    const m = Mat2D.translation(1, 2);
    const c = m.clone();
    c.e = 999;
    expect(m.e).toBe(1);
  });

  it('equals compares within an epsilon', () => {
    const m1 = Mat2D.translation(1, 2);
    const m2 = Mat2D.translation(1 + 1e-12, 2);
    const m3 = Mat2D.translation(1.1, 2);
    expect(m1.equals(m2)).toBe(true);
    expect(m1.equals(m3)).toBe(false);
  });
});

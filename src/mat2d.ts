/// Mat2D /////////////////////////////////////////////////////////////////////////////////////////
//
// A 2D affine transform, stored as the six values Canvas2D itself uses
// (CanvasRenderingContext2D.setTransform(a, b, c, d, e, f) / DOMMatrix), representing
//
//   | a  c  e |
//   | b  d  f |
//   | 0  0  1 |
//
// so that transformPoint({x, y}) = (a*x + c*y + e, b*x + d*y + f). This is the AFF-1 building
// block for the affine transform stack described in BACKLOG.md (Transform2D/Viewport nodes,
// per-layer coordinate systems, rotation, nested viewports) — see the "Фаза 1" section there.
//
// Unlike the rest of src/ (plain global-scope scripts, concatenated into the browser build via
// <script> tags with no import/export — see docs/index.html), this file IS a real ES module
// (it has `export`), so it can be unit-tested with vitest (see mat2d.test.ts) without dragging
// the whole codebase into a module-system migration up front. It only references the ambient
// global `XY` interface from vector.ts by *type* (types are compile-time only, so a non-module
// global file's interface is visible from a module file without an import) and never touches
// `Vector` as a value — so nothing here needs an `import`. It isn't wired into docs/index.html
// yet either: nothing in the browser build consumes it until AFF-2/AFF-3/AFF-4 land. When
// MapWidget/Layer start consuming Mat2D/Transform2D for real, that's the point where the rest of
// src/ will need to move to ES modules too (and docs/index.html's <script> tags to
// type="module") — a deliberate, tracked decision, not something to back into by accident.

export class Mat2D {
  constructor(
    public a = 1, public b = 0,
    public c = 0, public d = 1,
    public e = 0, public f = 0
  ) {}

  static identity(): Mat2D {
    return new Mat2D();
  }

  static translation(tx: number, ty: number): Mat2D {
    return new Mat2D(1, 0, 0, 1, tx, ty);
  }

  static scaling(sx: number, sy: number = sx): Mat2D {
    return new Mat2D(sx, 0, 0, sy, 0, 0);
  }

  /** Angle in radians. Matches Canvas2D's ctx.rotate() convention (positive = clockwise on screen, since canvas y grows downward). */
  static rotation(angleRad: number): Mat2D {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return new Mat2D(cos, sin, -sin, cos, 0, 0);
  }

  static fromDOMMatrix(m: { a: number; b: number; c: number; d: number; e: number; f: number }): Mat2D {
    return new Mat2D(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  clone(): Mat2D {
    return new Mat2D(this.a, this.b, this.c, this.d, this.e, this.f);
  }

  /** this ∘ other: applies `other` first, then `this` — matches Canvas2D's ctx.transform() composition order. */
  multiply(other: Mat2D): Mat2D {
    return new Mat2D(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f
    );
  }

  determinant(): number {
    return this.a * this.d - this.b * this.c;
  }

  invert(): Mat2D {
    const det = this.determinant();
    if (det === 0) {
      throw new Error('Mat2D.invert: matrix is not invertible (determinant is 0)');
    }
    const invDet = 1 / det;
    const a = this.d * invDet;
    const b = -this.b * invDet;
    const c = -this.c * invDet;
    const d = this.a * invDet;
    // Solve for e', f' such that this.multiply(inverse) === identity.
    const e = -(a * this.e + c * this.f);
    const f = -(b * this.e + d * this.f);
    return new Mat2D(a, b, c, d, e, f);
  }

  transformPoint(p: XY): XY {
    return {
      x: this.a * p.x + this.c * p.y + this.e,
      y: this.b * p.x + this.d * p.y + this.f
    };
  }

  /** Like transformPoint, but ignores translation (e, f) — for directions/extents, not positions. */
  transformVector(v: XY): XY {
    return {
      x: this.a * v.x + this.c * v.y,
      y: this.b * v.x + this.d * v.y
    };
  }

  equals(other: Mat2D, epsilon = 1e-9): boolean {
    return (
      Math.abs(this.a - other.a) <= epsilon &&
      Math.abs(this.b - other.b) <= epsilon &&
      Math.abs(this.c - other.c) <= epsilon &&
      Math.abs(this.d - other.d) <= epsilon &&
      Math.abs(this.e - other.e) <= epsilon &&
      Math.abs(this.f - other.f) <= epsilon
    );
  }

  toString(): string {
    return `Mat2D(${[this.a, this.b, this.c, this.d, this.e, this.f].join(', ')})`;
  }
}

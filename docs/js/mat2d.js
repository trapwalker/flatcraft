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
// This file is a real ES module (it has `export`), so it can be unit-tested with vitest (see
// mat2d.test.ts). It references the ambient global `XY` interface (src/types/geometry.d.ts) by
// *type* only (types are compile-time only, so an ambient global interface is visible from a
// module file without an import) and never touches `Vector` as a value — so it needs no import
// of its own. Since AFF-3, it IS wired into the browser build transitively (map.ts imports
// Transform2D, which imports this) — the whole of src/ moved to real ES modules for that; see
// docs/index.html and BACKLOG.md.
export class Mat2D {
    constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.e = e;
        this.f = f;
    }
    static identity() {
        return new Mat2D();
    }
    static translation(tx, ty) {
        return new Mat2D(1, 0, 0, 1, tx, ty);
    }
    static scaling(sx, sy = sx) {
        return new Mat2D(sx, 0, 0, sy, 0, 0);
    }
    /** Angle in radians. Matches Canvas2D's ctx.rotate() convention (positive = clockwise on screen, since canvas y grows downward). */
    static rotation(angleRad) {
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        return new Mat2D(cos, sin, -sin, cos, 0, 0);
    }
    static fromDOMMatrix(m) {
        return new Mat2D(m.a, m.b, m.c, m.d, m.e, m.f);
    }
    clone() {
        return new Mat2D(this.a, this.b, this.c, this.d, this.e, this.f);
    }
    /** this ∘ other: applies `other` first, then `this` — matches Canvas2D's ctx.transform() composition order. */
    multiply(other) {
        return new Mat2D(this.a * other.a + this.c * other.b, this.b * other.a + this.d * other.b, this.a * other.c + this.c * other.d, this.b * other.c + this.d * other.d, this.a * other.e + this.c * other.f + this.e, this.b * other.e + this.d * other.f + this.f);
    }
    determinant() {
        return this.a * this.d - this.b * this.c;
    }
    invert() {
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
    transformPoint(p) {
        return {
            x: this.a * p.x + this.c * p.y + this.e,
            y: this.b * p.x + this.d * p.y + this.f
        };
    }
    /** Like transformPoint, but ignores translation (e, f) — for directions/extents, not positions. */
    transformVector(v) {
        return {
            x: this.a * v.x + this.c * v.y,
            y: this.b * v.x + this.d * v.y
        };
    }
    equals(other, epsilon = 1e-9) {
        return (Math.abs(this.a - other.a) <= epsilon &&
            Math.abs(this.b - other.b) <= epsilon &&
            Math.abs(this.c - other.c) <= epsilon &&
            Math.abs(this.d - other.d) <= epsilon &&
            Math.abs(this.e - other.e) <= epsilon &&
            Math.abs(this.f - other.f) <= epsilon);
    }
    toString() {
        return `Mat2D(${[this.a, this.b, this.c, this.d, this.e, this.f].join(', ')})`;
    }
}
//# sourceMappingURL=mat2d.js.map
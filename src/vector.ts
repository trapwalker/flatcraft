/**
 * Vector
 *
 * Preserves the original loosely-typed API: every method accepts either
 * two numbers `(x, y)`, a single number (used for both axes), or an
 * object shaped like `{x, y}`.
 */

interface XY {
  x: number;
  y: number;
}

type XArg = number | XY;

class Vector implements XY {
  x: number;
  y: number;

  constructor(x?: XArg, y?: number) {
    const [rx, ry] = Vector._resolve(x, y);
    this.x = rx || 0;
    this.y = ry || 0;
  }

  private static _resolve(x: XArg | undefined, y: number | undefined): [number | undefined, number | undefined] {
    if (typeof x === 'object' && x !== null) {
      return [x.x, x.y];
    }
    if (y == null) y = x;
    return [x, y];
  }

  sub(x: XArg, y?: number): this {
    const [rx, ry] = Vector._resolve(x, y);
    this.x -= rx || 0;
    this.y -= ry || 0;
    return this;
  }

  add(x: XArg, y?: number): this {
    const [rx, ry] = Vector._resolve(x, y);
    this.x += rx || 0;
    this.y += ry || 0;
    return this;
  }

  mul(x: XArg, y?: number): this {
    const [rx, ry] = Vector._resolve(x, y);
    this.x *= rx || 0;
    this.y *= ry || 0;
    return this;
  }

  div(x: XArg, y?: number): this {
    const [rx, ry] = Vector._resolve(x, y);
    this.x /= rx || 0;
    this.y /= ry || 0;
    return this;
  }

  set(x: XArg, y?: number): this {
    const [rx, ry] = Vector._resolve(x, y);
    this.x = rx || 0;
    this.y = ry || 0;
    return this;
  }

  normalize(): this {
    const length = this.length();
    if (length > 0) {
      this.x /= length;
      this.y /= length;
    }
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  length2(): number {
    return this.x * this.x + this.y * this.y;
  }

  distance(v: XY): number {
    const x = this.x - v.x;
    const y = this.y - v.y;
    return Math.sqrt(x * x + y * y);
  }

  distance2(v: XY): number {
    const x = this.x - v.x;
    const y = this.y - v.y;
    return x * x + y * y;
  }

  lerp(v: XY, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    return this;
  }

  toString(): string {
    return '(x:' + this.x + ', y:' + this.y + ')';
  }

  clone(): Vector {
    return new Vector(this.x, this.y);
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  angleTo(v: XY): number {
    const dx = v.x - this.x;
    const dy = v.y - this.y;
    return Math.atan2(dy, dx);
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  neg(): this {
    this.x *= -1;
    this.y *= -1;
    return this;
  }

  static add(v1: XY, v2: XY | number): Vector {
    const v2o = v2 as Partial<XY>;
    if (v2o.x != null && v2o.y != null) {
      return new Vector(v1.x + v2o.x, v1.y + v2o.y);
    } else {
      const s = v2 as number;
      return new Vector(v1.x + s, v1.y + s);
    }
  }

  static sub(v1: XY, v2: XY | number): Vector {
    const v2o = v2 as Partial<XY>;
    if (v2o.x != null && v2o.y != null) {
      return new Vector(v1.x - v2o.x, v1.y - v2o.y);
    } else {
      const s = v2 as number;
      return new Vector(v1.x - s, v1.y - s);
    }
  }

  static mul(v1: XY, v2: XY | number): Vector {
    const v2o = v2 as Partial<XY>;
    if (v2o.x != null && v2o.y != null) {
      return new Vector(v1.x * v2o.x, v1.y * v2o.y);
    } else {
      const s = v2 as number;
      return new Vector(v1.x * s, v1.y * s);
    }
  }

  static div(v1: XY, v2: XY | number): Vector {
    const v2o = v2 as Partial<XY>;
    if (v2o.x != null && v2o.y != null) {
      return new Vector(v1.x / v2o.x, v1.y / v2o.y);
    } else {
      const s = v2 as number;
      return new Vector(v1.x / s, v1.y / s);
    }
  }

  static random(): Vector {
    return new Vector(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    );
  }

  static scale(v: Vector, s: number): Vector {
    return v.clone().scale(s);
  }
}

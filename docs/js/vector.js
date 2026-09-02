"use strict";
/**
 * Vector
 *
 * Preserves the original loosely-typed API: every method accepts either
 * two numbers `(x, y)`, a single number (used for both axes), or an
 * object shaped like `{x, y}`.
 */
class Vector {
    constructor(x, y) {
        const [rx, ry] = Vector._resolve(x, y);
        this.x = rx || 0;
        this.y = ry || 0;
    }
    static _resolve(x, y) {
        if (typeof x === 'object' && x !== null) {
            return [x.x, x.y];
        }
        if (y == null)
            y = x;
        return [x, y];
    }
    sub(x, y) {
        const [rx, ry] = Vector._resolve(x, y);
        this.x -= rx || 0;
        this.y -= ry || 0;
        return this;
    }
    add(x, y) {
        const [rx, ry] = Vector._resolve(x, y);
        this.x += rx || 0;
        this.y += ry || 0;
        return this;
    }
    mul(x, y) {
        const [rx, ry] = Vector._resolve(x, y);
        this.x *= rx || 0;
        this.y *= ry || 0;
        return this;
    }
    div(x, y) {
        const [rx, ry] = Vector._resolve(x, y);
        this.x /= rx || 0;
        this.y /= ry || 0;
        return this;
    }
    set(x, y) {
        const [rx, ry] = Vector._resolve(x, y);
        this.x = rx || 0;
        this.y = ry || 0;
        return this;
    }
    normalize() {
        const length = this.length();
        if (length > 0) {
            this.x /= length;
            this.y /= length;
        }
        return this;
    }
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    length2() {
        return this.x * this.x + this.y * this.y;
    }
    distance(v) {
        const x = this.x - v.x;
        const y = this.y - v.y;
        return Math.sqrt(x * x + y * y);
    }
    distance2(v) {
        const x = this.x - v.x;
        const y = this.y - v.y;
        return x * x + y * y;
    }
    lerp(v, t) {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        return this;
    }
    toString() {
        return '(x:' + this.x + ', y:' + this.y + ')';
    }
    clone() {
        return new Vector(this.x, this.y);
    }
    angle() {
        return Math.atan2(this.y, this.x);
    }
    angleTo(v) {
        const dx = v.x - this.x;
        const dy = v.y - this.y;
        return Math.atan2(dy, dx);
    }
    scale(s) {
        this.x *= s;
        this.y *= s;
        return this;
    }
    neg() {
        this.x *= -1;
        this.y *= -1;
        return this;
    }
    static add(v1, v2) {
        const v2o = v2;
        if (v2o.x != null && v2o.y != null) {
            return new Vector(v1.x + v2o.x, v1.y + v2o.y);
        }
        else {
            const s = v2;
            return new Vector(v1.x + s, v1.y + s);
        }
    }
    static sub(v1, v2) {
        const v2o = v2;
        if (v2o.x != null && v2o.y != null) {
            return new Vector(v1.x - v2o.x, v1.y - v2o.y);
        }
        else {
            const s = v2;
            return new Vector(v1.x - s, v1.y - s);
        }
    }
    static mul(v1, v2) {
        const v2o = v2;
        if (v2o.x != null && v2o.y != null) {
            return new Vector(v1.x * v2o.x, v1.y * v2o.y);
        }
        else {
            const s = v2;
            return new Vector(v1.x * s, v1.y * s);
        }
    }
    static div(v1, v2) {
        const v2o = v2;
        if (v2o.x != null && v2o.y != null) {
            return new Vector(v1.x / v2o.x, v1.y / v2o.y);
        }
        else {
            const s = v2;
            return new Vector(v1.x / s, v1.y / s);
        }
    }
    static random() {
        return new Vector(Math.random() * 2 - 1, Math.random() * 2 - 1);
    }
    static scale(v, s) {
        return v.clone().scale(s);
    }
}
//# sourceMappingURL=vector.js.map
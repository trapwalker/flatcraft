/// Transform2D ///////////////////////////////////////////////////////////////////////////////////
//
// A node in the affine transform stack described in BACKLOG.md (AFF-2): wraps a local
// translate/scale/rotate, optionally parented to another Transform2D, and exposes the
// composed localMatrix/worldMatrix as cached Mat2D instances. This is the building block
// AFF-4 will give each Layer (and later VP-* nested viewports) its own coordinate system —
// see BACKLOG.md, "Фаза 1"/"Фаза 6".
//
// Same module-system note as mat2d.ts: this is a real ES module (export class Transform2D),
// unlike the rest of src/ (global scripts, see docs/index.html) — not wired into the browser
// build yet, only reachable from tests until AFF-4 lands.
//
// Skew is intentionally not implemented (BACKLOG.md calls it optional) — out of scope for now,
// to keep this a small, well-tested primitive rather than a speculative superset.
import { Mat2D } from './mat2d';
export class Transform2D {
    constructor(parent = null) {
        this._x = 0;
        this._y = 0;
        this._scaleX = 1;
        this._scaleY = 1;
        this._rotation = 0; // radians
        // Bumped whenever a local property actually changes (no-op assignments, e.g. `t.x = t.x`,
        // don't bump it). localMatrix/worldMatrix caches compare against this to know they're stale.
        this._localVersion = 0;
        this._localMatrixCache = null;
        this._localMatrixVersionUsed = -1;
        // worldMatrix caching is pull-based, not push-based: rather than a parent notifying every
        // descendant when it changes, each node just remembers the parent worldMatrix *object
        // reference* it last combined with. Since `worldMatrix` always returns the same cached Mat2D
        // instance until something upstream actually changes, a `!==` check here is a correct and
        // cheap staleness test — including transitively: if a grandparent changes, the parent's own
        // worldMatrix getter produces a new object on next read, which this node then detects too.
        this._worldMatrixCache = null;
        this._worldMatrixLocalVersionUsed = -1;
        this._worldMatrixParentRef = null;
        this.parent = parent;
    }
    get x() { return this._x; }
    set x(value) { if (value !== this._x) {
        this._x = value;
        this._localVersion++;
    } }
    get y() { return this._y; }
    set y(value) { if (value !== this._y) {
        this._y = value;
        this._localVersion++;
    } }
    get scaleX() { return this._scaleX; }
    set scaleX(value) { if (value !== this._scaleX) {
        this._scaleX = value;
        this._localVersion++;
    } }
    get scaleY() { return this._scaleY; }
    set scaleY(value) { if (value !== this._scaleY) {
        this._scaleY = value;
        this._localVersion++;
    } }
    get rotation() { return this._rotation; }
    set rotation(value) { if (value !== this._rotation) {
        this._rotation = value;
        this._localVersion++;
    } }
    setTranslation(x, y) { this.x = x; this.y = y; return this; }
    setScale(sx, sy = sx) { this.scaleX = sx; this.scaleY = sy; return this; }
    /** Local transform as translate ∘ rotate ∘ scale (a local point is scaled, then rotated, then translated). */
    get localMatrix() {
        if (!this._localMatrixCache || this._localMatrixVersionUsed !== this._localVersion) {
            this._localMatrixCache = Mat2D.translation(this._x, this._y)
                .multiply(Mat2D.rotation(this._rotation))
                .multiply(Mat2D.scaling(this._scaleX, this._scaleY));
            this._localMatrixVersionUsed = this._localVersion;
        }
        return this._localMatrixCache;
    }
    /** localMatrix composed with every ancestor's, i.e. this node's transform relative to the root of its chain. */
    get worldMatrix() {
        const parentWorld = this.parent ? this.parent.worldMatrix : null;
        const stale = !this._worldMatrixCache
            || this._worldMatrixLocalVersionUsed !== this._localVersion
            || parentWorld !== this._worldMatrixParentRef;
        // The `this._worldMatrixCache` re-check below is redundant with `!stale` for the logic
        // (stale is already true whenever the cache is empty) — it's there so TS can narrow the
        // type within this one return statement; narrowing doesn't survive the getter calls above
        // (`this.parent.worldMatrix`, `this.localMatrix`) if read again afterwards.
        if (!stale && this._worldMatrixCache) {
            return this._worldMatrixCache;
        }
        const combined = parentWorld ? parentWorld.multiply(this.localMatrix) : this.localMatrix;
        this._worldMatrixCache = combined;
        this._worldMatrixLocalVersionUsed = this._localVersion;
        this._worldMatrixParentRef = parentWorld;
        return combined;
    }
    /** A point in this node's own root's coordinate space -> a point local to this node. */
    worldToLocal(p) {
        return this.worldMatrix.invert().transformPoint(p);
    }
    /** A point local to this node -> a point in this node's own root's coordinate space. */
    localToWorld(p) {
        return this.worldMatrix.transformPoint(p);
    }
}
//# sourceMappingURL=transform2d.js.map
/**
 * Vector
 */

function Vector(x, y) {
    if (typeof x === 'object') {
        y = x.y;
        x = x.x;
    }
    else {
        if (y == null) y = x;
    }

    this.x = x || 0;
    this.y = y || 0;
};

Vector.prototype.sub = function(x, y) {
    if (typeof x === 'object') {
        y = x.y;
        x = x.x;
    }
    else {
        if (y == null) y = x;
    }
    this.x -= x || 0;
    this.y -= y || 0;
    return this;
};

Vector.prototype.add = function(x, y) {
    if (typeof x === 'object') {
        y = x.y;
        x = x.x;
    }
    else {
        if (y == null) y = x;
    }
    this.x += x || 0;
    this.y += y || 0;
    return this;
};

Vector.prototype.mul = function(x, y) {
    if (typeof x === 'object') {
        y = x.y;
        x = x.x;
    }
    else {
        if (y == null) y = x;
    }
    this.x *= x || 0;
    this.y *= y || 0;
    return this;
};

Vector.prototype.div = function(x, y) {
    if (typeof x === 'object') {
        y = x.y;
        x = x.x;
    }
    else {
        if (y == null) y = x;
    }
    this.x /= x || 0;
    this.y /= y || 0;
    return this;
};

Vector.prototype.set = function(x, y) {
    if (typeof x === 'object') {
        y = x.y;
        x = x.x;
    }
    else {
        if (y == null) y = x;
    }
    this.x = x || 0;
    this.y = y || 0;
    return this;
};

Vector.prototype.normalize = function() {
    var length = this.length();
    if (length > 0) {
        this.x /= length;
        this.y /= length;
    };
    return this;
};

Vector.prototype.length = function() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
};

Vector.prototype.length2 = function() {
    return this.x * this.x + this.y * this.y;
};

Vector.prototype.distance = function(v) {
    var x = this.x - v.x;
    var y = this.y - v.y;
    return Math.sqrt(x * x + y * y);
};

Vector.prototype.distance2 = function(v) {
    var x = this.x - v.x;
    var y = this.y - v.y;
    return x * x + y * y;
};


Vector.prototype.lerp = function(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    return this;
};

Vector.prototype.toString = function() {
    return '(x:' + this.x + ', y:' + this.y + ')';
};

Vector.prototype.clone = function() {
    return new Vector(this.x, this.y);
};

Vector.prototype.angle = function() {
    return Math.atan2(this.y, this.x);
};

Vector.prototype.angleTo = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y;
    return Math.atan2(dy, dx);
};

Vector.prototype.scale = function(s) {
    this.x *= s;
    this.y *= s;
    return this;
};

Vector.prototype.neg = function() {
    this.x *= -1;
    this.y *= -1;
    return this;
};

Vector.add = function(v1, v2) {
    if (v2.x != null && v2.y != null) {
        return new Vector(
        v1.x + v2.x,
        v1.y + v2.y);
    } else {
        return new Vector(
        v1.x + v2,
        v1.y + v2);
    };
};

Vector.sub = function(v1, v2) {
    if (v2.x != null && v2.y != null) {
        return new Vector(
        v1.x - v2.x,
        v1.y - v2.y);
    } else {
        return new Vector(
        v1.x - v2,
        v1.y - v2);
    };
};

Vector.mul = function(v1, v2) {
    if (v2.x != null && v2.y != null) {
        return new Vector(
        v1.x * v2.x,
        v1.y * v2.y);
    } else {
        return new Vector(
        v1.x * v2,
        v1.y * v2);
    };
};

Vector.div = function(v1, v2) {
    if (v2.x != null && v2.y != null) {
        return new Vector(
        v1.x / v2.x,
        v1.y / v2.y);
    } else {
        return new Vector(
        v1.x / v2,
        v1.y / v2);
    };
};

Vector.random = function() {
    return new Vector(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
    );
};

Vector.scale = function(v, s) {
    return v.clone().scale(s);
};

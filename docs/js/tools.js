/// AvgRing, Iter and other small shared utilities.
export function Iter(array) {
    let idx = 0;
    return function iterator() {
        idx += 1;
        return array[idx - 1];
    };
}
export const logPrint = function (text) {
    const con = document.getElementById('console');
    if (con) {
        while (logPrint.log_counter >= logPrint.LOG_ITEMS_LIMIT) {
            con.removeChild(con.firstChild);
            logPrint.log_counter--;
        }
        const p = document.createElement('p');
        p.innerHTML = text;
        con.appendChild(p);
        logPrint.log_counter++;
        con.scrollTop = con.scrollHeight;
    }
};
logPrint.log_counter = 0;
logPrint.LOG_ITEMS_LIMIT = 100;
/// AvgRing ///////////////////////////////////////////////////////////////////////////////////////
export class AvgRing {
    constructor(size) {
        this.size = size;
        this._buffer = [];
        this._head = 0;
        this.minimum = null;
        this.maximum = null;
        this.sum = 0;
        this.last_sum = 0;
        this.full_count = 0;
        this.value = null;
    }
    frame_range() {
        let v_min = null;
        let v_max = null;
        const buffer = this._buffer;
        if (buffer.length > 0) {
            v_min = buffer[0];
            v_max = buffer[0];
            for (let i = 1; i < buffer.length; i++) {
                if (buffer[i] < v_min)
                    v_min = buffer[i];
                if (buffer[i] > v_max)
                    v_max = buffer[i];
            }
        }
        return [v_min, v_max];
    }
    add(value) {
        // `!value` alone lets Infinity/-Infinity through (only 0/NaN/falsy values are "falsy") —
        // a single Infinity sample permanently corrupts `sum`/`last_sum` (Infinity + anything finite
        // stays Infinity forever, and once that sample is evicted from the ring, subtracting it back
        // out gives Infinity - Infinity = NaN, which then propagates through every future average).
        // Real trigger seen in practice: fps computed as Math.round(1/dt) where dt came from a
        // millisecond-resolution clock — two frames landing in the same millisecond (routine on a
        // 120Hz+ display) gives dt=0, fps=Infinity. See MapWidget.onRepaint for the actual timer fix;
        // this check is the unconditional backstop regardless of what feeds this ring.
        if (!value || !isFinite(value))
            return;
        const buffer = this._buffer;
        if (buffer.length >= this.size) {
            const old = buffer[this._head];
            if (old)
                this.last_sum -= old;
        }
        buffer[this._head] = value;
        this._head = (this._head + 1) % this.size;
        if (this.maximum === null || value > this.maximum)
            this.maximum = value;
        if (this.minimum === null || value < this.minimum)
            this.minimum = value;
        this.sum += value;
        this.last_sum += value;
        this.full_count += 1;
        this.value = value;
    }
    avg() {
        return this.last_sum / this._buffer.length;
    }
}
///////////////////////////////////////////////////////////////////////////////////////////////////
//# sourceMappingURL=tools.js.map
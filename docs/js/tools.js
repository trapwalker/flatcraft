"use strict";
/// AvgRing, Iter and other small shared utilities.
function Iter(array) {
    let idx = 0;
    return function iterator() {
        idx += 1;
        return array[idx - 1];
    };
}
const logPrint = function (text) {
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
class AvgRing {
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
        if (!value)
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
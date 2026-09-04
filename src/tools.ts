/// AvgRing, Iter and other small shared utilities.

export function Iter<T>(array: ArrayLike<T>): () => T {
  let idx = 0;
  return function iterator(): T {
    idx += 1;
    return array[idx - 1];
  };
}

// Named `logPrint` (not `print`) purely to avoid colliding with the DOM's
// built-in `window.print`; the original JS shadowed it too (harmlessly, at
// runtime), but TypeScript's lib types reject a same-named redeclaration.
// Nothing else in the codebase calls it by name, so the rename is inert.
interface LogPrintFn {
  (text: string): void;
  log_counter: number;
  LOG_ITEMS_LIMIT: number;
}

export const logPrint = (function (text: string): void {
  const con = document.getElementById('console');
  if (con) {
    while (logPrint.log_counter >= logPrint.LOG_ITEMS_LIMIT) {
      con.removeChild(con.firstChild as ChildNode);
      logPrint.log_counter--;
    }
    const p = document.createElement('p');
    p.innerHTML = text;
    con.appendChild(p);
    logPrint.log_counter++;

    con.scrollTop = con.scrollHeight;
  }
} as LogPrintFn);

logPrint.log_counter = 0;
logPrint.LOG_ITEMS_LIMIT = 100;

/// AvgRing ///////////////////////////////////////////////////////////////////////////////////////
export class AvgRing {
  size: number;
  private _buffer: number[];
  private _head: number;
  minimum: number | null;
  maximum: number | null;
  sum: number;
  last_sum: number;
  full_count: number;
  value: number | null;

  constructor(size: number) {
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

  frame_range(): [number | null, number | null] {
    let v_min: number | null = null;
    let v_max: number | null = null;
    const buffer = this._buffer;
    if (buffer.length > 0) {
      v_min = buffer[0];
      v_max = buffer[0];

      for (let i = 1; i < buffer.length; i++) {
        if (buffer[i] < (v_min as number)) v_min = buffer[i];
        if (buffer[i] > (v_max as number)) v_max = buffer[i];
      }
    }
    return [v_min, v_max];
  }

  add(value: number): void {
    if (!value) return;

    const buffer = this._buffer;

    if (buffer.length >= this.size) {
      const old = buffer[this._head];
      if (old) this.last_sum -= old;
    }

    buffer[this._head] = value;
    this._head = (this._head + 1) % this.size;

    if (this.maximum === null || value > this.maximum) this.maximum = value;
    if (this.minimum === null || value < this.minimum) this.minimum = value;

    this.sum += value;
    this.last_sum += value;
    this.full_count += 1;
    this.value = value;
  }

  avg(): number {
    return this.last_sum / this._buffer.length;
  }
}
///////////////////////////////////////////////////////////////////////////////////////////////////

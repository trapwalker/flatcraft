import { NC, COLOR_MAP } from './defines.js';
export function load_tree(stream, callback, ctx, w, x = 0, y = 0) {
    // todo: Пробрасывать глубину узла от корня
    const node = stream();
    if (node === NC && w > 1) {
        // todo: Добавить коллбэк on_node
        w /= 2;
        load_tree(stream, callback, ctx, w, x, y);
        load_tree(stream, callback, ctx, w, x + w, y);
        load_tree(stream, callback, ctx, w, x, y + w);
        load_tree(stream, callback, ctx, w, x + w, y + w);
    }
    else {
        // todo: Переименовать коллбэк в on_leaf
        callback(ctx, node, w, x, y);
    }
}
export function leafFunction(ctx, color, w, x, y) {
    const c = COLOR_MAP[color];
    if (c === undefined) {
        console.warn('Unknown color: "' + color + '"');
    }
    else if (c !== null) {
        ctx.fillStyle = typeof c === 'string' ? c : c.color;
        ctx.fillRect(x, y, w, w);
    }
}
export function square(callback, x, y, z, r) {
    if (r < 1) {
        callback(x, y, z);
        return 1;
    }
    let ix = x - r;
    let iy = y - r;
    let cnt = 0;
    for (let dir = 0; dir < 4; dir++) {
        const dx = [1, 0, -1, 0][dir];
        const dy = [0, 1, 0, -1][dir];
        for (let j = 0; j < 2 * r; j++) {
            cnt += callback(ix, iy, z);
            ix += dx;
            iy += dy;
        }
    }
    return cnt;
}
export function ring(callback, x, y, z, r1, r2) {
    if (r2 === undefined) {
        r2 = r1;
        r1 = 0;
    }
    let cnt = 0;
    for (let r = r1; r < r2; r++)
        cnt += square(callback, x, y, z, r);
    return cnt;
}
export function heat(callback, x, y, z, r1, r2, deep) {
    deep = deep === undefined ? r2 - r1 : deep;
    let cnt = 0;
    cnt += ring(callback, x, y, z, r1);
    for (let i = 0; i < r2 - r1; i++) {
        cnt += square(callback, x, y, z, r1 + i);
        if (i < deep) {
            for (let j = 0; j < i; j++) {
                cnt += square(callback, x, y, z + j + 1, r1 + i - j - 1);
                cnt += square(callback, x, y, z - j - 1, r1 + i - j - 1);
            }
            cnt += ring(callback, x, y, z + i + 1, r1);
            cnt += ring(callback, x, y, z - i - 1, r1);
        }
    }
    return cnt;
}
//# sourceMappingURL=tile_tree.js.map
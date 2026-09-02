"use strict";
// Standalone scratch page (test_heating.html): loads only tile_tree.js + this file.
const cnv = window['canvas'];
const ctx = cnv.getContext('2d');
const w = cnv.width;
const h = cnv.height;
const c = 10;
ctx.strokeStyle = 'black';
ctx.rect(0, 0, w, h);
ctx.stroke();
function draw(t = '', x = 0, y = 0, _z = 0) {
    const xx = w / 2 + x * w / c;
    const yy = h / 2 + y * h / c;
    ctx.beginPath();
    ctx.strokeStyle = 'black';
    ctx.rect(xx + 3, yy + 3, w / c - 6, h / c - 6);
    ctx.stroke();
    ctx.font = 'bold 18px Arial'; // todo: font size calculate
    ctx.fillStyle = 'red';
    ctx.textAlign = 'center';
    ctx.fillText(String(t), xx + w / c / 2, yy + h / c / 2);
}
function grid() {
    for (let iy = -5; iy < 5; iy++) {
        for (let ix = -5; ix < 5; ix++) {
            const xx = w / 2 + ix * w / c;
            const yy = h / 2 + iy * h / c;
            ctx.beginPath();
            ctx.strokeStyle = 'green';
            ctx.rect(xx, yy, w / c, h / c);
            ctx.stroke();
            ctx.font = '10px Arial'; // todo: font size calculate
            ctx.fillStyle = 'blue';
            ctx.textAlign = 'center';
            ctx.fillText('' + [ix, iy], xx + w / c / 2, yy + h / c - 5);
        }
    }
}
function full() {
    let i = 0;
    for (let iy = -c / 2; iy < c / 2; iy++)
        for (let ix = -c / 2; ix < c / 2; ix++) {
            draw(i, ix, iy);
            i++;
        }
}
grid();
const x = 0;
const y = 0;
const z = 0;
const r = 3;
function it() {
    let i = 0;
    return function (ix, iy, iz) {
        if (iz === cut)
            draw(i, ix, iy, iz);
        i++;
        return 1;
    };
}
const cut = 2;
const r1 = Math.ceil(1920 / 256 / 2 + 1);
const r2 = r1 * 2;
const deep = 2;
//ring(it(), r, x, y, 0);
console.log('' + [r1, r2, deep]);
console.log(heat(it(), x, y, z, r1, r2, deep));
//full();
//# sourceMappingURL=test_heating.js.map
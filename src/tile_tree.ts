type TreeCallback = (ctx: CanvasRenderingContext2D, node: string, w: number, x: number, y: number) => void;

function load_tree(
  stream: () => string,
  callback: TreeCallback,
  ctx: CanvasRenderingContext2D,
  w: number,
  x = 0,
  y = 0
): void {
  // todo: Пробрасывать глубину узла от корня
  const node = stream();
  if (node === NC && w > 1) {
    // todo: Добавить коллбэк on_node
    w /= 2;
    load_tree(stream, callback, ctx, w, x, y);
    load_tree(stream, callback, ctx, w, x + w, y);
    load_tree(stream, callback, ctx, w, x, y + w);
    load_tree(stream, callback, ctx, w, x + w, y + w);
  } else {
    // todo: Переименовать коллбэк в on_leaf
    callback(ctx, node, w, x, y);
  }
}

function leafFunction(ctx: CanvasRenderingContext2D, color: string, w: number, x: number, y: number): void {
  const c = COLOR_MAP[color];
  if (c === undefined) {
    console.warn('Unknown color: "' + color + '"');
  } else if (c !== null) {
    ctx.fillStyle = typeof c === 'string' ? c : c.color;
    ctx.fillRect(x, y, w, w);
  }
}

type SquareCallback = (x: number, y: number, z: number) => number;

function square(callback: SquareCallback, x: number, y: number, z: number, r: number): number {
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

function ring(callback: SquareCallback, x: number, y: number, z: number, r1: number, r2?: number): number {
  if (r2 === undefined) {
    r2 = r1;
    r1 = 0;
  }
  let cnt = 0;
  for (let r = r1; r < r2; r++) cnt += square(callback, x, y, z, r);
  return cnt;
}

function heat(
  callback: SquareCallback,
  x: number,
  y: number,
  z: number,
  r1: number,
  r2: number,
  deep?: number
): number {
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

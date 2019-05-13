function load_tree(stream, callback, ctx, w, x, y) {
  // todo: Пробрасывать глубину узла от корня
  x = (x===undefined)?0:x;
  y = (y===undefined)?0:y;
  var node = stream();
  if (node == NC && w > 1) {
    // todo: Добавить коллбэк on_node
    w /= 2;
    load_tree(stream, callback, ctx, w, x    , y    );
    load_tree(stream, callback, ctx, w, x + w, y    );
    load_tree(stream, callback, ctx, w, x,     y + w);
    load_tree(stream, callback, ctx, w, x + w, y + w);
  } else {
    // todo: Переиеновать коллбэк в on_leaf
    callback(ctx, node, w, x, y);
  }
}

function leafFunction(ctx, color, w, x, y) {
  var c = COLOR_MAP[color];
  if (c === undefined) {
    console.warn('Unknown color: "' + color + '"');
  } else if (c !== null) {
    /*var pattern;
    if (pattern = dict.get(ctx, c))
      ctx.fillStyle = pattern;
    else*/
    ctx.fillStyle = c.color || c;
    ctx.fillRect(x, y, w, w);
  }
}


function square(callback, x, y, z, r) {
  if (r < 1) {
    callback(x, y, z);
    return 1
  }
  var ix = x - r;
  var iy = y - r;
  var cnt = 0;
  for (var dir=0; dir<4; dir++) {
    var dx = [1, 0, -1, 0][dir];
    var dy = [0, 1, 0, -1][dir];
    for (var j=0; j < 2*r; j++) {
      cnt += callback(ix, iy, z);
      ix += dx;
      iy += dy;
    }
  }
  return cnt;
}

function ring(callback, x, y, z, r1, r2) {
  if (r2 === undefined) {r2 = r1; r1 = 0;}
  var cnt = 0;
  for (var r = r1; r < r2; r++) cnt += square(callback, x, y, z, r);
  return cnt;
}

function heat(callback, x, y, z, r1, r2, deep) {
  deep = (deep === undefined)?(r2 - r1):deep;
  var cnt = 0;
  cnt += ring(callback, x, y, z, r1);
  for (var i = 0; i < r2 - r1; i++) {
    cnt += square(callback, x, y, z, r1 + i);
    if (i < deep) {
      for (var j = 0; j < i; j++) {
       cnt += square(callback, x, y, z + j + 1, r1 + i - j - 1);
       cnt += square(callback, x, y, z - j - 1, r1 + i - j - 1);
      }/**/
      cnt += ring(callback, x, y, z + i + 1, r1);
      cnt += ring(callback, x, y, z - i - 1, r1);
    }
  }
  return cnt;
}

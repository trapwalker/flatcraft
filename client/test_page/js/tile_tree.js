var test_img = document.createElement("IMG");
test_img.src = "images/grunt512.png";
var pattern = null;

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
  c = COLOR_MAP[color];
  if (c === undefined) {
    console.warn('Unknown color: "' + color + '"');
  } else if (c !== null) {
    if (pattern == null)
      pattern = ctx.createPattern(test_img, 'repeat');
    ctx.fillStyle = pattern;//c;
    ctx.fillRect(x, y, w, w);
  }
}

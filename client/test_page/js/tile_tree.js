
function load_tree(stream, callback, w, x, y) {
  // todo: Пробрасывать глубину узла от корня
  x = (x==undefined)?0:x;
  y = (y==undefined)?0:y;
  var node = stream();
  if (node == NC) {
    // todo: Добавить коллбэк on_node
    w /= 2;
    load_tree(stream, callback, w, x    , y    );
    load_tree(stream, callback, w, x + w, y);
    load_tree(stream, callback, w, x, y + w);
    load_tree(stream, callback, w, x + w, y + w);    
  }
  else {
    // todo: Переиеновать коллбэк в on_leaf
    callback(node, w, x, y);
  }
}

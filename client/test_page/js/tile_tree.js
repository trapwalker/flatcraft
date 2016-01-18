
function load_tree(stream, callback, ctx, w, x, y) {
  // todo: Пробрасывать глубину узла от корня
  x = (x===undefined)?0:x;
  y = (y===undefined)?0:y;
  w = (w===undefined)?256:w;  // todo: Вынести размер тайла в константы
  var node = stream();
  if (node == NC) {
    // todo: Добавить коллбэк on_node
    w /= 2;
    load_tree(stream, callback, ctx, w, x    , y    );
    load_tree(stream, callback, ctx, w, x + w, y);
    load_tree(stream, callback, ctx, w, x, y + w);
    load_tree(stream, callback, ctx, w, x + w, y + w);    
  }
  else {
    // todo: Переиеновать коллбэк в on_leaf
    callback(ctx, node, w, x, y);
  }
}


function TileCache(src) {
  src = (src===undefined)?{}:src;

  var obj = {tiles: src}

  obj.makeKey = (function(x, y) {
    return x + ':' + y;
  })

  obj.cleanFar = (function(radius, center) {  // Удаление тайлов, находящизся далле чем в radius от точки center
    // todo: realize
  })

  obj.onLoad = (function(x, y) {
    // todo: realize
    return {data: '.'}
  })

  obj.getCanvas = (function(x, y) {
    // todo: Проверить допустимые границы карты (>=0, <256)
    var key = obj.makeKey(x, y);
    var tile = this.tiles[key];
    if (tile === undefined) {
      tile = this.onLoad(x, y);
      this.tiles[key] = tile;
    }
    var canvas = tile.canvas;
    if (canvas === undefined) {
      canvas = document.createElement('canvas');  // todo: Вынести размер тайла в константы
      canvas.width = 256;
      canvas.height = 256;
      var ctx = canvas.getContext('2d');
      load_tree(tile.data, leafFunction, ctx);  // Перенести сюда leafFunction
    }
    return canvas;
    
  })

}
﻿function load_tree(stream, callback, ctx, w, x, y) {
  // todo: Пробрасывать глубину узла от корня
  x = (x===undefined)?0:x;
  y = (y===undefined)?0:y;
  w = (w===undefined)?CHUNK_SIZE:w;
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

function leafFunction(ctx, color, w, x, y) {
  c = COLOR_MAP[color];
  //print(color + ", [" + x + ", " + y + "], " + w + " - " + c);
  if (c === undefined) {
    print('Unknown color: "' + color + '"');
  } else if (c !== null) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, w);
  }
}

function TileCache(src) {
  src = (src===undefined)?{}:src;

  var obj = new Object();
  obj.tiles = src;

  obj.makeKey = (function(x, y) {
    return x + ':' + y;
  })

  obj.cleanFar = (function(radius, center) {  // Удаление тайлов, находящихся далле чем в radius от точки center
    // todo: realize
  })

  obj.onLoad = (function(x, y) {
    // todo: realize
    return {data: '...'}
  })

  obj.getCanvas = (function(x, y) {
    // todo: Проверить допустимые границы карты (>=0, <256?)
    var key = obj.makeKey(x, y);
    var tile = this.tiles[key];
    if (tile === undefined) {
      tile = this.onLoad(x, y);
      this.tiles[key] = tile;
    }
    
    var canvas = tile.canvas;    
    if (canvas === undefined) {
      var img = new Image(CHUNK_SIZE, CHUNK_SIZE);
      
      tile.canvas = document.createElement('canvas');  // todo: Вынести размер тайла в константы
      tile.canvas.width = CHUNK_SIZE;
      tile.canvas.height = CHUNK_SIZE;
      var ctx = tile.canvas.getContext("2d");      
      
      img.onload = function() {
          ctx.drawImage(img, 0, 0);
      }
      //img.src = 'http://icongal.com/gallery/image/177122/star.png';
      img.src = "images/xkcd/1n8w.png"
      
      //load_tree(tile.data, leafFunction, ctx);  // Перенести сюда leafFunction
    }
    return tile.canvas;
  })

  return obj;
}
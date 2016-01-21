
function load_tree(stream, callback, ctx, w, x, y) {
  // todo: Пробрасывать глубину узла от корня
  x = (x===undefined)?0:x;
  y = (y===undefined)?0:y;
  w = (w===undefined)?CHUNK_SIZE:w;
  var node = stream();
  if (node == NC && w > 1) {
    // todo: Добавить коллбэк on_node
    w /= 2;
    load_tree(stream, callback, ctx, w, x    , y    );
    load_tree(stream, callback, ctx, w, x + w, y    );
    load_tree(stream, callback, ctx, w, x,     y + w);
    load_tree(stream, callback, ctx, w, x + w, y + w);
  }
  else {
    // todo: Переиеновать коллбэк в on_leaf
    callback(ctx, node, w, x, y);
  }
}

function leafFunction(ctx, color, w, x, y) {
  c = COLOR_MAP[color];
  if (c === undefined) {
    console.warning('Unknown color: "' + color + '"');
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
    console.log('load x='+x+', '+y);
    return {data: '0'}
  })

  obj.getCanvas = (function(x, y) {
    // todo: Проверить допустимые границы карты (>=0, <256?)
    var key = obj.makeKey(x, 64 - y);
    var tile = this.tiles[key];
    if (tile === undefined) {
      tile = this.onLoad(x, y);
      this.tiles[key] = tile;
    }
    
    var canvas = tile.canvas;
    if (canvas === undefined) {
      //console.log('render xy=['+x + ', '+y+'] '+tile.data.length);
      canvas = document.createElement('canvas');  // todo: Вынести размер тайла в константы
      canvas.width = CHUNK_SIZE;
      canvas.height = CHUNK_SIZE;
      var ctx = canvas.getContext("2d");

      load_tree(Iter(tile.data), leafFunction, ctx);  // Перенести сюда leafFunction
      if (DEBUG) {
        ctx.font = "300px Arial";
        ctx.fillStyle = 'red';
        ctx.textAlign = "center";
        ctx.fillText("["+x+', '+y+"]", x + CHUNK_SIZE / 2, y + CHUNK_SIZE / 2);
    
        ctx.strokeStyle = 'red';
        ctx.rect(10, 10, CHUNK_SIZE - 20 - 1, CHUNK_SIZE - 20 - 1);
        ctx.rect(0, 0, CHUNK_SIZE, CHUNK_SIZE);
        ctx.stroke();
      }

      /*
      var img = new Image(CHUNK_SIZE, CHUNK_SIZE);
      img.onload = function() {
          ctx.drawImage(img, 0, 0);
      }

      img.src = "images/star.png";
      /**/

      tile.canvas = canvas
    }
    return canvas;
  })

  return obj;
}

/// Layer /////////////////////////////////////////////////////////////////////////////////////////
function Layer(options) {
  this.name = options.name;
  this.shift = options.shift || new Vector(0, 0);
  // todo: add draw_callback method to options
}

Layer.prototype.draw = function(map) {
}

/// SimpleLayer ///////////////////////////////////////////////////////////////////////////////////
function SimpleLayer(options) {
  Layer.apply(this, arguments);
  this.color = options.color;
}

SimpleLayer.prototype = Object.create(Layer.prototype);

TiledLayer.prototype.draw = function(map) {
  Layer.prototype.draw.apply(this, arguments);
  var w = map.canvas.width;  // todo: use property
  var h = map.canvas.height;
  map.ctx.fillStyle = this.color;
  map.ctx.fillRect(0, 0, w, h);
}

/// TiledLayer ////////////////////////////////////////////////////////////////////////////////////
function TiledLayer(options) {
  Layer.apply(this, arguments);
  this.tile_source = options.tile_source;
  this.tile_size = options.tile_size || this.tile_source.tile_size;
}

TiledLayer.prototype = Object.create(Layer.prototype);

TiledLayer.prototype.draw = function(map) {
  Layer.prototype.draw.apply(this, arguments);
  var tile_size = this.tile_size;
  var ctx = map.ctx;
  var c = map.c;  // todo: use "-this.shift"
  var w = map.canvas.width;  // todo: use property
  var h = map.canvas.height;
  var di = Math.ceil(h / tile_size / 2);
  var dj = Math.ceil(w / tile_size / 2);
  var ti = Math.floor(c.y / tile_size);
  var tj = Math.floor(c.x / tile_size);

  for   (var i = ti - di; i <= ti + di; i++) {
    for (var j = tj - dj; j <= tj + dj; j++) {
      var tile = map.cache.getCanvas(j, i);  // todo: use tile_source
      ctx.drawImage(
        tile,
        j * tile_size - c.x + w / 2,
        i * tile_size - c.y + h / 2
      );
    }
  }
}

// todo: метод прогрева прямоугольной зоны слоя
// todo: метод освобождения вне прямоугольной зоны слоя

/// Tile //////////////////////////////////////////////////////////////////////////////////////////
function Tile(x, y, z, kind) {
  this.x = x;
  this.y = y;
  this.z = z;
  this.kind = kind;
  this.state = null;

  this.src = null;
  this.value = null;
}

Tile.prototype.draw = function(map) {
  var ctx = map.ctx;
};

/// MapWidget /////////////////////////////////////////////////////////////////////////////////////
function MapWidget(container_id, options) {  // todo: setup layers
  this.layers = options.layers || [];  // todo: скопировать options.layers, привести его к стандартному списку

  this.container = document.getElementById(container_id);  // todo: throw error if not found
  this.canvas = document.createElement('canvas');
  this.ctx = this.canvas.getContext('2d');
  // todo: add properties: width, height
  this.c = V(0, 0);  // use property notation with getter and setter
  this.is_scrolling_now = false;
  this.cache = TileCache(TILES_AS_TREE);

  this.container.appendChild(this.canvas);
  window.onresize = this.onResize;  // todo: Попробовать повесить событие на ресайз контейнера а не окна. Убедиться, что не затёрли старый обработчик ресайза.
}

MapWidget.prototype.onRepaint = function() {
  var canvas = this.canvas;
  var ctx = this.ctx;
  var layers = this.layers;

  var w = canvas.width;  // todo: use property
  var h = canvas.height;

  for (var i = 0; i < layers.length; i++) {
    layers[i].draw(this);
  }

  if (DEBUG) {  // todo: extract to DebugLayer
    ctx.font = "20px Arial";
    ctx.fillStyle = 'red';
    ctx.textAlign = "right";
    ctx.fillText("pos=" + c, w - 20, 20);
  }

  window.requestAnimationFrame(repaint);
}

MapWidget.prototype.onResize = function() {
  this.canvas.height = this.container.clientHeight;
  this.canvas.width = this.container.clientWidth;
}

MapWidget.prototype.locate = function(x, y) {
  this.c = (y === undefined)? x : V(x, y);
  // todo: some recalculate?
};


///////////////////////////////////////////////////////////////////////////////////////////////////

//m = new MapWidget();
//m.locate(43.5 * 2048, 31.5 * 2048);

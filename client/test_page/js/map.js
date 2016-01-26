
/// Layer /////////////////////////////////////////////////////////////////////////////////////////
function Layer(options) {
  this.name = options && options.name;
  this.shift = options && options.shift || new Vector(0, 0);
  this.onDraw = options && options.onDraw;
  this.options = options;  // todo: разобраться как лучше интегрировать дополнительные опции
};

Layer.prototype.draw = function(map) {
  if (this.onDraw) {
    this.onDraw(map);
  };
};

/// TiledLayer ////////////////////////////////////////////////////////////////////////////////////
function TiledLayer(options) {
  Layer.apply(this, arguments);
  this.tile_source = options && options.tile_source;
  this.tile_size = options && options.tile_size || this.tile_source && this.tile_source.tile_size || 256;
  this.onTileDraw = options && options.onTileDraw;
};

TiledLayer.prototype = Object.create(Layer.prototype);

TiledLayer.prototype.draw = function(map) {
  Layer.prototype.draw.apply(this, arguments);
  var tile_size = this.tile_size;
  var c = map.c;  // todo: use "-this.shift"
  var w = map.canvas.width;  // todo: use property
  var h = map.canvas.height;
  var di = Math.ceil(h / tile_size / 2);
  var dj = Math.ceil(w / tile_size / 2);
  var ti = Math.floor(c.y / tile_size);
  var tj = Math.floor(c.x / tile_size);

  for   (var i = ti - di; i <= ti + di; i++) {
    for (var j = tj - dj; j <= tj + dj; j++) {
      this.tileDraw(
        map, 
        j, i,
        j * tile_size - c.x + w / 2,
        i * tile_size - c.y + h / 2
      );
    };
  };
};

TiledLayer.prototype.tileDraw = function(map, ix, iy, x, y) {
  var tile = map.cache.getCanvas(ix, iy);  // todo: use tile_source
  map.ctx.drawImage(tile, x, y);
  if (this.onTileDraw) {
    this.onTileDraw(map, ix, iy, x, y);
  };
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
};

Tile.prototype.draw = function(map) {
  var ctx = map.ctx;
};

/// MapWidget /////////////////////////////////////////////////////////////////////////////////////
function MapWidget(container_id, options) {  // todo: setup layers
  var self = this;
  this.layers = options && options.layers || [];  // todo: скопировать options.layers, привести его к стандартному списку

  this.container = document.getElementById(container_id);  // todo: throw error if not found
  this.canvas = document.createElement('canvas');
  this.ctx = this.canvas.getContext('2d');
  // todo: add properties: width, height
  this.c = options && options.location || V(0, 0);  // use property notation with getter and setter
  this.is_scrolling_now = false;
  this.cache = TileCache(TILES_AS_TREE);

  this.onResize_callback = (function() {self.onResize();});  // todo: узнать и сделать правильным способом
  this.onRepaint_callback = (function() {self.onRepaint();});  // todo: узнать и сделать правильным способом

  this.container.appendChild(this.canvas);

  window.onresize = this.onResize_callback;
  // todo: Попробовать повесить событие на ресайз контейнера а не окна. Убедиться, что не затёрли старый обработчик ресайза.

  this.onResize();
  this.onRepaint();
};

MapWidget.prototype.onResize = function() {
  this.canvas.height = this.container.clientHeight;
  this.canvas.width = this.container.clientWidth;
};

MapWidget.prototype.onRepaint = function() {
  var canvas = this.canvas;
  var ctx = this.ctx;
  var layers = this.layers;

  var w = canvas.width;  // todo: use property
  var h = canvas.height;

  for (var i = 0; i < layers.length; i++) {
    layers[i].draw(this);
  };

  if (DEBUG) {  // todo: extract to DebugLayer
    ctx.font = "20px Arial";
    ctx.fillStyle = 'red';
    ctx.textAlign = "right";
    ctx.fillText("pos=" + this.c , w - 20, 20);
  };

  window.requestAnimationFrame(this.onRepaint_callback);
};

MapWidget.prototype.locate = function(x, y) {
  this.c = (y === undefined)? x : V(x, y);
  // todo: some recalculate?
};


///////////////////////////////////////////////////////////////////////////////////////////////////

//m = new MapWidget();
//m.locate(43.5 * 2048, 31.5 * 2048);

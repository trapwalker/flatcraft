
/// TileSource ////////////////////////////////////////////////////////////////////////////////////
function TileSource(options) {
  this.name = options && options.name;
  this.onGet = options && options.onGet;
  this.tile_size = options.tile_size;
  this.options = options;
};

TileSource.prototype.get = function(x, y, z) {
  if (this.onGet) {
    return this.onGet(x, y, z);
  };
};

/// TSCache ///////////////////////////////////////////////////////////////////////////////////////
function TSCache(options) {
  TileSource.apply(this, arguments);
  this.storage = {};
};

TSCache.prototype = Object.create(TileSource.prototype);

TSCache.prototype.get = function(x, y, z) {
  var key = x + ':' + y + ':' + z;
  var tile = this.storage[key];
  if (tile !== undefined) return tile;

  tile = TileSource.prototype.get.apply(this, arguments);
  if (tile !== undefined)
    this.storage[key] = tile;

  return tile;
};

/// Layer /////////////////////////////////////////////////////////////////////////////////////////
function Layer(options) {
  this.name = options && options.name;
  this.shift = options && options.shift || new Vector(0, 0);
  this.onDraw = options && options.onDraw;
  this.visible = options && ((options.visible === undefined)?true:options.visible);
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
  this.tile_size = options && options.tile_size || this.tile_source && this.tile_source.tile_size;
  this.onTileDraw = options && options.onTileDraw;  // function(ix, iy, x, y, tile)
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
  var tile;
  if (this.tile_source)
    tile = this.tile_source.get(ix, iy);  // todo: z

  if (tile && tile.image)
    map.ctx.drawImage(tile.image, x, y);

  if (this.onTileDraw)
    this.onTileDraw(map, ix, iy, x, y, tile);
};

// todo: метод прогрева прямоугольной зоны слоя
// todo: метод освобождения вне прямоугольной зоны слоя

/// Tile //////////////////////////////////////////////////////////////////////////////////////////
function Tile(x, y, z, options) {
  this.x = x;
  this.y = y;
  this.z = z;
  this.kind = options && options.kind;
  this.state = options && options.state;

  this.data = options && options.data;
  this.image = options && options.image;
  this.options = options;
};

/// MapWidget /////////////////////////////////////////////////////////////////////////////////////
function MapWidget(container_id, options) {  // todo: setup layers
  this.fps_stat = new AvgRing(100);
  var self = this;
  this.layers = options && options.layers || [];  // todo: скопировать options.layers, привести его к стандартному списку

  this.container = document.getElementById(container_id);  // todo: throw error if not found
  this.canvas = document.createElement('canvas');
  this.ctx = this.canvas.getContext('2d');
  // todo: add properties: width, height
  this.c = options && options.location || V(0, 0);  // use property notation with getter and setter
  this.is_scrolling_now = false;

  this.onResize_callback = (function() {self.onResize();});  // todo: узнать и сделать правильным способом
  this.onRepaint_callback = (function() {self.onRepaint();});  // todo: узнать и сделать правильным способом

  this.container.appendChild(this.canvas);

  this._movement_flag = 0;  // todo: rename
  this._scroll_velocity = new Vector(0, 0);

  this.inertial = options && options.inertial || false;

  this._dx = 0;
  this._dy = 0;

  // todo: settings:
  // scrollable
  // inertion_value
  // zoom_factor_min
  // zoom_factor_max

  var old_x;
  var old_y;
  var t;

  this.canvas.addEventListener('mousedown', function(e) {
    self._movement_flag = 1;
    //self._scroll_velocity.set(0, 0);
    old_x = e.pageX;
    old_y = e.pageY;
  });

  this.canvas.addEventListener('mousemove', function(e) {
    if (self._movement_flag) {
      self._dx = old_x - e.pageX;
      self._dy = old_y - e.pageY;

      //self._scroll_velocity.set(dx, dy);

      //self.scroll(dx, dy);
      old_x = e.pageX;
      old_y = e.pageY;
    }
  });

  this.canvas.addEventListener('mouseup', function() {
    self._movement_flag = 0;
  });

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
  var t1 = new Date().getTime() / 1000;
  var dt = t1?(t1 - this.t):null;
  var fps = Math.round(1 / dt);
  this.fps_stat.add(fps);
  this.t = t1;
  var canvas = this.canvas;
  var ctx = this.ctx;
  var layers = this.layers;

  var w = canvas.width;  // todo: use property
  var h = canvas.height;

  //console.log(this._mt + ' / ' + this._pt);
  this.scroll(this._dx, this._dy);

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.visible)
      layers[i].draw(this);
  };

  var v;
  if (this.inertial /*&& !this._movement_flag*/) {
    v = this._scroll_velocity.clone();
    if (v.length2())
      this.c.add(v);
    this._scroll_velocity.div(1.03);  // todo: extract inertial factor to options
    if (this._scroll_velocity.length2() < 2)
      this._scroll_velocity.set(0, 0);
  };

  if (DEBUG) {  // todo: extract to DebugLayer
    ctx.font = "20px Arial";
    ctx.fillStyle = 'red';
    ctx.textAlign = "left";
    ctx.fillText("pos=" + this.c, w - 300, 20);
    ctx.fillText(
      "fps=" + Math.round(this.fps_stat.avg())
      + " ["  + Math.round(this.fps_stat.minimum)
      + ".."    + Math.round(this.fps_stat.maximum)
      + "]", w - 300, 40);
    ctx.fillText(
      "v=" + v
      , w - 300, 60);
  };

  window.requestAnimationFrame(this.onRepaint_callback);
};

MapWidget.prototype.locate = function(x, y) {
  this.c = (y === undefined)? x : V(x, y);
  // todo: some recalculate?
};

MapWidget.prototype.scroll = function(dx, dy) {  
  this.locate(this.c.x + dx, this.c.y + dy);
};

///////////////////////////////////////////////////////////////////////////////////////////////////

//m = new MapWidget();
//m.locate(43.5 * 2048, 31.5 * 2048);

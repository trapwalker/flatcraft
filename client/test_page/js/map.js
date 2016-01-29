
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
  this.z_max = options && options.z_max;
};

TiledLayer.prototype = Object.create(Layer.prototype);

TiledLayer.prototype.draw = function(map) {
  Layer.prototype.draw.apply(this, arguments);
  var level_zr = map.get_zoom_factor_step();
  var z = this.z_max + level_zr.z;  // todo: check -1
  var r = level_zr.r;
  var tile_size = this.tile_size * r;
  var c = map.c.clone().mul(map.zoom_factor);  // todo: use "-this.shift"
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
        j, i, z,
        j * tile_size - c.x + w / 2,
        i * tile_size - c.y + h / 2,
        tile_size
      );
    };
  };
};

TiledLayer.prototype.tileDraw = function(map, ix, iy, iz, x, y, tsize) {
  var tile;
  if (this.tile_source)
    tile = this.tile_source.get(ix, iy, iz);

  if (tile && tile.image) {
    map.ctx.drawImage(tile.image, 0, 0, this.tile_size, this.tile_size, x, y, tsize, tsize);
  };

  if (this.onTileDraw)
    this.onTileDraw(map, ix, iy, iz, x, y, tsize, tile);
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
  this.preparing_image = options && options.preparing_image;
  this.image = options && options.image;
  this.options = options;
};

Tile.prototype.makeReadyCallback = function(onReady) {
  var self = this;
  return function() {
    self.state = 'ready';
    if (self.preparing_image)
      self.image = self.preparing_image;
    if (onReady)
      onReady(self);
  };
};

/// MapWidget /////////////////////////////////////////////////////////////////////////////////////
function MapWidget(container_id, options) {  // todo: setup layers
  this.fps_stat = new AvgRing(100);
  var self = this;
  this.layers = options && options.layers || [];  // todo: скопировать options.layers, привести его к стандартному списку
  this.zoom_animation_factor = options && options.zoom_animation_factor || 10;  // 1~100
  this.zoom_step_factor = options && options.zoom_step_factor || 0.2;  // 0.1~0.9

  this.container = document.getElementById(container_id);  // todo: throw error if not found
  this.canvas = document.createElement('canvas');
  this.ctx = this.canvas.getContext('2d');
  this.canvas2 = document.createElement('canvas');
  this.ctx2 = this.canvas.getContext('2d');
  // todo: add properties: width, height
  this.c = options && options.location || V(0, 0);  // use property notation with getter and setter
  this.is_scrolling_now = false;
  this.zoom_min = 1 / Math.pow(2, 18-10);  // todo: вычислять на основе слоёв или вынести в настройки...?
  this.zoom_max = 1;
  this.zoom_factor = 1;
  this.zoom_step = (this.zoom_max - this.zoom_min) / 64;
  this.zoom_target = this.zoom_factor;

  this.onResize_callback = (function() {self.onResize();});  // todo: узнать и сделать правильным способом
  this.onRepaint_callback = (function() {self.onRepaint();});  // todo: узнать и сделать правильным способом

  this.container.appendChild(this.canvas);
  
  this._movement_flag = 0;  // todo: rename
  this._scroll_velocity = new Vector(0, 0);

  this.scrollType = options && options.scrollType || 'simple';

  this._dx = 0;  // todo: rename
  this._dy = 0;

  // todo: settings:
  // scrollable
  // inertion_value
  // zoom_factor_min
  // zoom_factor_max

  var old_x;
  var old_y;
  var t;

  this.canvas.addEventListener('wheel', function(e) {
    var dy = e.deltaY;

    if (dy > 0) {
      self.zoom_target = self.zoom_target * (1 + self.zoom_step_factor);
      if (self.zoom_target > self.zoom_max)
        self.zoom_target = self.zoom_max;
    } else if (dy < 0) {
      self.zoom_target = self.zoom_target * (1 - self.zoom_step_factor);
      if (self.zoom_target < self.zoom_min)
        self.zoom_target = self.zoom_min;
    };

    e.preventDefault();
  });

  this.canvas.addEventListener('mousedown', function(e) {
    self._movement_flag = 1;
    old_x = e.pageX;
    old_y = e.pageY;
  });

  this.canvas.addEventListener('mousemove', function(e) {
    if (self._movement_flag) {
      self._dx += old_x - e.pageX;
      self._dy += old_y - e.pageY;
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

MapWidget.prototype.get_zoom_factor_step = function() {
  var zf = this.zoom_factor;
  var p = Math.log2(zf);
  var z = Math.ceil(p);
  var r = zf / Math.pow(2, z);
  return {z: z, r: r};
};

MapWidget.prototype.onResize = function() {
  this.canvas.height = this.container.clientHeight;
  this.canvas.width = this.container.clientWidth;
  this.canvas2.height = this.container.clientHeight * 2;
  this.canvas2.width = this.container.clientWidth * 2;
};

MapWidget.prototype.onRepaint = function() {
  var t1 = new Date().getTime() / 1000;
  var dt = t1?(t1 - this.t):null;
  var fps = Math.round(1 / dt);
  this.fps_stat.add(fps);
  this.t = t1;

  var canvas = this.canvas;
  var canvas2 = this.canvas2;
  var ctx = this.ctx;
  var ctx2 = this.ctx2;
  var layers = this.layers;

  var w = canvas.width;  // todo: use property
  var h = canvas.height;
  
  var d_zoom = (this.zoom_target - this.zoom_factor) / this.zoom_animation_factor;
  this.zoom_factor += d_zoom;
  if (Math.abs(this.zoom_target - this.zoom_factor) < Math.pow(2, -18)) {  // todo: calc cutting edge by current zoom
    //console.log('Zoom animation cut: ' + [this.zoom_factor, this.zoom_target]);
    this.zoom_factor = this.zoom_target;
  }

  //Простой скроллинг
  if(this.scrollType == 'simple') {
    this.scroll(this._dx, this._dy);
  }
  //Скроллинг с инерцией
  if(this.scrollType == 'inertial') {
    this.scroll(this._dx, this._dy);
    var v;
    if (this._movement_flag) {
      this._scroll_velocity.set(this._dx, this._dy);
    }
    else {
      v = this._scroll_velocity.clone();
      if (v.length2())
        this.c.add(v);
      this._scroll_velocity.div(1.05);  // todo: extract inertial factor to options
      if (this._scroll_velocity.length2() < 0.1)
        this._scroll_velocity.set(0, 0);
    };
  };
  //Скроллинг с инерцией и скольжением
  if(this.scrollType == 'sliding') {
    this.scroll(this._dx, this._dy);
    var v;
    if (this._movement_flag) {
      this._scroll_velocity.add(this._dx*0.33, this._dy*0.33); // todo: extract sliding factor to options
    };
    v = this._scroll_velocity.clone();
    if (v.length2())
      this.c.add(v);
    this._scroll_velocity.div(1.05);  // todo: extract inertial factor to options
    if (this._scroll_velocity.length2() < 0.1)
      this._scroll_velocity.set(0, 0);
  };

  this._dx = 0;
  this._dy = 0;

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.visible)
      layers[i].draw(this);
  };

  window.requestAnimationFrame(this.onRepaint_callback);
};

MapWidget.prototype.locate = function(x, y) {
  this.c = (y === undefined)? x : V(x, y);
  // todo: some recalculate?
};

MapWidget.prototype.scroll = function(dx, dy) {  
  this.locate(this.c.x + dx / this.zoom_factor, this.c.y + dy / this.zoom_factor);
};

///////////////////////////////////////////////////////////////////////////////////////////////////

//m = new MapWidget();
//m.locate(43.5 * 2048, 31.5 * 2048);

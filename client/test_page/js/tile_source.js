
/// TileSource ////////////////////////////////////////////////////////////////////////////////////
function TileSource(options) {
  this.name = options && options.name;
  this.onGet = options && options.onGet;
  this.tile_size = options.tile_size;
  this.options = options;
}

TileSource.prototype.get = function(x, y, z) {
  if (this.onGet) {
    return this.onGet(x, y, z);
  }
};

/// TSCache ///////////////////////////////////////////////////////////////////////////////////////
function TSCache(options) {
  TileSource.apply(this, arguments);
  var self = this;
  this.cache_size = 0;
  this.storage = {};
  this.load_queue = [];
  this._last_heating_state = null;

  this.onBackgroundHeat = function() {
    if (self.load_queue.length) {
      var tile = self.load_queue.pop();
      self.get(tile.x, tile.y, tile.z);
    }
    setTimeout(self.onBackgroundHeat, 10);  // todo: extract to constant or settings
  };
  this.onBackgroundHeat();  // todo: add property 'backgroundHeatingEnable'
}

TSCache.prototype = Object.create(TileSource.prototype);

TSCache.prototype.heat = function(x, y, z, r1, r2, zup, zdn) {
  var self = this;
  r1 = r1 === undefined?(2048 / 256 / 2):r1;
  r2 = r2 === undefined?(r1 * 2):r2;
  zup = zup === undefined?1:zup;
  zdn = zdn === undefined?1:zup;
  var heating_state = [x, y, z, r1, r2, zup, zdn].toString();
  if (this._last_heating_state == heating_state)
    return;

  this._last_heating_state = heating_state;

  function callback(ix, iy, iz) {
    self.load_queue.push({x: x + ix, y: y + iy, z: z + iz})
  }

  this.load_queue = [];  // todo: check garbage collector rules

  heat(callback, x, y, z, r1, r2, zup);  // todo: use znd/zup
  // todo: autorun backround heating
};

TSCache.prototype.get = function(x, y, z) {
  var key = x + ':' + y + ':' + z;
  var tile = this.storage[key];
  if (tile !== undefined) return tile;

  tile = TileSource.prototype.get.apply(this, arguments);
  if (tile !== undefined) {
    this.storage[key] = tile;
    this.cache_size += 1;
  };
  return tile;
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
}

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

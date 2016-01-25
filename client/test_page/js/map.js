

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
  ctx = map.ctx;

  
};

/// <apWidget /////////////////////////////////////////////////////////////////////////////////////
function MapWidget(container_id, tile_size) {
  this.tile_size = tile_size || 256;

  this.container = document.getElementById(container_id);  // todo: throw error if not found
  this.canvas = document.createElement('canvas');
  this.ctx = this.canvas.getContext('2d');

  this.container.appendChild(this.canvas);

  this.c = V(0, 0);
  this.is_scrolling_now = false;

  this.cache = TileCache(TILES_AS_TREE);

    

}

MapWidget.prototype.locate = function(x, y) {
  this.c = (y === undefined)? x : V(x, y);

};


///////////////////////////////////////////////////////////////////////////////////////////////////

m = new MapWidget();
m.locate(43.5 * this.tile_size, 31.5 * this.tile_size);

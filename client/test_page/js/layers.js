// Layers =========================================================================

function makeTileGetter(uriBuilder) {
  return function(x, y, z) {
    var path = uriBuilder(x, y, z);
    var img = new Image();
    var tile = new Tile(x, y, z, {state: 'prepare', preparing_image: img});
    img.onload = tile.makeReadyCallback();
    img.src = path;
    return tile;
  };
};

//mapTileSource = new TSCache({
//  tile_size: 256, 
//  onGet: makeTileGetter(function(x, y, z) {return 'http://roaddogs.ru/map/merged/' + z + '/' + x + '/' + y + '.jpg';})
//});

var TILE_EXT = '.png';

tsMerged = new TSCache({
  tile_size: 256, 
  onGet: makeTileGetter(function(x, y, z) {return 'http://roaddogs.ru/map/merged/' + z + '/' + x + '/' + y + TILE_EXT;})
});

tsBack = new TSCache({
  tile_size: 256, 
  onGet: makeTileGetter(function(x, y, z) {return 'http://roaddogs.ru/map/back/' + z + '/' + x + '/' + y + TILE_EXT;})
});

tsFront = new TSCache({
  tile_size: 256, 
  onGet: makeTileGetter(function(x, y, z) {return 'http://roaddogs.ru/map/front/' + z + '/' + x + '/' + y + TILE_EXT;})
});



function drawTileDebug(map, ix, iy, iz, x, y, tsize, tile) {
  var ctx = map.ctx;
  ctx.font = Math.round(tsize / 10) + "px Arial";  // todo: font size calculate
  ctx.fillStyle = this.options.textColor || this.options.color;
  ctx.textAlign = "center";
  ctx.fillText("["+ix+', '+iy+"]/"+iz, x + tsize / 2, y + tsize / 2);
  //ctx.fillText(""+Math.round(tsize), x + tsize / 2, y + tsize / 2 + 40);
  
  ctx.beginPath();
  ctx.strokeStyle = this.options.frameColor || this.options.color;
  ctx.rect(x + 10, y + 10, tsize - 20 - 1, tsize - 20 - 1);
  ctx.rect(x, y, tsize, tsize);/**/
  ctx.stroke();
};

function drawDebugInfo(map) {
  var ctx = map.ctx;
  var w = map.canvas.width;
  var h = map.canvas.height;
  var pos = new Vector(Math.round(map.c.x), Math.round(map.c.y));
  ctx.font = "20px Arial";
  ctx.fillStyle = this.options.color;
  ctx.textAlign = "left";

  ctx.fillText("pos=" + pos, w - 300, h - 20);
  var fps_range = map.fps_stat.frame_range();

  ctx.fillText(
    "fps=" + Math.round(map.fps_stat.avg())
    + " [" + Math.round(fps_range[0])
    + ".." + Math.round(fps_range[1])
    + "] " + (tsMerged.cache_size + tsBack.cache_size + tsFront.cache_size),
    w - 300, h - 40);


  var dt_range = map.dt_stat.frame_range();
  ctx.fillText(
    "dt=" + Math.round(map.dt_stat.avg() * 1000)
    + " [" + Math.round(dt_range[0] * 1000)
    + ".." + Math.round(dt_range[1] * 1000)
    + "] ",
    w - 300, h - 60);

};


var LAYERS = {
  background: new Layer({
    name: 'Background',
    color: BASE_COLOR,
    onDraw: function(map) {
      map.ctx.fillStyle = this.options.color;
      map.ctx.fillRect(0, 0, map.canvas.width, map.canvas.height);  // todo: use width and height properties
    }
  }),

  xkcd_tiles: new TiledLayer({
    name: 'XKCD tiles',
    tile_source: new TSCache({
      tile_size: 2048,
      onGet: function(x, y, z) {
        var key = x + ':' + (64 - y);
        var data = TILES_AS_TREE[key];
        if (data === undefined) return null;

        var canvas = document.createElement('canvas');
        canvas.width = this.tile_size;
        canvas.height = this.tile_size;
        var ctx = canvas.getContext("2d");
        console.log('build tile: ' + [x, y, z] + ' data: ' + data.length);
        self.load_tree(Iter(data), leafFunction, ctx, 2048);  // Перенести сюда leafFunction
        return new Tile(x, y, z, {image: canvas});
      }
    }),
    visible: false,
    z_max: 11  // todo: rename to z_deep
  }),

  xkcd_debug: new TiledLayer({
    name: 'XKCD tiles debug',
    tile_size: 2048,
    color: 'rgba(255, 0, 0, 0.5)',
    onTileDraw: drawTileDebug,
    visible: false,
    z_max: 11  // todo: rename to z_deep
  }),

  map_tiles_back: new TiledLayer({
    name: 'Map tiles back',
    tile_source: tsBack,
    visible: false,
    z_max: 18  // todo: rename to z_deep
  }),

  map_tiles_front: new TiledLayer({
    name: 'Map tiles front',
    tile_source: tsFront,
    visible: false,
    z_max: 18  // todo: rename to z_deep
  }),

  map_tiles: new TiledLayer({
    name: 'Map tiles (mixed)',
    tile_source: tsMerged,
    visible: true,
    z_max: 18  // todo: rename to z_deep
  }),

  map_debug: new TiledLayer({
    name: 'Map tiles debug',
    tile_size: 256,
    color: 'rgba(150, 150, 255, 0.5)',
    onTileDraw: drawTileDebug,
    visible: false,
    z_max: 18  // todo: rename to z_deep
  }),

  map_grid: new TiledLayer({
    name: 'Map grid',
    tile_size: 256,
    color: 'rgba(60, 110, 60, 0.4)',
    visible: true,
    z_max: 18,  // todo: rename to z_deep
    onTileDraw: function(map, ix, iy, iz, x, y, tsize, tile) {
      var k = (tsize - 128) / 128;
      //k *= k;
	  var color = this.options.color;

	  var ctx = map.ctx;

	  ctx.save();
	  ctx.globalAlpha = k;
 	  ctx.beginPath();
	  ctx.strokeStyle = color;
	  ctx.rect(x        , y        , tsize/2, tsize/2);/**/
	  ctx.rect(x+tsize/2, y        , tsize / 2, tsize / 2);/**/
	  ctx.rect(x, y+tsize/2        , tsize / 2, tsize / 2);/**/
	  ctx.rect(x+tsize/2, y+tsize/2, tsize / 2, tsize / 2);/**/
	  ctx.stroke();
	  ctx.restore();

	  
	  ctx.beginPath();
	  ctx.strokeStyle = color;
	  ctx.rect(x, y, tsize, tsize);/**/
	  ctx.stroke();
	},
  }),

  debug: new Layer({
    name: 'Debug data',
    color: 'red',
    onDraw: drawDebugInfo,
    visible: DEBUG
  })
};

var ALL_LAYERS = [
  LAYERS.background,
  LAYERS.map_tiles_back,
  LAYERS.map_tiles_front,
  LAYERS.map_tiles,
  LAYERS.map_debug,
  LAYERS.map_grid,
  LAYERS.xkcd_tiles,
  LAYERS.xkcd_debug,
  LAYERS.debug
];

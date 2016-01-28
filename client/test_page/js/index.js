var map;
(function() {
  //var map;

  function init() {
    map = new MapWidget('workfield', {
      inertial: INIT_STATE.inertial,
      //location: new Vector(43.5 * 2048, 31.5 * 2048), //(48875*256, 106133*256)
      layers: [
        new Layer({
          name: 'Background',
          color: BASE_COLOR,
          onDraw: function(map) {
            map.ctx.fillStyle = this.options.color;
            map.ctx.fillRect(0, 0, map.canvas.width, map.canvas.height);  // todo: use width and height properties
          },
          visible: INIT_STATE.bgLayer,
        }),

        new TiledLayer({
          name: 'Map tiles',
          tile_source: new TSCache({tile_size: 256, onGet: getMapTile}),
          visible: INIT_STATE.mapLayer,
        }),
        new TiledLayer({
          name: 'Map tiles debug',
          tile_size: 256,
          color: 'rgba(150, 150, 255, 0.5)',
          onTileDraw: drawTileDebug,
          visible: INIT_STATE.mapDebugLayer,
        }),

        new TiledLayer({
          name: 'XKCD tiles',
          tile_source: new TSCache({tile_size: 2048, onGet: makeTile}),
          visible: INIT_STATE.XKCDLayer,
        }),
        new TiledLayer({
          name: 'XKCD tiles debug',
          tile_size: 2048,
          color: 'rgba(255, 0, 0, 0.5)',
          onTileDraw: drawTileDebug,
          visible: INIT_STATE.XKCDDebugLayer,
        }),

        new Layer({
          name: 'Debug data',
          color: 'red',
          onDraw: drawDebugInfo,
          visible: DEBUG,
        }),
      ]
    });

    function getMapTile(x, y, z) {
      z = 18;
      var path = 'http://sublayers.net/map/' + z + '/' + x + '/' + y + '.jpg'; //'images\\map\\' + z + '\\' + x + '\\' + y + '.jpg';
      var img = new Image();
      var tile = new Tile(x, y, z, {state: 'prepare', preparing_image: img});
      img.onload = tile.makeReadyCallback();
      img.src = path;
      return tile;
    };

    function makeTile(x, y, z) {
      var key = x + ':' + (64 - y);
      var data = TILES_AS_TREE[key];
      if (data === undefined) return null;

      var canvas = document.createElement('canvas');
      canvas.width = this.tile_size;
      canvas.height = this.tile_size;
      var ctx = canvas.getContext("2d");
      console.log('build tile: ' + [x, y, z] + ' data: ' + data.length);
      load_tree(Iter(data), leafFunction, ctx);  // Перенести сюда leafFunction
      return new Tile(x, y, z, {image: canvas});
    };

    function drawTileDebug(map, ix, iy, x, y, tile) {
      var ctx = map.ctx;
      var tile_size = this.tile_size
      ctx.font = Math.round(tile_size / 8) + "px Arial";  // todo: font size calculate
      ctx.fillStyle = this.options.textColor || this.options.color;
      ctx.textAlign = "center";
      ctx.fillText("["+ix+', '+iy+"]", x + tile_size / 2, y + tile_size / 2);
      
      ctx.beginPath();
      ctx.strokeStyle = this.options.frameColor || this.options.color;
      ctx.rect(x + 10, y + 10, tile_size - 20 - 1, tile_size - 20 - 1);
      ctx.rect(x, y, tile_size, tile_size);/**/
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
      ctx.fillText(
        "fps=" + Math.round(map.fps_stat.avg())
        + " [" + Math.round(map.fps_stat.minimum)
        + ".." + Math.round(map.fps_stat.maximum)
        + "]", w - 300, h - 40);
    };
    

    // GUI

    var locations = {
      goToShip: function() {map.locate(43.5 * 2048, 31.5 * 2048);},
      goToMap: function() {map.locate(48875*256, 106133*256);},
    };

    gui = new dat.GUI();
    gui.add(map, 'zoom_factor', 1/8, 1).step((1 - 1/8) / 64).name('Zoom').listen();
    gui.add(map, 'inertial').name('Inertial Scroll');

    var gui_layers = gui.addFolder('Layers');
    gui_layers.closed = false;
    for (var i = 0; i < map.layers.length; i++) {
      gui_layers.add(map.layers[i], 'visible').name(map.layers[i].name);
    };

    var gui_locations = gui.addFolder('Locations');
    gui_locations.closed = false;
    gui_locations.add(locations, 'goToShip').name('Ship');
    gui_locations.add(locations, 'goToMap').name('Map');
    
    gui.close();

    locations[INIT_STATE.location].call();
  };
  init();
})();
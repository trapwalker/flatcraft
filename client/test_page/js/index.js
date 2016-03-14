var map;
(function() {

  function init() {
    mapTileSource = new TSCache({tile_size: 256, onGet: getMapTile});

    map = new MapWidget('workfield', {
      scrollType: 'sliding',
      location: 'goToMap',
      onLocate: function(x, y) {
        //console.log('onLocate: '+[x, y]);
        //mapTileSource.heat(x, y, );
      },
      layers: [
        new Layer({
          name: 'Background',
          color: BASE_COLOR,
          onDraw: function(map) {
            map.ctx.fillStyle = this.options.color;
            map.ctx.fillRect(0, 0, map.canvas.width, map.canvas.height);  // todo: use width and height properties
          }
        }),

        new TiledLayer({
          name: 'Map tiles',
          tile_source: mapTileSource,
          visible: true,
          z_max: 18  // todo: rename to z_deep
        }),
        new TiledLayer({
          name: 'Map tiles debug',
          tile_size: 256,
          color: 'rgba(150, 150, 255, 0.5)',
          onTileDraw: drawTileDebug,
          visible: false,
          z_max: 18  // todo: rename to z_deep
        }),

        new TiledLayer({
          name: 'XKCD tiles',
          tile_source: new TSCache({tile_size: 2048, onGet: makeTile}),
          visible: false,
          z_max: 11  // todo: rename to z_deep
        }),
        new TiledLayer({
          name: 'XKCD tiles debug',
          tile_size: 2048,
          color: 'rgba(255, 0, 0, 0.5)',
          onTileDraw: drawTileDebug,
          visible: false,
          z_max: 11  // todo: rename to z_deep
        }),

        new Layer({
          name: 'Debug data',
          color: 'red',
          onDraw: drawDebugInfo,
          visible: DEBUG
        })
      ]
    });

    function getMapTile(x, y, z) {
      var path = 'http://185.58.206.115/map/' + z + '/' + x + '/' + y + '.jpg'; //'images\\map\\' + z + '\\' + x + '\\' + y + '.jpg';
      var img = new Image();
      var tile = new Tile(x, y, z, {state: 'prepare', preparing_image: img});
      img.onload = tile.makeReadyCallback();
      img.src = path;
      return tile;
    }

    function makeTile(x, y, z) {
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

    function drawTileDebug(map, ix, iy, iz, x, y, tsize, tile) {
      var ctx = map.ctx;
      ctx.font = Math.round(tsize / 10) + "px Arial";  // todo: font size calculate
      ctx.fillStyle = this.options.textColor || this.options.color;
      ctx.textAlign = "center";
      ctx.fillText("["+ix+', '+iy+"]/"+iz, x + tsize / 2, y + tsize / 2);
      
      ctx.beginPath();
      ctx.strokeStyle = this.options.frameColor || this.options.color;
      ctx.rect(x + 10, y + 10, tsize - 20 - 1, tsize - 20 - 1);
      ctx.rect(x, y, tsize, tsize);/**/
      ctx.stroke();
    }

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
    }
    

    // GUI

    var locations = {
      goToShip: function() {map.locate(43.5 * 2048, 31.5 * 2048);},
      goToMap: function() {map.locate(48875*256, 106133*256);},
      default: function() {map.locate(0, 0);},
    };

    gui = new dat.GUI();
    gui.add(map, 'zoom_target', map.zoom_min, map.zoom_max).step((map.zoom_max - map.zoom_min) / 64).name('Zoom').listen();
    gui.add(map, 'zoom_animation_factor', 1, 100).step(1).name('Zoom Duration').listen();
    gui.add(map, 'zoom_step_factor', 0.1, 0.9).step(0.05).name('Zoom Step Factor').listen();

    var gui_scroll = gui.addFolder('Scroll');
    gui_scroll.add(map, 'scrollType', [ 'simple', 'inertial', 'sliding']).name('Type of Scroll').listen();
    gui_scroll.add(map, 'inertion_value', 0, 0.2).step(0.001).name('Inertion Reduction').listen();
    gui_scroll.add(map, 'sliding_value', 0, 1).step(0.01).name('Sliding Value').listen();

    var gui_layers = gui.addFolder('Layers');
    gui_layers.closed = false;
    for (var i = 0; i < map.layers.length; i++) {
      gui_layers.add(map.layers[i], 'visible').name(map.layers[i].name);
    }

    var gui_locations = gui.addFolder('Locations');
    gui_locations.closed = false;
    gui_locations.add(locations, 'goToShip').name('Ship');
    gui_locations.add(locations, 'goToMap').name('Map');
    
    gui.close();

    locations[map.location].call();
  }
  init();
})();
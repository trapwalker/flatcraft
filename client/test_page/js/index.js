var map;
(function() {
  //var map;

  function init() {
    map = new MapWidget('workfield', {
      inertial: true,
      location: new Vector(43.5 * 2048, 31.5 * 2048),
      layers: [
        new Layer({
          name: 'Background',
          color: 'rgb(200, 255, 200)',
          onDraw: function(map) {
            map.ctx.fillStyle = this.options.color;
            map.ctx.fillRect(0, 0, map.canvas.width, map.canvas.height);  // todo: use width and height properties
          },
        }),
        new TiledLayer({
          name: 'Main tiles',
          tile_source: new TSCache({tile_size: 2048, onGet: makeTile }),
        }),
        new TiledLayer({
          name: 'Debug tiles data',
          tile_size: 2048,
          color: 'rgba(255, 0, 0, 0.5)',
          onTileDraw: drawTileDebug,
          visible: DEBUG,
        }),
        new Layer({
          name: 'Debug data',
          color: 'red',
          onDraw: drawDebugInfo,
          visible: DEBUG,
        }),
      ]
    });

    function makeTile(x, y, z) {
      var key = x + ':' + (64 - y);
      var data = TILES_AS_TREE[key];
      if (data === undefined) return null;

      var canvas = document.createElement('canvas');  // todo: Вынести размер тайла в константы
      canvas.width = this.tile_size;
      canvas.height = this.tile_size;
      var ctx = canvas.getContext("2d");
      console.log('make tile: ' + [x, y, z] + ' data: ' + data.length);
      load_tree(Iter(data), leafFunction, ctx);  // Перенести сюда leafFunction
      return new Tile(x, y, z, {image: canvas});
    };

    function drawTileDebug(map, ix, iy, x, y, tile) {
      var ctx = map.ctx;
      var tile_size = this.tile_size
      ctx.font = "290px Arial";  // todo: font size calculate
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

    gui = new dat.GUI();
    gui.add(map, 'inertial').name('Inertial Scroll');
    //console.dir(map.c);
    //gui.add(map, 'c').name('Position');
    var gui_layers = gui.addFolder('Layers');
    for (var i = 0; i < map.layers.length; i++) {
      gui_layers.add(map.layers[i], 'visible').name(map.layers[i].name);
    };
    
    gui.close();
    
  };
  init();
})();
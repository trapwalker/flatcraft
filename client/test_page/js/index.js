(function() {
  var map;

  function init() {
    map = new MapWidget('workfield', {
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
        }),/**/
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

      /*if (DEBUG) {
        ctx.font = "300px Arial";
        ctx.fillStyle = 'rgba(0, 0, 255, 0.5)';
        ctx.textAlign = "center";
        ctx.fillText("["+x+', '+y+"]", this.tile_size / 2, this.tile_size / 2);
    
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
        ctx.rect(11, 11, this.tile_size - 22 - 1, this.tile_size - 22 - 1);
        ctx.rect(0, 0, this.tile_size, this.tile_size);
        ctx.stroke();
      };*/
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
  };
  init();
})();
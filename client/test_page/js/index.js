(function() {
  var movement_flag;
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
          }
        }),
        new TiledLayer({
          name: 'Main tiles',
          tile_source: new TSCache({tile_size: 2048, onGet: makeTile })
        }),
        new TiledLayer({
          name: 'Debug tiles data',
          tile_size: 2048,
          onTileDraw: function(map, ix, iy, x, y, tile) {
            var ctx = map.ctx;
            var tile_size = this.tile_size
            ctx.font = "290px Arial";
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.textAlign = "center";
            ctx.fillText("["+ix+', '+iy+"]", x + tile_size / 2, y + tile_size / 2);
        
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.rect(x + 10, y + 10, tile_size - 20 - 1, tile_size - 20 - 1);
            ctx.rect(x, y, tile_size, tile_size);/**/
            ctx.stroke();
          }
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
      console.log('make tile: ' + [x, y, z] + ' data: ' + data.data.length);
      load_tree(Iter(data.data), leafFunction, ctx);  // Перенести сюда leafFunction

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

    movement_flag = 0;

    function repaint() {
      window.requestAnimationFrame(repaint);
    }

    var old_x;
    var old_y;

    document.addEventListener('mousedown', function(e) {
      movement_flag = 1;
      old_x = e.pageX;
      old_y = e.pageY;
    });

    document.addEventListener('mousemove', function(e) {
      if(movement_flag) {
        map.c.x += old_x - e.pageX;  // todo: use scroll() method
        map.c.y += old_y - e.pageY;
        old_x = e.pageX;
        old_y = e.pageY;
      }
    });

    document.addEventListener('mouseup', function() {
      movement_flag = 0;
    });
  }

  init();
})();
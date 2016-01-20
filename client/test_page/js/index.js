(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  var cache;
  var wx; //world x
  var wy; //world y
  var movement_flag;

  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_canvas.height = workfield.clientHeight;
    main_canvas.width = workfield.clientWidth;
    main_ctx = main_canvas.getContext('2d');
    movement_flag = 0;
    wx = 0;
    wy = 0;
    cache = TileCache(TILES_AS_TREE);

    function repaint() {
      //Тестовые данные для отображения:
      main_ctx.fillStyle = BASE_COLOR;
      main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
      var offset_x = -Math.floor(wx / CHUNK_SIZE)/CHUNK_SIZE;
      var offset_y = -Math.floor(wy / CHUNK_SIZE)/CHUNK_SIZE;
      for (var i = offset_x - 1; i < offset_x + (main_canvas.width / CHUNK_SIZE | 0) + 2; i++) {
        for (var j = offset_y - 1; j < offset_y + (main_canvas.height / CHUNK_SIZE | 0) + 2; j++) {
          var tile = cache.getCanvas(i, j);
          main_ctx.drawImage(tile, i * CHUNK_SIZE + (wx % CHUNK_SIZE), j * CHUNK_SIZE + (wy % CHUNK_SIZE));
          }
      }
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
        wx += e.pageX - old_x;
        wy += e.pageY - old_y;
        old_x = e.pageX;
        old_y = e.pageY;
      }
    });

    document.addEventListener('mouseup', function(e) {
      movement_flag = 0;
      console.log('pos='+wx+', '+wy);
    });

    window.onresize = function resize() {
      main_canvas.height = workfield.clientHeight;
      main_canvas.width = workfield.clientWidth;
    }

    repaint();
  }

  init();
})();
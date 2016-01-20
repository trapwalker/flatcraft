(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  var cache;
  var wx; //world x
  var wy; //world y
  var movement_flag;
  var c;

  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_canvas.height = workfield.clientHeight;
    main_canvas.width = workfield.clientWidth;
    main_ctx = main_canvas.getContext('2d');
    movement_flag = 0;
    //wx = 0; wy = 0;
    wx = 53 * CHUNK_SIZE; wy = 34 * CHUNK_SIZE;
    cache = TileCache(TILES_AS_TREE);

    c = new Vector(0, 0);
    c = new Vector(53 * CHUNK_SIZE, 34 * CHUNK_SIZE);
    console.log('c='+c+', ' +CHUNK_SIZE);

    function repaint() {
      //Тестовые данные для отображения:
      var w = main_canvas.width;
      var h = main_canvas.height;

      main_ctx.fillStyle = BASE_COLOR;
      main_ctx.fillRect(0, 0, w, h);

      var di = Math.ceil(h / CHUNK_SIZE / 2);
      var dj = Math.ceil(w / CHUNK_SIZE / 2);
      var ti = Math.floor(c.y / CHUNK_SIZE);
      var tj = Math.floor(c.x / CHUNK_SIZE);

      for   (var i = ti - di; i <= ti + di; i++) {
        for (var j = tj - dj; j <= tj + dj; j++) {
          var tile = cache.getCanvas(j, i);
          var t_pos = new Vector(j * CHUNK_SIZE, i * CHUNK_SIZE);
          var half_scr = new Vector(w / 2, h / 2);

          var p = half_scr - c + t_pos;
          main_ctx.drawImage(tile, p.x, p.y);
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
(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  var cache;
  var c;
  var movement_flag;

  function init() {
    c = V(43.5 * CHUNK_SIZE, 31.5 * CHUNK_SIZE);

    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_canvas.height = workfield.clientHeight;
    main_canvas.width = workfield.clientWidth;
    main_ctx = main_canvas.getContext('2d');
    movement_flag = 0;
    cache = TileCache(TILES_AS_TREE);
    main_ctx.fillStyle = BASE_COLOR;
    //main_ctx.strokeStyle = "black";

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
          //var p = V(w / 2, h / 2) - c + V(j * CHUNK_SIZE, i * CHUNK_SIZE);
          main_ctx.drawImage(
              tile,
              j * CHUNK_SIZE - c.x + w / 2,
              i * CHUNK_SIZE - c.y + h / 2
          );
        }
      }

      if (DEBUG) {
        main_ctx.font = "20px Arial";
        main_ctx.fillStyle = 'red';
        main_ctx.textAlign = "right";
        main_ctx.fillText("pos=" + c, w - 20, 20);
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
        c.x += old_x - e.pageX;
        c.y += old_y - e.pageY;
        old_x = e.pageX;
        old_y = e.pageY;
      }
    });

    document.addEventListener('mouseup', function() {
      movement_flag = 0;
    });

    window.onresize = function resize() {
      main_canvas.height = workfield.clientHeight;
      main_canvas.width = workfield.clientWidth;
    }

    repaint();
  }

  init();
})();
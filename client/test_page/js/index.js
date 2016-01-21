(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  var cache;
  var cx;
  var cy;
  var movement_flag;

  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_canvas.height = workfield.clientHeight;
    main_canvas.width = workfield.clientWidth;
    main_ctx = main_canvas.getContext('2d');
    movement_flag = 0;
    cx = 43 * CHUNK_SIZE;
    cy = 31 * CHUNK_SIZE;
    cache = TileCache(TILES_AS_TREE);
    main_ctx.fillStyle = BASE_COLOR;
    //main_ctx.strokeStyle = "black";

    var tx;
    var ty;

    function repaint() {
      //Тестовые данные для отображения:
      main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
      tx = Math.floor(cx / CHUNK_SIZE);
      ty = Math.floor(cy / CHUNK_SIZE);
      for (var i = ty - Math.ceil(main_canvas.height / CHUNK_SIZE / 2); i <= ty + Math.ceil(main_canvas.height / CHUNK_SIZE / 2); i++) {
      for (var j = tx - Math.ceil(main_canvas.width / CHUNK_SIZE / 2); j <= tx + Math.ceil(main_canvas.width / CHUNK_SIZE / 2); j++) {
          var tile = cache.getCanvas(j, i);
          main_ctx.drawImage(
              tile,
              j * CHUNK_SIZE - cx + main_canvas.width / 2,
              i * CHUNK_SIZE - cy + main_canvas.height / 2
          );
          /*if (DEBUG_MOD) {
            main_ctx.rect();
          }/**/
        }
      }/**/
      //main_ctx.stroke();
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
        cx += old_x - e.pageX;
        cy += old_y - e.pageY;
        old_x = e.pageX;
        old_y = e.pageY;
      }
    });

    document.addEventListener('mouseup', function() {
      movement_flag = 0;
      print('left_y = ' + (ty - Math.ceil(main_canvas.height / CHUNK_SIZE / 2)));
      print('right_y = ' + (ty + Math.ceil(main_canvas.height / CHUNK_SIZE / 2)));
      print('left_x = ' + (tx - Math.ceil(main_canvas.width / CHUNK_SIZE / 2)));
      print('right_x = ' + (tx + Math.ceil(main_canvas.height / CHUNK_SIZE / 2)));
      print('-----------------------------------');
    });

    window.onresize = function resize() {
      main_canvas.height = workfield.clientHeight;
      main_canvas.width = workfield.clientWidth;
    }

    repaint();
  }

  init();
})();
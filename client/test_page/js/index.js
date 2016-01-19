(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  var cache;

  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_canvas.height = workfield.clientHeight;
    main_canvas.width = workfield.clientWidth;
    main_ctx = main_canvas.getContext('2d');
    cache = TileCache(TILES_AS_TREE);

    function repaint() {
      //Тестовые данные для отображения:
      main_ctx.fillStyle = BASE_COLOR;
      main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
      var tile = cache.getCanvas(0, 0);
      main_ctx.drawImage(tile, 0, 0);
      window.requestAnimationFrame(repaint);
    }

    window.onresize = function resize()
    {
      main_canvas.height = workfield.clientHeight;
      main_canvas.width = workfield.clientWidth;
    }

    repaint();
  }

  init();
})();
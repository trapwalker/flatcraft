(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  
  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_canvas.height = workfield.clientHeight;
    main_canvas.width = workfield.clientWidth;
    main_ctx = main_canvas.getContext('2d');

    repaint();

    function repaint() {
      //Тестовые данные для отображения:
      main_ctx.fillStyle = BASE_COLOR;
      main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
      main_ctx.fillStyle = "black";
      main_ctx.fillRect(0, 0, 128, 128);
    }

    window.onresize = function resize()
    {
      main_canvas.height = workfield.clientHeight;
      main_canvas.width = workfield.clientWidth;
      repaint();
    }
  }

  init();
})();
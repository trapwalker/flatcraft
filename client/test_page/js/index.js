(function() {

  var workfield;
  var main_canvas;
  var main_ctx;
  
  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_ctx = main_canvas.getContext('2d');

    function repaint() {
      // todo: realize
    }

    function resize(e) {
      // todo: realize
      repaint(); // ?
    }
  }

  init();
})();
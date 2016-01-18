(function() {

  var COLOR_MAP = {
     'r': 'red'
    ,'y': 'yellow'
    ,'b': 'blue'
    ,'g': 'green'
    ,'k': 'black'
    ,'o': 'orange'
    ,'p': 'purple'
    ,'.': null
  }
  var BASE_COLOR = "rgb(155, 155, 255)";

  var workfield;
  var main_canvas;
  var main_ctx;
  var tiles_storage = {};  // todo: Убрать, воспользоваться коллекцией из test_data

  function leaf_func(ctx, color, w, x, y) 
  {
    c = COLOR_MAP[color];
    print(color + ", [" + x + ", " + y + "], " + w + " - " + c);
    if (c === undefined) {
      print('Unknown color: "' + color + '"');
    } else if (c !== null) {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, w);
    }
  }
  
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


ff = (function(a, b) {
    print(this.xx);
})

obj = {
  xx: 15,
  f: ff
}

obj1 = {
  xx: 151,
  f: ff
}


obj.f(3, 5)


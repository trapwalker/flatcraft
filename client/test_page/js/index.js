(function() {
  var movement_flag;
  var map;

  function init() {
    map = new MapWidget('workfield', {
      location: new Vector(43.5 * 2048, 31.5 * 2048),
      layers: [
        new SimpleLayer({color: 'rgb(200, 255, 200)'}),
        new TiledLayer({tile_size: 2048})
      ]
    });

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
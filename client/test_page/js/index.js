var map;
var layer_background;
(function() {

  function init() {
    

    map = new MapWidget('workfield', {
      scrollType: 'sliding',
      location: locations.map.pos,
      onLocate: function(x, y) {
        //console.log('onLocate: '+[x, y]);
        //mapTileSource.heat(x, y, );
      },
      layers: ALL_LAYERS
    });

    // GUI

    gui = new dat.GUI();
    gui.add(map, 'zoom_target', map.zoom_min, map.zoom_max).step((map.zoom_max - map.zoom_min) / 64).name('Zoom').listen();
    gui.add(map, 'zoom_animation_factor', 1, 100).step(1).name('Zoom Duration').listen();
    gui.add(map, 'zoom_step_factor', 0.1, 0.9).step(0.05).name('Zoom Step Factor').listen();

    gui.addColor(LAYERS.background.options, 'color').name('Background Color').listen();

    var gui_scroll = gui.addFolder('Scroll');
    gui_scroll.add(map, 'scrollType', [ 'simple', 'inertial', 'sliding']).name('Type of Scroll').listen();
    gui_scroll.add(map, 'inertion_value', 0, 0.2).step(0.001).name('Inertion Reduction').listen();
    gui_scroll.add(map, 'sliding_value', 0, 1).step(0.01).name('Sliding Value').listen();

    var gui_layers = gui.addFolder('Layers');
    gui_layers.closed = false;
    for (var i = 0; i < map.layers.length; i++) {
      gui_layers.add(map.layers[i], 'visible').name(map.layers[i].name).listen();
    }

    var gui_locations = gui.addFolder('Locations');
    gui_locations.closed = false;
    for (var location_name in locations) {
      var location = locations[location_name];
      gui_locations.add(location, 'go').name(location.caption);
    };
    
    gui.close();
  };
  init();
})();
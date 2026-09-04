import { Vector } from './vector.js';
import { MapWidget } from './map.js';
import { LAYERS, ALL_LAYERS } from './layers.js';

// Locations ======================================================================
// Moved here from defines.ts when the codebase became real ES modules: `go()` needs the live
// `map` instance and `LAYERS`, both local to this file — keeping this here avoids a
// defines.ts <-> index.ts <-> layers.ts import cycle for what's UI wiring, not config.
interface LocationDef {
  pos: Vector;
  caption: string;
  go: (this: LocationDef) => void;
}

const locations: Record<string, LocationDef> = {
  bel: {
    pos: new Vector(40373076, 22579095),
    caption: 'XKCD Ship',
    go: function (this: LocationDef) {
      map.locate(this.pos);
      LAYERS.xkcd_tiles.visible = true;
    }
  },
  ship: {
    pos: new Vector(43.5 * 2048, 31.5 * 2048),
    caption: 'XKCD Ship',
    go: function (this: LocationDef) {
      map.locate(this.pos);
      LAYERS.xkcd_tiles.visible = true;
    }
  },
  map: {
    pos: new Vector(12482409, 27045819),
    caption: 'RoadDogs map',
    go: function (this: LocationDef) {
      map.locate(this.pos);
      LAYERS.map_tiles.visible = true;
    }
  },
  zero: {
    pos: new Vector(0, 0),
    caption: 'Zero point',
    go: function (this: LocationDef) {
      map.locate(this.pos);
    }
  }
};

let map: MapWidget;

(function () {
  function init(): void {
    // try to get start position form URL
    const hash = window.location.hash;
    const match = /#\[(\d+),(\d+)\]/g.exec(hash);
    const parts = match && match.slice(1);
    const start_position = parts && new Vector(Number(parts[0]), Number(parts[1]));

    map = new MapWidget('workfield', {
      scrollType: 'sliding',
      location: start_position || locations.bel.pos,
      onLocate: function (x: number, y: number) {
        //console.log('onLocate: '+[x, y]);
        // Tile preloading is now driven automatically per-frame from what's on screen,
        // see TiledLayer.draw / LOAD-1 in BACKLOG.md — no manual heat() call needed here.
      },
      layers: ALL_LAYERS,
      zoom_level_min: 5
    });

    // GUI

    const gui = new dat.GUI();
    gui.add(map, 'zoom_target', map.zoom_min, map.zoom_max).step((map.zoom_max - map.zoom_min) / 64).name('Zoom').listen();
    gui.add(map, 'zoom_animation_factor', 1, 100).step(1).name('Zoom Duration').listen();
    gui.add(map, 'zoom_step_factor', 0.1, 0.9).step(0.05).name('Zoom Step Factor').listen();

    gui.addColor(LAYERS.background.options, 'color').name('Background Color').listen();
    gui.addColor(LAYERS.map_grid.options, 'color').name('Grid color').listen();

    const gui_scroll = gui.addFolder('Scroll');
    gui_scroll.add(map, 'scrollType', ['simple', 'inertial', 'sliding']).name('Type of Scroll').listen();
    gui_scroll.add(map, 'inertion_value', 0, 0.2).step(0.001).name('Inertion Reduction').listen();
    gui_scroll.add(map, 'sliding_value', 0, 1).step(0.01).name('Sliding Value').listen();

    const gui_layers = gui.addFolder('Layers');
    gui_layers.closed = false;
    for (let i = 0; i < map.layers.length; i++) {
      gui_layers.add(map.layers[i], 'visible').name(map.layers[i].name as string).listen();
    }

    const gui_locations = gui.addFolder('Locations');
    gui_locations.closed = false;
    for (const location_name in locations) {
      const location = locations[location_name];
      gui_locations.add(location, 'go').name(location.caption);
    }

    gui.close();
  }
  init();
})();

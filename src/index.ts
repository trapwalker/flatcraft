import { Vector } from './vector.js';
import { MapWidget } from './map.js';
import type { Layer } from './map.js';
import { LAYERS, ALL_LAYERS, ATTRIBUTIONS, MANDELBROT_TILE_SIZE, MANDELBROT_Z_MAX, MANDELBROT_BASE_Z } from './layers.js';

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
  },
  mandelbrot: {
    // DEMO-4: the world position that keeps the classic "whole set" view centered at every zoom
    // level (not just at MANDELBROT_BASE_Z) — tile-index addressing puts a layer's tile (0,0) at
    // world position (0,0) *at every zoom*, so world (0,0) only shows the base rectangle's
    // top-left corner once you're past the base zoom, not its recognizable center. Centering on
    // the rectangle's actual midpoint (real=-0.5, im=0, the fraction (0.5, 0.5) of the base
    // rectangle) instead needs world position (tile_size/2) * 2^(z_max - base_z) on each axis —
    // same derivation a real map's "center tile" position would need, just solved for this
    // layer's own z_max/base_z instead of a real geo pyramid's.
    pos: new Vector(
      (MANDELBROT_TILE_SIZE / 2) * Math.pow(2, MANDELBROT_Z_MAX - MANDELBROT_BASE_Z),
      (MANDELBROT_TILE_SIZE / 2) * Math.pow(2, MANDELBROT_Z_MAX - MANDELBROT_BASE_Z)
    ),
    caption: 'Mandelbrot center', // distinct from the "Mandelbrot set" layer checkbox's own label
    go: function (this: LocationDef) {
      map.locate(this.pos);
      LAYERS.mandelbrot_tiles.visible = true;
    }
  }
};

let map: MapWidget;

(function () {
  function init(): void {
    // try to get start position (and, since ROT-2, rotation) form URL
    const hash = window.location.hash;
    // `-?` on all three groups (was missing even for x,y before ROT-2 — negative world
    // coordinates never round-tripped through the URL); the rotation group is optional so old
    // two-component links still parse, just with rotation defaulting to 0.
    const match = /#\[(-?\d+),(-?\d+)(?:,(-?\d+))?\]/g.exec(hash);
    const parts = match && match.slice(1);
    const start_position = parts && new Vector(Number(parts[0]), Number(parts[1]));
    const start_rotation = parts && parts[2] !== undefined ? (Number(parts[2]) * Math.PI) / 180 : undefined;

    map = new MapWidget('workfield', {
      scrollType: 'sliding',
      location: start_position || locations.bel.pos,
      rotation: start_rotation,
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

    const gui_rotation = gui.addFolder('Rotation');
    gui_rotation.closed = false;
    // ROT-1: Shift+drag on the canvas rotates directly; this slider is mainly for discoverability
    // and precise testing. Bound to rotation_target (not rotation) so it eases in like a
    // keyboard-triggered step, consistent with rotateBy/resetRotation.
    gui_rotation.add(map, 'rotation_target', -2 * Math.PI, 2 * Math.PI).step(Math.PI / 180).name('Angle (rad)').listen();
    gui_rotation.add(map, 'resetRotation').name('Reset to North (Home)');

    gui.addColor(LAYERS.background.options, 'color').name('Background Color').listen();
    gui.addColor(LAYERS.map_grid.options, 'color').name('Grid color').listen();

    const gui_scroll = gui.addFolder('Scroll');
    gui_scroll.add(map, 'scrollType', ['simple', 'inertial', 'sliding']).name('Type of Scroll').listen();
    gui_scroll.add(map, 'inertion_value', 0, 0.2).step(0.001).name('Inertion Reduction').listen();
    gui_scroll.add(map, 'sliding_value', 0, 1).step(0.01).name('Sliding Value').listen();

    // DEMO-1: base layers ("the background map" — substitutable, only one visible at a time,
    // same convention any layered-map UI uses) vs. independent overlay checkboxes. dat.GUI has no
    // native radio-group control for an arbitrary set of objects, so this is the established
    // idiom instead: a synthetic "active base layer" string bound to a dropdown/listbox
    // controller (`gui.add(obj, prop, arrayOfChoices)`), fanned out to each base layer's
    // `.visible` in onChange.
    const gui_layers = gui.addFolder('Layers');
    gui_layers.closed = false;

    const baseLayers: Record<string, Layer> = {
      'Map tiles back': LAYERS.map_tiles_back,
      'Map tiles front': LAYERS.map_tiles_front,
      'Map tiles (mixed)': LAYERS.map_tiles,
      'XKCD tiles': LAYERS.xkcd_tiles,
      // DEMO-2's three new no-key sources, folded in here per DEMO_BACKLOG.md.
      CyclOSM: LAYERS.map_tiles_cyclosm,
      OpenTopoMap: LAYERS.map_tiles_opentopo,
      'ESRI World Imagery': LAYERS.map_tiles_esri
    };
    const baseLayerNames = Object.keys(baseLayers);
    const initialBaseLayerName = baseLayerNames.find((name) => baseLayers[name].visible) || baseLayerNames[0];
    // Enforce exclusivity up front too, in case more than one (or none) happened to default to
    // visible — the dropdown and the layers' actual state must never disagree.
    for (const name of baseLayerNames) baseLayers[name].visible = name === initialBaseLayerName;

    const baseLayerControl = { active: initialBaseLayerName };
    gui_layers.add(baseLayerControl, 'active', baseLayerNames).name('Base map').onChange((value) => {
      for (const name of baseLayerNames) baseLayers[name].visible = name === value;
    });

    // Overlays: independent, non-exclusive checkboxes — same flat `.visible` binding the old code
    // used for every layer, just no longer including the base layers above.
    const overlayLayers: Record<string, Layer> = {
      'Strava heat map': LAYERS.map_tiles_strava,
      'Map grid': LAYERS.map_grid,
      'Map tiles debug': LAYERS.map_debug,
      'XKCD tiles debug': LAYERS.xkcd_debug,
      'Mandelbrot set': LAYERS.mandelbrot_tiles, // DEMO-4 — standalone, not a base layer
      'Debug data': LAYERS.debug
    };
    for (const name in overlayLayers) {
      gui_layers.add(overlayLayers[name], 'visible').name(name).listen();
    }

    const gui_locations = gui.addFolder('Locations');
    gui_locations.closed = false;
    for (const location_name in locations) {
      const location = locations[location_name];
      gui_locations.add(location, 'go').name(location.caption);
    }

    gui.close();

    // DEMO-6: demo-local hotkeys for demo-only layers the core (`MapWidget`, src/map.ts) doesn't
    // know by name — a separate `document.addEventListener('keydown', ...)` here rather than
    // touching that file (multiple `keydown` listeners on `document` coexist fine). Same "don't
    // steal keystrokes meant for a text field" guard as MapWidget's own listener (src/map.ts) —
    // otherwise typing into a dat.GUI number field would trip these.
    //
    //   - KeyI: toggle LAYERS.debug.visible (the fps/pos/tile-stats debug-info overlay).
    //   - KeyT: toggle map_grid/map_debug/xkcd_debug's `.visible` together, as ONE combined
    //     "tile debug overlay" state (a single press flips all three at once — the request asked
    //     for "grid and tile debug info" as one logical toggle, not three separate ones).
    //
    // A "reset rotation to 0" hotkey already exists in core (`Home` — MapWidget.resetRotationKeys)
    // — deliberately not duplicated here.
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.code === 'KeyI') {
        LAYERS.debug.visible = !LAYERS.debug.visible;
      } else if (e.code === 'KeyT') {
        const next = !LAYERS.map_grid.visible;
        LAYERS.map_grid.visible = next;
        LAYERS.map_debug.visible = next;
        LAYERS.xkcd_debug.visible = next;
      }
    });

    // DEMO-3 (minimal slice): visible attribution text for every base layer whose ToU requires it
    // (OSM/CyclOSM/OpenTopoMap/ESRI). Populated from `ATTRIBUTIONS` (src/layers.ts, defined once
    // next to the layers themselves) into a plain block in docs/index.html — not meant to be
    // pretty, just present before this demo page is ever linked to anyone outside the project.
    const attributionEl = document.getElementById('attribution');
    if (attributionEl) {
      attributionEl.textContent = Object.values(ATTRIBUTIONS).join(' | ');
    }
  }
  init();
})();

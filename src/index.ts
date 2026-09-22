import { Vector } from './vector.js';
import { BufferedLayer, MapWidget } from './map.js';
import type { Layer } from './map.js';
import { LAYERS, ALL_LAYERS, ATTRIBUTIONS, MANDELBROT_TILE_SIZE, MANDELBROT_Z_MAX, MANDELBROT_BASE_Z } from './layers.js';
import { BookmarkStore } from './bookmarks.js';
import type { Bookmark } from './bookmarks.js';
import type { VectorLayer } from './vector_layer.js';

// Bookmarks (DEMO-7, DEMO_BACKLOG.md) ============================================
// Replaces the old hand-rolled `locations` object (a hardcoded `{pos, caption, go()}` record,
// moved here from defines.ts when the codebase became real ES modules) — that was a prototype of
// exactly the Bookmark idea (BACKLOG.md's BOOKMARK-1), now a real, runtime-mutable BookmarkStore
// instead. Persistence is this file's job (BookmarkStore itself never touches localStorage — see
// its own doc comment): loaded from BOOKMARKS_STORAGE_KEY on startup, saved back after every
// add/remove.
const BOOKMARKS_STORAGE_KEY = 'flatcraft.bookmarks';

// The old `locations.bel`'s position, kept as the fallback default location — independent of the
// seed list below so the two don't have to be kept in sync by array index.
const DEFAULT_START_POSITION = new Vector(40373076, 22579095);

// Seed data for a fresh visit with nothing in BOOKMARKS_STORAGE_KEY yet — the old `locations`
// entries (plus DEMO-4's later "Mandelbrot center" addition), ported as-is (position + which
// layer each used to flip visible), so the demo doesn't regress to "no quick-jump points at all"
// the first time this ships. Only used once, by loadOrSeedBookmarks() below; never consulted
// again afterwards.
const SEED_BOOKMARKS: Array<Omit<Bookmark, 'id'>> = [
  { name: 'XKCD Ship', position: DEFAULT_START_POSITION.clone(), layerId: LAYERS.xkcd_tiles.name },
  // Was also captioned "XKCD Ship" in the original `locations` object (a pre-existing duplicate
  // name, unrelated to this ticket) — distinguished here since a bookmark list, unlike a one-off
  // object literal, actually shows both captions side by side.
  { name: 'XKCD Ship (tile-aligned)', position: new Vector(43.5 * 2048, 31.5 * 2048), layerId: LAYERS.xkcd_tiles.name },
  { name: 'RoadDogs map', position: new Vector(12482409, 27045819), layerId: LAYERS.map_tiles.name },
  { name: 'Zero point', position: new Vector(0, 0) },
  {
    name: 'Mandelbrot center',
    // DEMO-4: the world position that keeps the classic "whole set" view centered at every zoom
    // level (not just at MANDELBROT_BASE_Z) — tile-index addressing puts a layer's tile (0,0) at
    // world position (0,0) *at every zoom*, so world (0,0) only shows the base rectangle's
    // top-left corner once you're past the base zoom, not its recognizable center. Centering on
    // the rectangle's actual midpoint (real=-0.5, im=0, the fraction (0.5, 0.5) of the base
    // rectangle) instead needs world position (tile_size/2) * 2^(z_max - base_z) on each axis —
    // same derivation a real map's "center tile" position would need, just solved for this
    // layer's own z_max/base_z instead of a real geo pyramid's.
    position: new Vector(
      (MANDELBROT_TILE_SIZE / 2) * Math.pow(2, MANDELBROT_Z_MAX - MANDELBROT_BASE_Z),
      (MANDELBROT_TILE_SIZE / 2) * Math.pow(2, MANDELBROT_Z_MAX - MANDELBROT_BASE_Z)
    ),
    layerId: LAYERS.mandelbrot_tiles.name
  }
];

function loadOrSeedBookmarks(): BookmarkStore {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (raw) return BookmarkStore.deserialize(JSON.parse(raw));
  } catch (e) {
    console.warn('Failed to load bookmarks from localStorage, starting fresh', e);
  }

  const store = new BookmarkStore();
  for (const bookmark of SEED_BOOKMARKS) store.add(bookmark);
  return store;
}

function saveBookmarks(): void {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(map.bookmarks.serialize()));
  } catch (e) {
    console.warn('Failed to save bookmarks to localStorage', e);
  }
}

let map: MapWidget;

(function () {
  function init(): void {
    // try to get start position (and, since ROT-2, rotation, and since STATE-3/DEMO-11, zoom and
    // active base layer) form URL
    const hash = window.location.hash;
    // STATE-3/DEMO-11: URL hash format, informal and versionless for now (STATE-4, not in scope
    // here, would add real versioning so a future format change doesn't silently mis-parse an old
    // saved/shared link): `#[x,y,rot,zoom,layer]` —
    //   x, y    — world position, rounded to whole numbers (as before ROT-2/this ticket).
    //   rot     — rotation in whole DEGREES, human-readable in the URL bar (as before, ROT-2),
    //             converted back to radians on parse.
    //   zoom    — zoom_target, a plain float (fixed to 6 decimal places when written — see
    //             encodeStateHash below — plenty of precision for this widget's zoom range
    //             without runaway digits).
    //   layer   — the active base layer's display name (DEMO-1's `baseLayerControl.active`,
    //             e.g. "CyclOSM"), `encodeURIComponent`-ed since names contain spaces.
    // `rot`/`zoom`/`layer` are all optional and independent of each other for *parsing* (old
    // 2-component `#[x,y]` and 3-component `#[x,y,rot]` links — ROT-2-era — still parse, simply
    // missing the newer fields); this codebase itself only ever *writes* the full 5-component form
    // (see the STATE-2 polling block near the end of this function) once this ships.
    const match = /#\[(-?\d+),(-?\d+)(?:,(-?\d+))?(?:,([^,\]]+),([^\]]*))?\]/.exec(hash);
    const parts = match && match.slice(1);
    const start_position = parts && new Vector(Number(parts[0]), Number(parts[1]));
    const start_rotation = parts && parts[2] !== undefined ? (Number(parts[2]) * Math.PI) / 180 : undefined;
    // Number(undefined) is NaN, not undefined — guard explicitly so a missing/malformed zoom
    // component degrades to "no override" (map.deserializeState below already no-ops on NaN too,
    // this is just belt-and-suspenders/clearer at the call site).
    const parsedZoom = parts && parts[3] !== undefined ? Number(parts[3]) : NaN;
    const start_zoom = Number.isFinite(parsedZoom) ? parsedZoom : undefined;
    // decodeURIComponent throws on malformed percent-encoding — an old/hand-edited/corrupted link
    // shouldn't crash the page over a cosmetic layer-name mismatch, just fall back to no override.
    let start_layer: string | undefined;
    if (parts && parts[4] !== undefined) {
      try {
        start_layer = decodeURIComponent(parts[4]);
      } catch (e) {
        console.warn('Failed to decode layer name from URL hash, ignoring', e);
      }
    }

    map = new MapWidget('workfield', {
      scrollType: 'sliding',
      location: start_position || DEFAULT_START_POSITION,
      rotation: start_rotation,
      onLocate: function (x: number, y: number) {
        //console.log('onLocate: '+[x, y]);
        // Tile preloading is now driven automatically per-frame from what's on screen,
        // see TiledLayer.draw / LOAD-1 in BACKLOG.md — no manual heat() call needed here.
      },
      layers: ALL_LAYERS,
      zoom_level_min: 5
    });

    // STATE-3: zoom has no constructor option (unlike location/rotation above) — applied here,
    // instantly (no FLY-4/jumpTo yet), through the shared, core deserializeState() (STATE-1,
    // src/map.ts) rather than a one-off `map.zoom_target = ...` assignment, so the "ignore
    // missing/malformed" graceful-degradation logic lives in exactly one place.
    if (start_zoom !== undefined) map.deserializeState({ zoom: start_zoom });

    // BOOKMARK-1/DEMO-7: MapWidget itself only ever constructs an empty BookmarkStore (see its
    // own comment in src/map.ts) — replacing it wholesale here is the demo's chosen way to plug
    // in localStorage-backed persistence without adding any storage concept to the core widget.
    map.bookmarks = loadOrSeedBookmarks();

    // VEC-7: wires the demo vector layer's click/hover into this real map instance — enableFeatureEvents
    // (src/vector_layer.ts) is a plain method with no "added to a map" lifecycle hook to call it from
    // automatically (see that method's own doc comment), so a host that wants the behavior calls it
    // itself once, here, same spot other one-time map-instance wiring (map.bookmarks above) happens.
    // Hover: `map.canvas.style.cursor` is not touched anywhere else in this codebase (checked via
    // grep before relying on this) — nothing here can conflict with pan/zoom/rotate's own handling.
    const demoVectorLayer = LAYERS.demo_vector as VectorLayer;
    demoVectorLayer.onFeatureHover = (feature) => {
      map.canvas.style.cursor = feature ? 'pointer' : 'default';
    };
    demoVectorLayer.onFeatureClick = (feature) => {
      console.log('[VEC-7 demo] feature click:', feature.id, feature.properties);
    };
    demoVectorLayer.enableFeatureEvents(map);

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
      // DEMO-9: keys renamed to match LAYERS.map_tiles_back/front/map_tiles's own (also renamed)
      // `.name` — this dict's keys are a separate, independent set of display strings from
      // `Layer.name` (dat.GUI's dropdown shows THESE keys, not `.name`), so DEMO-9's rename had to
      // be mirrored here too or the dropdown would still show the old, confusing labels.
      'RoadDogs back (не работает)': LAYERS.map_tiles_back,
      OpenStreetMap: LAYERS.map_tiles_front,
      'RoadDogs mixed (не работает)': LAYERS.map_tiles,
      'XKCD tiles': LAYERS.xkcd_tiles,
      // DEMO-2's three new no-key sources, folded in here per DEMO_BACKLOG.md.
      CyclOSM: LAYERS.map_tiles_cyclosm,
      OpenTopoMap: LAYERS.map_tiles_opentopo,
      'ESRI World Imagery': LAYERS.map_tiles_esri
    };
    const baseLayerNames = Object.keys(baseLayers);
    // STATE-3/DEMO-11: a `start_layer` from the URL hash wins over whichever layer happened to
    // default to visible, but ONLY if it actually names one of the layers this demo knows about —
    // an old/hand-edited/foreign link naming a since-renamed/removed layer falls straight through
    // to the pre-existing "whichever is already visible, else the first one" default, same
    // graceful degradation as a missing zoom component above.
    const startLayerValid = start_layer !== undefined && baseLayerNames.includes(start_layer);
    const initialBaseLayerName =
      (startLayerValid ? start_layer : undefined) ||
      baseLayerNames.find((name) => baseLayers[name].visible) ||
      baseLayerNames[0];
    // Enforce exclusivity up front too, in case more than one (or none) happened to default to
    // visible — the dropdown and the layers' actual state must never disagree. Same mechanism
    // restores the URL's saved layer as sets any other initial layer — no second, parallel
    // exclusivity path just for the URL-restore case.
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
      'Debug data': LAYERS.debug,
      'Демо: векторный слой': LAYERS.demo_vector // VEC-7
    };
    for (const name in overlayLayers) {
      gui_layers.add(overlayLayers[name], 'visible').name(name).listen();
    }

    // DEMO-7: dat.GUI has no built-in support for a controller list that grows/shrinks at
    // runtime (the closest existing precedent in this file, the base-layer dropdown/overlay
    // checkboxes above, is built once from a fixed set and never changes size afterwards).
    // Simplest approach that actually works: track the controllers this folder currently holds,
    // and on every add/remove wipe all of them (each controller's own `.remove()` — dat.GUI's
    // public per-controller removal, see src/types/dat-gui.d.ts) and rebuild fresh ones from
    // `map.bookmarks.list()`.
    const gui_bookmarks = gui.addFolder('Bookmarks');
    gui_bookmarks.closed = false;
    let bookmarkControllers: dat.GUIController[] = [];

    function rebuildBookmarksFolder(): void {
      for (const controller of bookmarkControllers) controller.remove();
      bookmarkControllers = [];

      for (const bookmark of map.bookmarks.list()) {
        // A fresh one-off object per bookmark (dat.GUI's `.add(target, 'method')` binds to a
        // property on a real object, same as the old `locations[...].go()` pattern) — closes
        // over this specific bookmark's id, not whichever one happens to be last in the loop.
        const goHandle = { go: () => map.goToBookmark(bookmark.id) };
        bookmarkControllers.push(gui_bookmarks.add(goHandle, 'go').name(bookmark.name));

        // DEMO-10: a second button per bookmark for renaming, alongside "go" above — dat.GUI has
        // no compound "row with two buttons" widget, so this is just a second `.add()` call bound
        // to a second one-off handle object, same pattern as `goHandle`. Named "✏ <name>" (rather
        // than reusing the bookmark's own name, which the "go" button above already claims) so
        // it's unambiguous in the folder which of the two buttons does what.
        const renameHandle = {
          rename: () => {
            const newName = prompt('Rename bookmark:', bookmark.name);
            if (!newName || newName === bookmark.name) return; // cancelled, blank, or unchanged
            map.bookmarks.rename(bookmark.id, newName);
            saveBookmarks();
            rebuildBookmarksFolder();
          }
        };
        bookmarkControllers.push(gui_bookmarks.add(renameHandle, 'rename').name('✏ ' + bookmark.name));
      }
    }

    const addBookmarkHandle = {
      addHere: function (): void {
        const name = prompt('Bookmark name?');
        if (!name) return; // cancelled, or left blank

        // DEMO-7: "optionally tie to the active base layer" — implemented as a second
        // confirm()/prompt() pair (one of the ticket's own suggested options), rather than
        // auto-detecting "the" active layer: several layers here (background, the grid, the
        // debug overlay, ...) can be visible=true at once, so there's no single well-defined
        // layer to guess at without risking a wrong guess — asking is unambiguous where
        // guessing wouldn't be. (For a base layer specifically, `baseLayerControl.active`
        // above already names the current one exactly — offered as the default answer.)
        let layerId: string | undefined;
        if (confirm('Tie this bookmark to a specific layer? (only that layer\'s visibility will be restored when you jump to it)')) {
          const layerName = prompt('Layer name, exactly as shown in the Layers folder:', baseLayerControl.active);
          layerId = layerName || undefined;
        }

        map.bookmarks.add({
          name,
          position: map.c.clone(),
          zoom: map.zoom_target,
          rotation: map.rotation_target,
          layerId
        });
        saveBookmarks();
        rebuildBookmarksFolder();
      }
    };
    gui_bookmarks.add(addBookmarkHandle, 'addHere').name('Add bookmark here');

    rebuildBookmarksFolder();

    gui.close();

    // Direct user request (2026-09-22, reopened ROT-3 investigation): triggers a browser download
    // for `blob`, via the standard "temporary <a download> click" idiom — no server round-trip,
    // works for any Blob already in hand (here, a canvas's own toBlob() output).
    function saveBlob(blob: Blob, filename: string): void {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    // Direct user request: save the EXACT offscreen buffer bitmap every visible BufferedLayer
    // (ROT-8, src/map.ts — TiledLayer/ImageOverlayLayer both extend it) currently composites
    // tiles/sprites into, losslessly, to a real PNG file — specifically so this can be inspected
    // byte-for-byte, bypassing the OS/GPU display compositor entirely (a screenshot goes through
    // that; `canvas.toBlob('image/png')` reads the buffer's own backing store directly, same data
    // `getImageData` would see). One file per visible buffered layer, named after `Layer.name`.
    // Real cross-origin imagery with no CORS headers (the production OSM base layer, e.g.) taints
    // its buffer — `exportBufferPNG()` rejects for those; reported via console.warn rather than
    // thrown, so one tainted layer doesn't stop the others (map_grid, any future same-origin
    // source, ...) from saving.
    async function saveAllBufferPNGs(): Promise<void> {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      for (const layer of ALL_LAYERS) {
        if (!layer.visible || !(layer instanceof BufferedLayer)) continue;
        try {
          const blob = await layer.exportBufferPNG();
          if (!blob) {
            console.warn(`[KeyM] ${layer.name}: buffer is empty (nothing drawn yet)`);
            continue;
          }
          saveBlob(blob, `buffer-${layer.name}-${stamp}.png`);
        } catch (e) {
          console.warn(`[KeyM] ${layer.name}: could not export buffer (likely cross-origin-tainted, e.g. real map tiles with no CORS headers)`, e);
        }
      }
    }

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
    //   - KeyM: save every visible buffered layer's exact offscreen buffer bitmap to a PNG file
    //     (see saveAllBufferPNGs above).
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
      } else if (e.code === 'KeyM') {
        void saveAllBufferPNGs();
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

    // STATE-2/STATE-3/DEMO-11 (BACKLOG.md/DEMO_BACKLOG.md): keep the URL hash reflecting the
    // current position/zoom/rotation/active-base-layer at all times, by direct request ("занеси
    // настройки локации, зумма и слоя в URL по небольшому таймауту, чтобы в URL всегда было
    // текущее состояние"). Originally specced as depending on EVT-2 (moveend/zoomend/rotateend
    // events) — that phase doesn't exist yet, and polling is simpler than subscribing to events
    // that would have to be built first, so this doesn't wait on it (see STATE-2's own note on
    // migrating later, if EVT-2 ever lands, without changing this behavior from the outside).
    //
    // Builds the same `#[x,y,rot,zoom,layer]` string the top-of-function parser above reads back
    // (see its own comment for the field-by-field format) from map.serializeState() (STATE-1,
    // src/map.ts) plus `baseLayerControl.active` (DEMO-1's existing base-layer dropdown value —
    // the single "active base layer" concept this demo already has, not a second one invented for
    // this ticket).
    function encodeStateHash(): string {
      const state = map.serializeState();
      const degrees = Math.round((state.rotation * 180) / Math.PI);
      // Fixed to 6 decimal places — enough precision to round-trip zoom_target meaningfully
      // without an ever-growing float tail in the URL bar; `Number(...)` afterwards drops any
      // trailing zeros toFixed would otherwise pad in (e.g. "0.500000" -> 0.5 -> "0.5").
      const zoom = Number(state.zoom.toFixed(6));
      return (
        '#[' +
        Math.round(state.x) +
        ',' +
        Math.round(state.y) +
        ',' +
        degrees +
        ',' +
        zoom +
        ',' +
        encodeURIComponent(baseLayerControl.active) +
        ']'
      );
    }

    // Written once immediately (so the URL reflects reality right away, not only after the first
    // poll tick) and then re-checked every tick below.
    let lastWrittenHash = encodeStateHash();
    history.replaceState('', '', lastWrittenHash);

    // A few hundred ms, per the request's own "по небольшому таймауту" — frequent enough that the
    // URL never lags noticeably behind what's on screen, infrequent enough not to spam
    // history.replaceState (browsers rate-limit/otherwise dislike very hot history churn) or waste
    // CPU on a demo page. `replaceState`, never `pushState` — this must not flood browser history
    // with an entry per tick, only ever the double-click-to-recenter gesture (ROT-2,
    // MapWidget.update_url_position) uses pushState, and that's unrelated to this polling loop.
    const STATE_SYNC_INTERVAL_MS = 400;
    setInterval(() => {
      const currentHash = encodeStateHash();
      if (currentHash === lastWrittenHash) return; // nothing actually changed since last tick
      lastWrittenHash = currentHash;
      history.replaceState('', '', currentHash);
    }, STATE_SYNC_INTERVAL_MS);
  }
  init();
})();

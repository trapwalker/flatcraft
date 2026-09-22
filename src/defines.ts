// Direct user request (2026-09-22): debug-info overlay off by default — was permanently on
// (LAYERS.debug's visible: DEBUG, src/layers.ts), showing fps/pos/tile-cache stats to every
// visitor of the demo page regardless of whether they're debugging anything. Toggle with KeyI
// (src/index.ts) or the "Debug data" checkbox in the Layers folder, same as before.
export const DEBUG = false;

export const NC = '+'; // Node Code
// Direct user request (2026-09-22): black by default, specifically so subpixel gaps between
// tiles are visible against a maximally contrasting background without having to open the
// Background Color picker first — see BACKLOG.md's reopened ROT-3 for why this contrast is the
// actual precondition for seeing the seam bug at all (a mid-gray background like the old default
// hides a ~1px gray hairline almost completely).
// const BASE_COLOR = 'rgb(201, 180, 237)'; //'rgb(200, 255, 200)';
export const BASE_COLOR = 'rgb(0, 0, 0)'; //'rgb(200, 200, 200)'; //'rgb(50, 50, 50)';//'rgb(200, 255, 200)';

export interface ColorMapEntry {
  color: string;
  texture?: string;
}

export type ColorMapValue = string | ColorMapEntry | null;

export const COLOR_MAP: Record<string, ColorMapValue> = {
  'r': 'red',
  'y': 'yellow',
  'b': 'blue',
  'g': 'green',
  'k': 'black',
  'o': 'orange',
  'p': 'purple',
  '.': null,
  '0': { color: 'black', texture: 'images/grunt512.png' },
  '1': null,
  '+': 'green'
};

// VEC-1: fixed MVP style for VectorLayer — VEC-2 is where per-feature/data-driven style() lands;
// until then this is the one hardcoded look for every feature, kept here (not inline in
// vector_layer.ts) for the same reason BASE_COLOR/COLOR_MAP live here rather than in layers.ts —
// a single place for the project's color constants.
export const VECTOR_LAYER_POINT_COLOR = 'rgb(220, 50, 50)';
export const VECTOR_LAYER_LINE_COLOR = 'rgb(50, 90, 220)';
export const VECTOR_LAYER_FILL_COLOR = 'rgba(50, 90, 220, 0.35)';

// VEC-6: default color for a feature's billboard label (see FeatureStyle.labelColor in
// vector_layer.ts) — kept here for the same "one place for the project's color constants" reason
// as the three colors above.
export const VECTOR_LAYER_LABEL_COLOR = 'rgb(20, 20, 20)';

// `LocationDef`/`locations` used to live here, but they reference the live `map` instance and
// `LAYERS` from index.ts/layers.ts — moved to index.ts (where both already exist locally) when
// this file became a real ES module, to avoid a defines.ts <-> index.ts <-> layers.ts import
// cycle for what's really UI wiring, not a constant/config definition.

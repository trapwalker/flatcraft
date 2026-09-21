export const DEBUG = true;

export const NC = '+'; // Node Code
// const BASE_COLOR = 'rgb(201, 180, 237)'; //'rgb(200, 255, 200)';
export const BASE_COLOR = 'rgb(200, 200, 200)'; //'rgb(50, 50, 50)';//'rgb(200, 255, 200)';

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

// `LocationDef`/`locations` used to live here, but they reference the live `map` instance and
// `LAYERS` from index.ts/layers.ts — moved to index.ts (where both already exist locally) when
// this file became a real ES module, to avoid a defines.ts <-> index.ts <-> layers.ts import
// cycle for what's really UI wiring, not a constant/config definition.

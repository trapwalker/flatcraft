export const DEBUG = true;
export const NC = '+'; // Node Code
// const BASE_COLOR = 'rgb(201, 180, 237)'; //'rgb(200, 255, 200)';
export const BASE_COLOR = 'rgb(200, 200, 200)'; //'rgb(50, 50, 50)';//'rgb(200, 255, 200)';
export const COLOR_MAP = {
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
// `LocationDef`/`locations` used to live here, but they reference the live `map` instance and
// `LAYERS` from index.ts/layers.ts — moved to index.ts (where both already exist locally) when
// this file became a real ES module, to avoid a defines.ts <-> index.ts <-> layers.ts import
// cycle for what's really UI wiring, not a constant/config definition.
//# sourceMappingURL=defines.js.map
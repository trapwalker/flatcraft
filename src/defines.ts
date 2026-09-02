const DEBUG = true;

const NC = '+'; // Node Code
// const BASE_COLOR = 'rgb(201, 180, 237)'; //'rgb(200, 255, 200)';
const BASE_COLOR = 'rgb(200, 200, 200)'; //'rgb(50, 50, 50)';//'rgb(200, 255, 200)';

interface ColorMapEntry {
  color: string;
  texture?: string;
}

type ColorMapValue = string | ColorMapEntry | null;

const COLOR_MAP: Record<string, ColorMapValue> = {
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

// Locations ======================================================================

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

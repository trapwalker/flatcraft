
var DEBUG = true;

var NC = '+'; //Node Code
//var BASE_COLOR = 'rgb(201, 180, 237)';//'rgb(200, 255, 200)';
var BASE_COLOR = 'rgb(50, 50, 50)';//'rgb(200, 255, 200)';

var COLOR_MAP = {
    'r': 'red'
    ,'y': 'yellow'
    ,'b': 'blue'
    ,'g': 'green'
    ,'k': 'black'
    ,'o': 'orange'
    ,'p': 'purple'
    ,'.': null
    ,'0': {'color': 'black', 'texture': 'images/grunt512.png'}
    ,'1': null
    ,'+': 'green'
}

// Locations ======================================================================

var locations = {
  ship: {
    pos: new Vector(43.5 * 2048, 31.5 * 2048), 
    caption: "XKCD Ship",
    go: (function() {map.locate(this.pos); LAYERS.xkcd_tiles.visible = true;})
  },
  map: {
    pos: new Vector(12482409, 27045819), 
    caption: "RoadDogs map",
    go: (function() {map.locate(this.pos); LAYERS.map_tiles.visible = true;})
  },
  zero: {
    pos: new Vector(0, 0), 
    caption: "Zero point",
    go: (function() {map.locate(this.pos);})
  },
};

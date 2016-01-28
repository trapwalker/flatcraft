var NC = '+'; //Node Code
var BASE_COLOR = 'rgb(201, 180, 237)';//'rgb(200, 255, 200)';

var COLOR_MAP = {
    'r': 'red'
    ,'y': 'yellow'
    ,'b': 'blue'
    ,'g': 'green'
    ,'k': 'black'
    ,'o': 'orange'
    ,'p': 'purple'
    ,'.': null
    ,'0': 'black'
    ,'1': null
    ,'+': 'green'
}

var DEBUG = true;

var INIT_STATE = {
    'zoom' : 0.6, //todo: привязать к зуму
    'scroll' : 'simple', //simple, inertial, sliding
    'location' : 'goToShip',
    'bgLayer' : true,
    'mapLayer' : false,
    'mapDebugLayer' : false,
    'XKCDLayer' : true,
    'XKCDDebugLayer' : false,
}
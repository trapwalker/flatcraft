(function() {

  var COLOR_MAP = {
     'r': 'red'
    ,'y': 'yellow'
    ,'b': 'blue'
    ,'g': 'green'
    ,'k': 'black'
    ,'o': 'orange'
    ,'p': 'purple'
    ,'.': null
  }
  var BASE_COLOR = "rgb(155, 155, 255)";

  var workfield;
  var main_canvas;
  var main_ctx;
  var tiles_storage = {};

  function init() {
    workfield = document.getElementById('workfield');
    main_canvas = document.getElementById('render');
    main_ctx = main_canvas.getContext('2d');
    
    (function() {
      for(i = 0; i <= 1; i++) {
        for(j = 0; j <= 1; j++) {
          var canvas = document.createElement('canvas');
          canvas.width  = 256;
          canvas.height = 256;
          fillCanvas(canvas.getContext('2d'), 256, TEST_TREE_DATA1[i][j]);
          row.push(canvas);
        }
        container.push(row);
      }
    })()
  }

function fillCanvas(ctx, w, data) 
{
  function leaf_func(color, w, x, y) 
  {
    c = COLOR_MAP[color];
    print(color + ", [" + x + ", " + y + "], " + w + " - " + c);
    if (c === undefined) {
      print('Unknown color: "' + color + '"');
    } else if (c !== null) {
      rect(x, y, w, c);
    }
  }
  
  function rect(x1, y1, w, color) 
  {
    ctx.fillStyle = color;
    ctx.fillRect(x1, y1, w, w);
  }
  
  rect(0, 0, w);
  load_tree(Iter(data), leaf_func, w, 0, 0);  
}

var container = [];
for(i = 0; i < 4; i++)
{
  var row = [];
  for(j = 0; j < 4; j++)
  {
    var canvas = document.createElement('canvas');
    canvas.width  = 256;
    canvas.height = 256;
    fillCanvas(canvas.getContext('2d'), 256, TEST_TREE_DATA1[i][j]);
    row.push(canvas);
  }
  container.push(row);
}

var x = 0;

document.getElementById('render').onclick = function()
{
  ctx = document.getElementById('render').getContext('2d');
  ctx.drawImage(container[x][0], 0, 0);
  ctx.drawImage(container[x][1], 256, 0);
  ctx.drawImage(container[x][2], 0, 256);
  ctx.drawImage(container[x][3], 256, 256);
  if (x < 3) {
    x++;  
  }
  else x = 0;
}


/*
    // Event Listeners

    function resize(e) {
        screenWidth  = canvas.width  = window.innerWidth;
        screenHeight = canvas.height = window.innerHeight;
        bufferCvs.width  = screenWidth;
        bufferCvs.height = screenHeight;
        context   = canvas.getContext('2d');
        bufferCtx = bufferCvs.getContext('2d');

        var cx = canvas.width * 0.5,
            cy = canvas.height * 0.5;

        grad = context.createRadialGradient(cx, cy, 0, cx, cy, Math.sqrt(cx * cx + cy * cy));
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    }
/**/
})();

DICT = ['red', 'yellow', 'blue', 'green', 'black', 'orange', 'purple'];
BASE_COLOR = "rgb(155, 155, 255)";

function load_tree(stream, callback, w, x, y) {
  // todo: Пробрасывать глубину узла от корня
  x = (x==undefined)?0:x;
  y = (y==undefined)?0:y;
  var node = stream();
  if (node == NC) {
    // todo: Добавить коллбэк on_node
    w /= 2;
    load_tree(stream, callback, w, x    , y    );
    load_tree(stream, callback, w, x + w, y);
    load_tree(stream, callback, w, x, y + w);
    load_tree(stream, callback, w, x + w, y + w);    
  }
  else {
    // todo: Переиеновать коллбэк в on_leaf
    callback(node, w, x, y);
  }
}

function fillCanvas(ctx, w, data) 
{
  function leaf_func(color, w, x, y) 
  {
    print(color + ", [" + x + ", " + y + "], " + w);
    rect(x, y, w, DICT[color - 1])
  }
  
  function rect(x1, y1, w, color) 
  {
    color = color || BASE_COLOR;
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


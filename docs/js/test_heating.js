var cnv = window['canvas'];
var ctx = cnv.getContext('2d');
var w = cnv.width;
var h = cnv.height;
var c = 10;

ctx.strokeStyle ='black';
ctx.rect(0, 0, w, h);
ctx.stroke();

function draw(t, x, y, z) {
  z = z || 0;
  t = (t===undefined)?'':t;
  xx = w/2+x*w/c;
  yy = h/2+y*h/c;
  
  ctx.beginPath();
  ctx.strokeStyle ='black';
  ctx.rect(xx+3, yy+3, w/c-6, h/c-6);
  ctx.stroke();
  
  ctx.font = "bold 18px Arial";  // todo: font size calculate
  ctx.fillStyle = 'red';  
  ctx.textAlign = "center";
  ctx.fillText(t, xx+w/c/2, yy+h/c/2);
}

function grid() {
  for (var iy = -5; iy < 5; iy++)
    for (var ix = -5; ix < 5; ix++) {    
      xx = w/2+ix*w/c;
      yy = h/2+iy*h/c;
      
      ctx.beginPath();
      ctx.strokeStyle ='green';
      ctx.rect(xx, yy, w/c, h/c);
      ctx.stroke();

      ctx.font = "10px Arial";  // todo: font size calculate
      ctx.fillStyle = 'blue';
      ctx.textAlign = "center";
      ctx.fillText([ix, iy], xx+w/c/2, yy+h/c-5);      
    }
}

function full() {
  var i = 0;
  for (var iy = -c/2; iy < c/2; iy++)
    for (var ix = -c/2; ix < c/2; ix++) {    
      draw(i, ix, iy);
      i++;
  }
}

grid();
var x = 0;
var y = 0;
var z = 0;
var r = 3;

function it() {
  var i = 0;
  return function(x, y, z) {
    if (z==cut)
      draw(i, x, y, z);
    i++;
    return 1;
  };
}


var cut = 2;
var r1 = Math.ceil(1920/256/2 + 1);
var r2 = r1 * 2;
var deep = 2;

//ring(it(), r, x, y, 0);
console.log(''+[r1, r2, deep]);
console.log(heat(it(), x, y, z, r1, r2, deep));


//full();
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

function square(callback, x, y, z, r) {
  if (r < 1) {
    callback(x, y, z);
    return 1
  }
  var ix = x - r;
  var iy = y - r;
  var cnt = 0;
  for (var dir=0; dir<4; dir++) {
    var dx = [1, 0, -1, 0][dir];
    var dy = [0, 1, 0, -1][dir];
    for (var j=0; j < 2*r; j++) {
      cnt += callback(ix, iy, z);
      ix += dx;
      iy += dy;
    }
  }
  return cnt;
}

function ring(callback, x, y, z, r1, r2) {
  if (r2 === undefined) {r2 = r1; r1 = 0;}
  var cnt = 0;
  for (var r = r1; r < r2; r++) cnt += square(callback, x, y, z, r);
  return cnt;
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


function heat(callback, x, y, z, r1, r2, deep) {
  deep = (deep === undefined)?(r2 - r1):deep;
  var cnt = 0;
  cnt += ring(callback, x, y, z, r1);
  for (var i = 0; i < r2 - r1; i++) {
    cnt += square(callback, x, y, z, r1 + i);
    if (i < deep) {
      for (var j = 0; j < i; j++) {
       cnt += square(callback, x, y, z + j + 1, r1 + i - j - 1);
       cnt += square(callback, x, y, z - j - 1, r1 + i - j - 1);
      }/**/
      cnt += ring(callback, x, y, z + i + 1, r1);
      cnt += ring(callback, x, y, z - i - 1, r1);
    }
  }
  return cnt;
}

var cut = 2;
var r1 = Math.ceil(1920/256/2 + 1);
var r2 = r1 * 2;
var deep = 2;

//ring(it(), r, x, y, 0);
console.log(''+[r1, r2, deep]);
console.log(heat(it(), x, y, z, r1, r2, deep));


//full();
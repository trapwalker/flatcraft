
function Iter(array) {
  var idx = 0;
  function iterator() {
    idx += 1;
    return array[idx - 1];
  };
  return iterator;
};


function print(text) {
  var con = document.getElementById("console");
  if (con) {
    while (print.log_counter >= print.LOG_ITEMS_LIMIT) {
      con.removeChild(con.firstChild);
      print.log_counter--;
    };
    p = document.createElement('p');
    p.innerHTML = text;
    con.appendChild(p);
    print.log_counter++;

    con.scrollTop = con.scrollHeight;
  };
};

print.log_counter = 0;
print.LOG_ITEMS_LIMIT = 100;

/// AvgRing ///////////////////////////////////////////////////////////////////////////////////////
function AvgRing(size) {
  this.size = size;
  this._buffer = [];
  this._head = 0;
  this.minimum = null;
  this.maximum = null;
  this.sum = 0;
  this.last_sum = 0;
  this.full_count = 0;
  this.value = null;
};

AvgRing.prototype.add = function(value) {
  if (!value) return;

  var buffer = this._buffer;

  if (buffer.length >= this.size) {
    var old = buffer[this._head];
    if (old)
      this.last_sum -= old;
  };
  
  buffer[this._head] = value;
  this._head = (this._head + 1) % this.size;

  if (this.maximum === null || value > this.maximum)
    this.maximum = value;

  if (this.minimum === null || value < this.minimum)
    this.minimum = value;

  this.sum += value;
  this.last_sum += value;
  this.full_count += 1;
  this.value = value;
};

AvgRing.prototype.avg = function() {
  return this.last_sum / this._buffer.length;
}
///////////////////////////////////////////////////////////////////////////////////////////////////

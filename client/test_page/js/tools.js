
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

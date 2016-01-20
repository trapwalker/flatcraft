
function Iter(array) {
  var idx = 0;
  function iterator() {
    idx += 1;
    return array[idx - 1];
  }
  return iterator;
}

function print(text) {
  var con = document.getElementById("console");
  if (con) {
    con.innerHTML += '<p>'+text+'</p>';
    print.log_counter++;
    if (log_counter > LOG_ITEMS_COUNT) {
      con.removeChild(con.firstChild);
    }
    con.scrollTop = con.scrollHeight;
  }
}

print.log_counter = 0;

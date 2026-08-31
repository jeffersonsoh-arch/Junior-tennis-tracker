/* Shared localStorage persistence + JSON backup/restore helpers.
   Each player page calls these with its own storage key. */

function loadLocalState(key, defaultFactory){
  try{
    var raw = localStorage.getItem(key);
    if (raw){
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  }catch(e){ /* fall through to default */ }
  return defaultFactory();
}

function saveLocalState(key, state){
  try{
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  }catch(e){
    console.warn("Could not save progress locally:", e);
    return false;
  }
}

function downloadJson(filename, obj){
  var blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

function uploadJson(onLoaded){
  var input = document.createElement("input");
  input.type = "file"; input.accept = "application/json";
  input.addEventListener("change", function(){
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        onLoaded(parsed);
      }catch(e){
        alert("That file doesn't look like a valid backup (couldn't parse JSON).");
      }
    };
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(function(){ document.body.removeChild(input); }, 0);
}

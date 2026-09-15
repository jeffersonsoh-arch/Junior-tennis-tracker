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

/* Supabase-backed persistence, with the local copy kept as an offline
   cache: reads/writes still update localStorage so the app has something
   to show immediately on the next load and if the network is down.
   player_progress is keyed by plan_id (one row per plan) — RLS resolves
   access through plan -> player -> player_members, not a direct owner
   column, so any active member of the player can read/write it. */

function loadRemoteState(client, planId, localKey, defaultFactory){
  return client.from("player_progress").select("data").eq("plan_id", planId).maybeSingle()
    .then(function(res){
      if (res.error) throw res.error;
      if (res.data && res.data.data && typeof res.data.data === "object" && Object.keys(res.data.data).length){
        try{ localStorage.setItem(localKey, JSON.stringify(res.data.data)); }catch(e){}
        return res.data.data;
      }
      var seed = loadLocalState(localKey, defaultFactory);
      return saveRemoteState(client, planId, localKey, seed).then(function(){ return seed; });
    });
}

function saveRemoteState(client, planId, localKey, state){
  return client.from("player_progress")
    .upsert({ plan_id: planId, data: state }, { onConflict: "plan_id" })
    .then(function(res){
      if (res.error) throw res.error;
      try{ localStorage.setItem(localKey, JSON.stringify(state)); }catch(e){}
      return true;
    });
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

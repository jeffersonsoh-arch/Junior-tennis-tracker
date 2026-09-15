/* Single shared Supabase client, built from assets/config.js. */

var SUPABASE_CLIENT = null;

function getSupabaseClient(){
  if (SUPABASE_CLIENT) return SUPABASE_CLIENT;
  if (!window.supabase || !window.supabase.createClient){
    throw new Error("Supabase library failed to load — check your internet connection.");
  }
  var url = window.DEUCEBOARD_SUPABASE_URL, key = window.DEUCEBOARD_SUPABASE_ANON_KEY;
  if (!url || !key || url.indexOf("YOUR_") === 0 || key.indexOf("YOUR_") === 0){
    throw new Error("Backend not configured yet — edit assets/config.js with your Supabase project URL and anon key.");
  }
  SUPABASE_CLIENT = window.supabase.createClient(url, key);
  return SUPABASE_CLIENT;
}

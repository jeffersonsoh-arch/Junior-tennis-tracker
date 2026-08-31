/* Shared Supabase email/password auth gate.
   Call requireAuth(function(client, session){ ... }) once per page; it
   renders a full-screen login/signup/reset form when there's no session
   and hands control to the callback once one exists. */

function authEscapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}

function authGateEl(){
  var el = document.getElementById("authgate");
  if (!el){
    el = document.createElement("div");
    el.id = "authgate";
    document.body.appendChild(el);
  }
  el.style.display = "flex";
  return el;
}

function hideAuthGate(){
  var el = document.getElementById("authgate");
  if (el) el.style.display = "none";
}

function renderAuthError(msg){
  var el = authGateEl();
  el.innerHTML = '<div class="auth-wrap"><div class="auth-card"><h2>Deuce Board</h2>'
    + '<p class="auth-error">' + authEscapeHtml(msg) + '</p></div></div>';
}

function renderAuthForm(client, mode, message){
  var el = authGateEl();
  var titles = {login:"Sign in to Deuce Board", signup:"Create your family account", recover:"Reset your password", newpassword:"Choose a new password"};
  var msgHtml = message ? '<p class="auth-msg">' + authEscapeHtml(message) + '</p>' : "";
  var fields;
  if (mode === "newpassword"){
    fields = '<input type="password" id="auth-pass1" class="auth-input" placeholder="New password" autocomplete="new-password" />'
      + '<button class="btn" id="auth-submit">Set new password</button>';
  } else if (mode === "recover"){
    fields = '<input type="email" id="auth-email" class="auth-input" placeholder="Email" autocomplete="email" />'
      + '<button class="btn" id="auth-submit">Send reset link</button>'
      + '<button class="btn secondary" id="auth-back">Back to sign in</button>';
  } else {
    fields = '<input type="email" id="auth-email" class="auth-input" placeholder="Email" autocomplete="email" />'
      + '<input type="password" id="auth-pass1" class="auth-input" placeholder="Password" autocomplete="' + (mode === "signup" ? "new-password" : "current-password") + '" />'
      + '<button class="btn" id="auth-submit">' + (mode === "signup" ? "Create account" : "Sign in") + '</button>'
      + '<button class="btn secondary" id="auth-toggle">' + (mode === "signup" ? "Already have an account? Sign in" : "New family? Create an account") + '</button>'
      + (mode === "login" ? '<button class="btn link" id="auth-forgot">Forgot password?</button>' : "");
  }
  el.innerHTML = '<div class="auth-wrap"><div class="auth-card"><h2>' + titles[mode] + '</h2>' + msgHtml
    + '<div class="auth-form">' + fields + '</div></div></div>';

  document.getElementById("auth-submit").addEventListener("click", function(){ submitAuthForm(client, mode); });
  var toggle = document.getElementById("auth-toggle");
  if (toggle) toggle.addEventListener("click", function(){ renderAuthForm(client, mode === "signup" ? "login" : "signup"); });
  var forgot = document.getElementById("auth-forgot");
  if (forgot) forgot.addEventListener("click", function(){ renderAuthForm(client, "recover"); });
  var back = document.getElementById("auth-back");
  if (back) back.addEventListener("click", function(){ renderAuthForm(client, "login"); });
  var input = document.getElementById("auth-email") || document.getElementById("auth-pass1");
  if (input) input.focus();
}

function submitAuthForm(client, mode){
  var emailEl = document.getElementById("auth-email"), passEl = document.getElementById("auth-pass1");
  var email = emailEl ? emailEl.value.trim() : "";
  var pass = passEl ? passEl.value : "";
  var btn = document.getElementById("auth-submit");
  btn.disabled = true; btn.textContent = "Please wait…";

  if (mode === "signup"){
    client.auth.signUp({ email: email, password: pass }).then(function(res){
      if (res.error){ renderAuthForm(client, "signup", res.error.message); return; }
      if (!res.data.session){ renderAuthForm(client, "login", "Account created — check your email to confirm, then sign in."); }
      /* if a session came back immediately, onAuthStateChange handles the rest */
    });
  } else if (mode === "login"){
    client.auth.signInWithPassword({ email: email, password: pass }).then(function(res){
      if (res.error){ renderAuthForm(client, "login", res.error.message); }
    });
  } else if (mode === "recover"){
    client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname }).then(function(res){
      if (res.error){ renderAuthForm(client, "recover", res.error.message); return; }
      renderAuthForm(client, "login", "Check your email for a reset link.");
    });
  } else if (mode === "newpassword"){
    client.auth.updateUser({ password: pass }).then(function(res){
      if (res.error){ renderAuthForm(client, "newpassword", res.error.message); return; }
      renderAuthForm(client, "login", "Password updated — sign in with your new password.");
    });
  }
}

function requireAuth(onReady){
  var client;
  try{ client = getSupabaseClient(); }
  catch(e){ renderAuthError(e.message); return; }

  var readyCalled = false;
  client.auth.onAuthStateChange(function(event, session){
    if (event === "PASSWORD_RECOVERY"){ renderAuthForm(client, "newpassword"); return; }
    if (session){
      hideAuthGate();
      if (!readyCalled){ readyCalled = true; onReady(client, session); }
    } else {
      readyCalled = false;
      renderAuthForm(client, "login");
    }
  });
}

function signOutAndReload(){
  var client;
  try{ client = getSupabaseClient(); } catch(e){ window.location.reload(); return; }
  client.auth.signOut().then(function(){ window.location.reload(); });
}

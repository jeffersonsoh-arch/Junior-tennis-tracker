/* =========================================================================
   AI Coach — a chat tab that asks the ai-coach Supabase Edge Function
   (assets/aiCoach.js -> supabase/functions/ai-coach) for drill/session
   ideas, and lets the user save any proposal it makes to this player's
   own ai_saved_items list. Reuses renderDayContent() from
   dashboardApp.js, since a proposal's `segments` are the same
   {label, minutes, text} shape as a generated plan day.
   ========================================================================= */

var aiState = { conversationId: null, messages: [], sending: false, savedItems: [], draftStructured: null };

/* Failure here (most likely: patch_ai_coach.sql hasn't been run yet on an
   existing database) must not break the rest of the dashboard — fall back
   to an empty AI Coach tab instead of rejecting the whole boot() chain. */
function loadAiCoach(client, playerId){
  return Promise.all([
    client.from("ai_conversations").select("*").eq("player_id", playerId).maybeSingle(),
    client.from("ai_saved_items").select("*").eq("player_id", playerId).order("created_at", {ascending: false})
  ]).then(function(results){
    var cRes = results[0], sRes = results[1];
    if (cRes.error) throw cRes.error;
    if (sRes.error) throw sRes.error;
    aiState.conversationId = cRes.data ? cRes.data.id : null;
    aiState.messages = (cRes.data && Array.isArray(cRes.data.messages)) ? cRes.data.messages : [];
    aiState.savedItems = sRes.data || [];
  }).catch(function(e){
    console.warn("AI Coach tables unavailable (has patch_ai_coach.sql been run?):", e);
  });
}

function persistAiConversation(){
  return authClient.from("ai_conversations")
    .upsert({ player_id: player.id, messages: aiState.messages, created_by: authUserId }, { onConflict: "player_id" })
    .then(function(res){ if (res.error) throw res.error; });
}

function scrollAiChatToBottom(){
  var el = document.getElementById("ai-chat-log");
  if (el) el.scrollTop = el.scrollHeight;
}

function sendAiMessage(text){
  var history = aiState.messages.slice();
  aiState.messages.push({role: "user", content: text});
  aiState.sending = true; aiState.draftStructured = null;
  rerender(); scrollAiChatToBottom();

  authClient.functions.invoke("ai-coach", { body: { playerId: player.id, message: text, history: history } })
    .then(function(res){
      if (res.error) throw res.error;
      var data = res.data || {};
      if (data.error) throw new Error(data.error);
      aiState.messages.push({role: "assistant", content: data.reply || ""});
      aiState.draftStructured = data.structured || null;
      aiState.sending = false;
      rerender(); scrollAiChatToBottom();
      persistAiConversation().catch(function(e){ console.warn("Could not save AI conversation:", e); });
    })
    .catch(function(e){
      aiState.messages.push({role: "assistant", content: "Sorry — I couldn't get a response (" + (e.message || e) + "). Please try again."});
      aiState.sending = false;
      rerender(); scrollAiChatToBottom();
    });
}

function saveAiProposal(){
  var s = aiState.draftStructured;
  if (!s) return;
  authClient.from("ai_saved_items").insert({
    player_id: player.id, kind: s.kind === "plan" ? "plan" : "drill",
    title: s.title, summary: s.summary || null, segments: s.segments || [], created_by: authUserId
  }).select().then(function(res){
    if (res.error) throw res.error;
    aiState.savedItems.unshift(res.data[0]);
    aiState.draftStructured = null;
    rerender(); showToast("Saved");
  }).catch(function(e){ alert("Could not save: " + e.message); });
}

function deleteAiSavedItem(id){
  authClient.from("ai_saved_items").delete().eq("id", id).then(function(res){
    if (res.error) throw res.error;
    aiState.savedItems = aiState.savedItems.filter(function(x){ return x.id !== id; });
    rerender(); showToast("Deleted");
  }).catch(function(e){ alert("Could not delete: " + e.message); });
}

function renderAiProposal(s){
  return '<div class="card ai-saved-card" style="border-color:var(--accent)"><div class="head"><div>'
    + '<span class="pill pill-accent kind-pill">'+escapeHtml(s.kind)+'</span> <b>'+escapeHtml(s.title)+'</b>'
    + (s.summary ? '<div class="meta" style="margin-top:4px">'+escapeHtml(s.summary)+'</div>' : "")
    + '</div></div>' + renderDayContent(s.segments || [])
    + '<div style="margin-top:10px"><button class="btn" data-action="aisaveproposal">Save to '+escapeHtml(player.name)+'’s drills</button> '
    + '<button class="btn secondary" data-action="aidiscardproposal">Discard</button></div></div>';
}

function renderAiSavedItem(item){
  return '<div class="card ai-saved-card"><div class="head"><div>'
    + '<span class="pill pill-muted kind-pill">'+escapeHtml(item.kind)+'</span> <b>'+escapeHtml(item.title)+'</b>'
    + (item.summary ? '<div class="meta" style="margin-top:4px">'+escapeHtml(item.summary)+'</div>' : "")
    + '</div><button class="btn secondary" data-action="aideleteitem" data-id="'+item.id+'">Delete</button></div>'
    + renderDayContent(item.segments || []) + '</div>';
}

function renderAiCoach(){
  var msgsHtml = aiState.messages.length
    ? aiState.messages.map(function(m){
        return '<div class="chat-msg '+(m.role === "user" ? "user" : "assistant")+'">'+escapeHtml(m.content)+'</div>';
      }).join("")
    : '<div class="empty-note">Ask about a drill, a tricky matchup, or a full session plan — the AI Coach already knows '+escapeHtml(player.name)+'’s pathway and current level.</div>';
  if (aiState.sending) msgsHtml += '<div class="chat-msg assistant pending">Thinking…</div>';

  var proposalHtml = aiState.draftStructured ? renderAiProposal(aiState.draftStructured) : "";
  var savedHtml = aiState.savedItems.length
    ? aiState.savedItems.map(renderAiSavedItem).join("")
    : '<div class="empty-note">Nothing saved yet — ask the AI Coach to create a drill or session plan, then save it here.</div>';

  return '<main><div class="page-head"><div><h1>AI Coach</h1><div class="meta">Chat about training ideas for '+escapeHtml(player.name)+'; save anything useful to their drill list.</div></div></div>'
    + '<div class="card"><div class="chat-log" id="ai-chat-log">'+msgsHtml+'</div>'
    + proposalHtml
    + '<div class="chat-input-row"><textarea id="ai-chat-input" placeholder="e.g. Suggest a 45-minute session focused on backhand slice and net play" '+(aiState.sending ? "disabled" : "")+'></textarea>'
    + '<button class="btn" data-action="aisend" '+(aiState.sending ? "disabled" : "")+'>Send</button></div></div>'
    + '<div class="section-title">Saved Drills &amp; Plans</div>'+savedHtml
    + '</main>';
}

/* =========================================================================
   Deuce Board — Joseph (NTRP 2.5, age 6, 3x/week)
   Red-ball → orange-ball pathway: stages + badges instead of quarters/NTRP.
   ========================================================================= */

var STORAGE_KEY = "deuceboard_joseph_v1";
var TOTAL_WEEKS = 52;
var DAYS_PER_WEEK = 3;
var CHECKIN_WEEKS = {1:13, 2:26, 3:39, 4:52};

function todayISO(){ return new Date().toISOString().slice(0,10); }

function currentWeekNumber(){
  var start = new Date(CURRICULUM.start_date + "T00:00:00");
  var now = new Date();
  var diffDays = Math.floor((now - start) / 86400000);
  var wk = Math.floor(diffDays / 7) + 1;
  if (wk < 1) return 1;
  if (wk > TOTAL_WEEKS) return TOTAL_WEEKS;
  return wk;
}
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}
function weekById(n){ return CURRICULUM.weeks[n-1]; }
function stageById(id){ return CURRICULUM.stages.find(function(s){ return s.id===id; }); }

function DEFAULT_STATE(){
  return {
    weeklyLog: {},
    badgeStatus: {},
    checkins: {
      "1": {longestRally:null, funMatches:null, coachNote:""},
      "2": {longestRally:null, funMatches:null, coachNote:""},
      "3": {longestRally:null, funMatches:null, coachNote:""},
      "4": {longestRally:null, funMatches:null, coachNote:""}
    },
    quizResults: {
      "1": {best:0,last:0,attempts:0,lastDate:""},
      "2": {best:0,last:0,attempts:0,lastDate:""},
      "3": {best:0,last:0,attempts:0,lastDate:""},
      "4": {best:0,last:0,attempts:0,lastDate:""}
    }
  };
}

var state = loadLocalState(STORAGE_KEY, DEFAULT_STATE);
var ui = {
  activeTab:"overview", selectedWeek: currentWeekNumber(), quizStage:1,
  quizAnswers:{1:{},2:{},3:{},4:{}}, quizSubmitted:{1:false,2:false,3:false,4:false}
};

var TABS = [
  {id:"overview", label:"Overview", icon:"overview"},
  {id:"log", label:"Weekly Log", icon:"log"},
  {id:"badges", label:"Skill Badges", icon:"badge"},
  {id:"checkins", label:"Check-Ins", icon:"bench"},
  {id:"quiz", label:"Strategy Quiz", icon:"quiz"}
];

/* ---------------------------- Derived stats ---------------------------- */
function dayDone(week,d){ var wl=state.weeklyLog[week]; return !!(wl && wl[d]); }
function weekDoneCount(week){ var n=0; ["d1","d2","d3"].forEach(function(d){ if (dayDone(week,d)) n++; }); return n; }
function totalSessionsDone(){ var n=0; for (var w=1; w<=TOTAL_WEEKS; w++) n+=weekDoneCount(w); return n; }
function stageCompletionPct(stageId){
  var s = stageById(stageId);
  var weeks = CURRICULUM.weeks.filter(function(w){ return w.stage_id===stageId; });
  var total = weeks.length*DAYS_PER_WEEK, done=0;
  weeks.forEach(function(w){ done += weekDoneCount(w.week); });
  return total ? Math.round((done/total)*100) : 0;
}
function badgesEarnedCount(stageId){
  var s = stageById(stageId), n=0;
  s.badges.forEach(function(_,i){ if (state.badgeStatus[stageId+"-"+i]) n++; });
  return n;
}
function totalBadgesEarned(){
  var n=0; CURRICULUM.stages.forEach(function(s){ n+=badgesEarnedCount(s.id); }); return n;
}
function currentStageId(){
  var wk = currentWeekNumber();
  var w = weekById(wk);
  return w.stage_id;
}
function nextCheckinInfo(){
  var wk = currentWeekNumber(); var order=[13,26,39,52];
  for (var i=0;i<order.length;i++){ if (order[i]>=wk) return {week:order[i], id:i+1, weeksAway:order[i]-wk}; }
  return null;
}
function bestQuizAverage(){
  var vals=[]; for (var i=1;i<=4;i++){ var r=state.quizResults[String(i)]; if (r && r.attempts>0) vals.push(r.best); }
  if (!vals.length) return null;
  return Math.round((vals.reduce(function(a,b){return a+b;},0)/vals.length)*10)/10;
}

/* ---------------------------- Renderers ---------------------------- */
function renderSidebar(){
  var tabsHtml = TABS.map(function(t){
    return '<button class="tab-btn '+(ui.activeTab===t.id?"active":"")+'" data-action="tab" data-tab="'+t.id+'">'+ICON[t.icon]+'<span>'+t.label+'</span></button>';
  }).join("");
  return '<div class="sidebar">'
    + '<a class="brand" href="../index.html">'+ICON.brand+'<div class="brand-text"><span class="name">Deuce Board</span><span class="sub">Junior Development Tracker</span></div></a>'
    + '<div class="player-box"><span class="p-label">Player</span><span class="p-name">Joseph</span><a href="../index.html">&larr; Switch player</a></div>'
    + '<nav class="tabs">'+tabsHtml+'</nav>'
    + '<div class="sidebar-foot">Season '+CURRICULUM.start_date+' &rarr; '+CURRICULUM.end_date+'<br/>NTRP 2.5 &middot; 3 sessions / week'
    + '<div class="data-tools" style="margin-top:10px"><button class="btn secondary" data-action="exportdata">Backup</button><button class="btn secondary" data-action="importdata">Restore</button></div>'
    + '</div></div>';
}

function renderOverview(){
  var wk = currentWeekNumber(), w = weekById(wk);
  var doneTotal = totalSessionsDone(), pct = Math.round((doneTotal/(TOTAL_WEEKS*DAYS_PER_WEEK))*100);
  var badges = totalBadgesEarned();
  var nc = nextCheckinInfo(); var avg = bestQuizAverage();
  var curStage = currentStageId();

  var bands = CURRICULUM.stages.map(function(s){
    return '<div class="q '+(s.id===w.stage_id?"current-q":"")+'">'+s.name+' &middot; wk '+s.wk[0]+'–'+s.wk[1]+'</div>';
  }).join("");
  var marks = [];
  [13,26,39,52].forEach(function(bw){ marks.push('<div class="tick" style="left:'+((bw-0.5)/52*100)+'%" title="Check-in week '+bw+'"></div>'); });
  [12,16,17].forEach(function(hw){ marks.push('<div class="tick holiday" style="left:'+((hw-0.5)/52*100)+'%" title="Holiday / optional week"></div>'); });
  marks.push('<div class="marker" style="left:'+((wk-0.5)/52*100)+'%"><span class="flag">Today &middot; Wk '+wk+'</span></div>');

  var stagePath = CURRICULUM.stages.map(function(s){
    var p = stageCompletionPct(s.id);
    var cls = s.id===curStage ? "current" : (p>=100 ? "complete" : "");
    return '<div class="stage-step '+cls+'"><div class="s-num">STAGE '+s.id+'</div><div class="s-name">'+s.name+'</div><div class="s-num" style="margin-top:4px">'+p+'% &middot; '+badgesEarnedCount(s.id)+'/6 badges</div></div>';
  }).join("");

  return '<main>'
    + '<div class="page-head"><div><h1>Welcome back, Joseph!</h1><div class="meta">Week '+wk+' of 52 &middot; Stage '+w.stage_id+' — '+w.stage_name+'</div></div></div>'
    + '<div class="timeline">'+bands+marks.join("")+'</div>'
    + '<div class="section-title">Stage Path</div>'
    + '<div class="stage-path">'+stagePath+'</div>'
    + '<div class="section-title">This Season</div>'
    + '<div class="grid stat-row">'
      + '<div class="card stat-tile"><span class="label">Sessions Completed</span><span class="value">'+doneTotal+'<span style="font-size:14px;color:var(--ink-faint)">/'+(TOTAL_WEEKS*DAYS_PER_WEEK)+'</span></span><span class="sub">'+pct+'% of the season</span></div>'
      + '<div class="card stat-tile"><span class="label">Badges Earned</span><span class="value">'+badges+'<span style="font-size:14px;color:var(--ink-faint)">/24</span></span><span class="sub">across all 4 stages</span></div>'
      + '<div class="card stat-tile"><span class="label">Best Quiz Score</span><span class="value">'+(avg!==null?avg:"–")+'<span style="font-size:14px;color:var(--ink-faint)">/3</span></span><span class="sub">across attempted stages</span></div>'
      + '<div class="card stat-tile"><span class="label">Next Check-In</span><span class="value">'+(nc?("Wk "+nc.week):"Done")+'</span><span class="sub">'+(nc?(nc.weeksAway<=0?"This week":nc.weeksAway+" week(s) away"):"Season complete")+'</span></div>'
    + '</div>'
    + '</main>';
}

function renderWeekDayRow(w, dnum){
  var key="d"+dnum, done=dayDone(w.week,key), labels=["Skill Builder","Rally Games","Play Day"], text=w["day"+dnum];
  return '<div class="day-row"><button class="day-check '+(done?"done":"")+'" data-action="toggleday" data-week="'+w.week+'" data-day="'+key+'" aria-label="Toggle Day '+dnum+'">'+ICON.check+'</button>'
    + '<div class="day-body"><div class="d-label">Day '+dnum+' &middot; '+labels[dnum-1]+'</div><div class="d-text">'+escapeHtml(text)+'</div></div></div>';
}

function renderWeeklyLog(){
  var wk = ui.selectedWeek, w = weekById(wk), wl = state.weeklyLog[wk] || {};
  var options = CURRICULUM.weeks.map(function(x){
    return '<option value="'+x.week+'" '+(x.week===wk?"selected":"")+'>Week '+x.week+' — '+x.start+'</option>';
  }).join("");
  var badges = '<span class="pill pill-accent">Stage '+w.stage_id+'</span><span class="pill pill-muted">'+escapeHtml(w.stage_name)+'</span>'
    + (w.is_checkpoint ? '<span class="pill pill-warn">Badge / Check-In Week</span>' : "")
    + (w.is_holiday ? '<span class="pill pill-muted">Holiday / Optional Week</span>' : "");
  var days = [1,2,3].map(function(d){ return renderWeekDayRow(w,d); }).join("");
  var stageCards = CURRICULUM.stages.map(function(s){
    var weeks = CURRICULUM.weeks.filter(function(x){ return x.stage_id===s.id; });
    var pct = stageCompletionPct(s.id);
    var rows = weeks.map(function(x){
      var cells = ["d1","d2","d3"].map(function(d){
        var on = dayDone(x.week,d);
        var cls = "heat-cell"+(on?" on":"")+(x.is_checkpoint?" bench":"")+(x.is_holiday && !on?" hol":"")+(x.week===wk?" selected":"");
        return '<div class="'+cls+'" data-action="goweek" data-week="'+x.week+'" title="Week '+x.week+'"></div>';
      }).join("");
      return '<div class="heat-row"><span class="wknum">'+x.week+'</span>'+cells+'</div>';
    }).join("");
    return '<div class="card heat-card" style="--ndays:3"><div class="heat-head"><span class="t">Stage '+s.id+' &middot; weeks '+weeks[0].week+'–'+weeks[weeks.length-1].week+'</span><span class="pct">'+pct+'%</span></div><div class="heat-rows">'+rows+'</div></div>';
  }).join("");
  return '<main>'
    + '<div class="page-head"><div><h1>Weekly Log</h1><div class="meta">Check off each of the week\'s 3 sessions; notes save automatically to this browser.</div></div></div>'
    + '<div class="week-nav"><button class="icon-btn" data-action="prevweek">'+ICON.chevL+'</button><select data-action="selectweek">'+options+'</select><button class="icon-btn" data-action="nextweek">'+ICON.chevR+'</button></div>'
    + '<div class="card week-card"><h3>Week '+w.week+' &middot; '+w.start+' – '+w.end+'</h3><div class="wk-badges">'+badges+'</div>'+days
    + '<textarea class="notes" data-action="weeknotes" data-week="'+w.week+'" placeholder="Coach notes for this week (optional)">'+escapeHtml(wl.note||"")+'</textarea></div>'
    + '<div class="section-title">Season at a Glance</div>'
    + '<div class="grid heat-wrap">'+stageCards+'</div>'
    + '</main>';
}

function renderBadges(){
  var stages = CURRICULUM.stages.map(function(s){
    var earned = badgesEarnedCount(s.id);
    var items = s.badges.map(function(name,i){
      var key = s.id+"-"+i, on = !!state.badgeStatus[key];
      return '<div class="badge '+(on?"earned":"")+'" data-action="togglebadge" data-key="'+key+'">'
        + '<div class="ring">'+ICON.check+'</div><div class="b-name">'+escapeHtml(name)+'</div></div>';
    }).join("");
    return '<div class="skill-cat"><div class="cat-head"><span class="cat-dot" style="background:var(--accent)"></span><h3>Stage '+s.id+' — '+s.name+'</h3><span class="cat-frac">'+earned+'/6 earned</span></div>'
      + '<div class="cat-bar"><div class="cat-bar-fill" style="width:'+Math.round(earned/6*100)+'%;background:var(--accent)"></div></div>'
      + '<p style="color:var(--ink-soft); font-size:13px; margin:0 0 12px">'+escapeHtml(s.blurb)+'</p>'
      + '<div class="badge-grid">'+items+'</div></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Skill Badges</h1><div class="meta">Tap a badge to mark it earned &middot; 6 badges per stage, 24 for the season</div></div></div>'+stages+'</main>';
}

function renderCheckins(){
  var cards = [1,2,3,4].map(function(c){
    var s = stageById(c), data = state.checkins[String(c)], wk = CHECKIN_WEEKS[c], w = weekById(wk);
    var field = function(labelText, key){
      var v = data[key];
      return '<div class="field-row"><label>'+labelText+'</label><input type="number" inputmode="numeric" data-action="checkinfield" data-checkin="'+c+'" data-field="'+key+'" value="'+(v===null||v===undefined?"":v)+'" placeholder="–" /></div>';
    };
    return '<div class="card bench-card"><h3>Check-In '+c+' &middot; Week '+wk+'</h3><div class="bdate">'+w.start+' &middot; end of Stage '+c+' ('+s.name+')</div>'
      + field("Longest rally (balls in a row)","longestRally") + field("Fun matches played","funMatches")
      + '<div class="field-row"><label>Badges earned so far</label><input value="'+badgesEarnedCount(c)+' / 6" disabled style="text-align:right;color:var(--ink-faint)"/></div>'
      + '<textarea class="bench-notes" data-action="checkinnotes" data-checkin="'+c+'" placeholder="How did this stage go?">'+escapeHtml(data.coachNote||"")+'</textarea></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Check-Ins</h1><div class="meta">Four easy check-ins across the season — weeks 13, 26, 39 &amp; 52</div></div></div><div class="grid bench-grid">'+cards+'</div></main>';
}

function renderQuiz(){
  var sid = ui.quizStage, sdata = QUIZDATA.stages[sid-1], results = state.quizResults[String(sid)], answers = ui.quizAnswers[sid], submitted = ui.quizSubmitted[sid];
  var tabs = [1,2,3,4].map(function(s){
    var r = state.quizResults[String(s)];
    return '<button class="qtab '+(s===sid?"active":"")+'" data-action="qtab" data-quarter="'+s+'">'+QUIZDATA.stages[s-1].name+(r.attempts>0?' &middot; best '+r.best+'/3':"")+'</button>';
  }).join("");
  var banner = "";
  if (submitted){
    var score=0; sdata.questions.forEach(function(q,i){ if (answers[i]===q.correct) score++; });
    banner = '<div class="score-banner"><span class="big">'+score+'/3</span><span>Best: '+results.best+'/3 &middot; Attempts: '+results.attempts+'</span>'
      + '<button class="btn secondary" data-action="retakequiz" data-quarter="'+sid+'" style="margin-left:auto">Try Again</button></div>';
  }
  var qitems = sdata.questions.map(function(q,i){
    var opts = q.options.map(function(opt,oi){
      var cls=""; var chosen=answers[i];
      if (submitted){ if (oi===q.correct) cls="correct"; else if (oi===chosen) cls="incorrect"; }
      var checked = chosen===oi?"checked":"";
      return '<label class="q-opt '+cls+'"><input type="radio" name="q'+sid+'_'+i+'" value="'+oi+'" data-action="quizanswer" data-q="'+i+'" '+checked+' '+(submitted?"disabled":"")+' /> '+escapeHtml(opt)+'</label>';
    }).join("");
    var explain = submitted ? '<div class="q-explain">'+escapeHtml(q.explain)+'</div>' : "";
    return '<div class="q-item"><div class="q-text">'+(i+1)+'. '+escapeHtml(q.q)+'</div><div class="q-opts">'+opts+'</div>'+explain+'</div>';
  }).join("");
  var submitBtn = submitted ? "" : '<div style="margin-top:16px"><button class="btn" data-action="submitquiz" data-quarter="'+sid+'">Check My Answers</button></div>';
  return '<main><div class="page-head"><div><h1>Strategy Quiz</h1><div class="meta">Simple tennis IQ questions &middot; 3 per stage, read aloud together if helpful</div></div></div>'
    + '<div class="quarter-tabs">'+tabs+'</div>'+banner+'<div class="card">'+qitems+submitBtn+'</div></main>';
}

function renderApp(){
  var mainHtml;
  if (ui.activeTab==="log") mainHtml=renderWeeklyLog();
  else if (ui.activeTab==="badges") mainHtml=renderBadges();
  else if (ui.activeTab==="checkins") mainHtml=renderCheckins();
  else if (ui.activeTab==="quiz") mainHtml=renderQuiz();
  else mainHtml=renderOverview();
  return renderSidebar()+mainHtml;
}

/* ---------------------------- Persistence ---------------------------- */
var persistTimer=null;
function showToast(msg){ var t=document.getElementById("toast"); if(!t) return; t.textContent=msg; t.classList.add("show"); setTimeout(function(){t.classList.remove("show");},1400); }
function schedulePersist(){ if (persistTimer) clearTimeout(persistTimer); persistTimer=setTimeout(function(){ saveLocalState(STORAGE_KEY,state); showToast("Saved"); },500); }

function rerender(){ document.getElementById("app").innerHTML = renderApp(); }

function onClick(e){
  var el = e.target.closest("[data-action]");
  if (!el) return;
  var action = el.getAttribute("data-action");
  if (action==="tab"){ ui.activeTab=el.getAttribute("data-tab"); rerender(); }
  else if (action==="goweek"){ ui.selectedWeek=+el.getAttribute("data-week"); ui.activeTab="log"; rerender(); }
  else if (action==="prevweek"){ ui.selectedWeek=Math.max(1,ui.selectedWeek-1); rerender(); }
  else if (action==="nextweek"){ ui.selectedWeek=Math.min(52,ui.selectedWeek+1); rerender(); }
  else if (action==="toggleday"){
    var wk=+el.getAttribute("data-week"), day=el.getAttribute("data-day");
    if (!state.weeklyLog[wk]) state.weeklyLog[wk]={d1:false,d2:false,d3:false,note:""};
    state.weeklyLog[wk][day]=!state.weeklyLog[wk][day];
    rerender(); schedulePersist();
  }
  else if (action==="togglebadge"){
    var key = el.getAttribute("data-key");
    state.badgeStatus[key] = !state.badgeStatus[key];
    rerender(); schedulePersist();
  }
  else if (action==="qtab"){ ui.quizStage=+el.getAttribute("data-quarter"); rerender(); }
  else if (action==="submitquiz"){
    var sid=+el.getAttribute("data-quarter"), sdata=QUIZDATA.stages[sid-1], answers=ui.quizAnswers[sid], score=0;
    sdata.questions.forEach(function(q,i){ if (answers[i]===q.correct) score++; });
    var r=state.quizResults[String(sid)]; r.last=score; r.best=Math.max(r.best,score); r.attempts+=1; r.lastDate=todayISO();
    ui.quizSubmitted[sid]=true; rerender(); schedulePersist();
  }
  else if (action==="retakequiz"){ var rq=+el.getAttribute("data-quarter"); ui.quizAnswers[rq]={}; ui.quizSubmitted[rq]=false; rerender(); }
  else if (action==="exportdata"){ downloadJson("joseph-tennis-backup-"+todayISO()+".json", state); showToast("Backup downloaded"); }
  else if (action==="importdata"){
    uploadJson(function(parsed){
      if (parsed && typeof parsed==="object" && parsed.weeklyLog){ state=parsed; saveLocalState(STORAGE_KEY,state); rerender(); showToast("Progress restored"); }
      else alert("That file doesn't look like a Joseph backup.");
    });
  }
}

function onChange(e){
  var el = e.target, action = el.getAttribute && el.getAttribute("data-action");
  if (action==="selectweek"){ ui.selectedWeek=+el.value; rerender(); }
  else if (action==="weeknotes"){
    var wk=+el.getAttribute("data-week");
    if (!state.weeklyLog[wk]) state.weeklyLog[wk]={d1:false,d2:false,d3:false,note:""};
    state.weeklyLog[wk].note=el.value; schedulePersist();
  }
  else if (action==="checkinfield"){
    var c=el.getAttribute("data-checkin"), field=el.getAttribute("data-field"), val=el.value;
    val = val===""?null:(+val);
    state.checkins[c][field]=val; schedulePersist();
  }
  else if (action==="checkinnotes"){ var cn=el.getAttribute("data-checkin"); state.checkins[cn].coachNote=el.value; schedulePersist(); }
  else if (action==="quizanswer"){ var qi=+el.getAttribute("data-q"); ui.quizAnswers[ui.quizStage][qi]=+el.value; }
}

function init(){
  document.getElementById("app").innerHTML = renderApp();
  document.getElementById("app").addEventListener("click", onClick);
  document.getElementById("app").addEventListener("change", onChange);
}
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", init); else init();

/* =========================================================================
   Deuce Board — Judah (NTRP 3.5, age 10, 4x/week)
   Static-site version: persistence via localStorage + JSON export/import.
   ========================================================================= */

var STORAGE_KEY = "deuceboard_judah_v1";
var TOTAL_WEEKS = 52;
var BENCH_WEEKS = {1:13, 2:26, 3:39, 4:52};
var CAT_KEYS = ["technical","tactical","physical","mental"];
var CAT_LABELS = {technical:"Technical", tactical:"Tactical", physical:"Physical", mental:"Mental / Routine"};

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

function DEFAULT_STATE(){
  return {
    weeklyLog: {},
    skillStatus: {},
    benchmarks: {
      "1": {servePct:null, rallyBalls:null, agilitySec:null, matches:null, wins:null, coachRating:null, ntrp:"", notes:""},
      "2": {servePct:null, rallyBalls:null, agilitySec:null, matches:null, wins:null, coachRating:null, ntrp:"", notes:""},
      "3": {servePct:null, rallyBalls:null, agilitySec:null, matches:null, wins:null, coachRating:null, ntrp:"", notes:""},
      "4": {servePct:null, rallyBalls:null, agilitySec:null, matches:null, wins:null, coachRating:null, ntrp:"", notes:""}
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
  activeTab: "overview",
  selectedWeek: currentWeekNumber(),
  quizQuarter: 1,
  quizAnswers: {1:{},2:{},3:{},4:{}},
  quizSubmitted: {1:false,2:false,3:false,4:false}
};

var TABS = [
  {id:"overview", label:"Overview", icon:"overview"},
  {id:"log", label:"Weekly Log", icon:"log"},
  {id:"skills", label:"Skill Checklist", icon:"skills"},
  {id:"benchmarks", label:"Benchmarks", icon:"bench"},
  {id:"quiz", label:"Strategy Quiz", icon:"quiz"}
];

/* ---------------------------- Derived stats ---------------------------- */
function dayDone(week, d){ var wl = state.weeklyLog[week]; return !!(wl && wl[d]); }
function weekDoneCount(week){ var n=0; ["d1","d2","d3","d4"].forEach(function(d){ if (dayDone(week,d)) n++; }); return n; }
function totalSessionsDone(){ var n=0; for (var w=1; w<=TOTAL_WEEKS; w++) n += weekDoneCount(w); return n; }
function quarterCompletionPct(q){
  var weeks = CURRICULUM.weeks.filter(function(w){ return w.quarter === q; });
  var total = weeks.length * 4, done = 0;
  weeks.forEach(function(w){ done += weekDoneCount(w.week); });
  return total ? Math.round((done/total)*100) : 0;
}
function skillsMasteredCount(){
  var n=0;
  CURRICULUM.blocks.forEach(function(b){ CAT_KEYS.forEach(function(c){ if (state.skillStatus[b.id+"-"+c]==="mastered") n++; }); });
  return n;
}
function catMasteredCount(cat){
  var n=0;
  CURRICULUM.blocks.forEach(function(b){ if (state.skillStatus[b.id+"-"+cat]==="mastered") n++; });
  return n;
}
function nextBenchmarkInfo(){
  var wk = currentWeekNumber(); var order=[13,26,39,52];
  for (var i=0;i<order.length;i++){ if (order[i] >= wk) return {week:order[i], id:i+1, weeksAway: order[i]-wk}; }
  return null;
}
function bestQuizAverage(){
  var vals=[];
  for (var i=1;i<=4;i++){ var r=state.quizResults[String(i)]; if (r && r.attempts>0) vals.push(r.best); }
  if (!vals.length) return null;
  return Math.round((vals.reduce(function(a,b){return a+b;},0)/vals.length)*10)/10;
}

/* ---------------------------- Small chart helpers ---------------------------- */
function sparklineSvg(points){
  var have=[];
  points.forEach(function(v,i){ if (v!==null && v!==undefined && v!=="") have.push({i:i, v:+v}); });
  if (have.length < 2) return '<div class="empty-note">Add at least two benchmark entries to see a trend.</div>';
  var w=200,h=52,padX=8,padY=8;
  var xs = have.map(function(p){ return padX + (p.i/3)*(w-padX*2); });
  var vals = have.map(function(p){return p.v;});
  var min=Math.min.apply(null,vals), max=Math.max.apply(null,vals);
  if (min===max){min-=1;max+=1;}
  var ys = vals.map(function(v){ return h-padY-((v-min)/(max-min))*(h-padY*2); });
  var pts = xs.map(function(x,i){ return x.toFixed(1)+","+ys[i].toFixed(1); }).join(" ");
  var last = have.length-1;
  var areaPts = "0,"+h+" "+pts+" "+xs[last].toFixed(1)+","+h;
  var dots = have.map(function(p,i){
    var r=(i===last)?3.6:2.4, fill=(i===last)?"var(--accent)":"var(--ink-faint)";
    return '<circle cx="'+xs[i].toFixed(1)+'" cy="'+ys[i].toFixed(1)+'" r="'+r+'" fill="'+fill+'"/>';
  }).join("");
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><polygon points="'+areaPts+'" fill="var(--accent-soft)" stroke="none"/>'
    + '<polyline points="'+pts+'" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' + dots + '</svg>';
}
function trendChip(points, lowerBetter){
  var have=[]; points.forEach(function(v){ if (v!==null&&v!==undefined&&v!=="") have.push(+v); });
  if (have.length<2) return "";
  var first=have[0], last=have[have.length-1];
  var improved = lowerBetter ? (last<first) : (last>first);
  var same = last===first;
  var cls = same?"pill-muted":(improved?"pill-good":"pill-warn");
  var sym = same?"–":(improved?"▲":"▼");
  return '<span class="pill '+cls+'">'+sym+' '+Math.abs(Math.round((last-first)*10)/10)+'</span>';
}

/* ---------------------------- Renderers ---------------------------- */
function renderSidebar(){
  var tabsHtml = TABS.map(function(t){
    return '<button class="tab-btn '+(ui.activeTab===t.id?"active":"")+'" data-action="tab" data-tab="'+t.id+'">'
      + ICON[t.icon] + '<span>' + t.label + '</span></button>';
  }).join("");
  return '<div class="sidebar">'
    + '<a class="brand" href="../index.html">' + ICON.brand + '<div class="brand-text"><span class="name">Deuce Board</span><span class="sub">Junior Development Tracker</span></div></a>'
    + '<div class="player-box"><span class="p-label">Player</span><span class="p-name">Judah</span><a href="../index.html">&larr; Switch player</a></div>'
    + '<nav class="tabs">' + tabsHtml + '</nav>'
    + '<div class="sidebar-foot">Season '+CURRICULUM.start_date+' &rarr; '+CURRICULUM.end_date+'<br/>NTRP 3.5 &middot; 4 sessions / week'
    + '<div class="data-tools" style="margin-top:10px"><button class="btn secondary" data-action="exportdata">Backup</button><button class="btn secondary" data-action="importdata">Restore</button></div>'
    + '</div>'
    + '</div>';
}

function renderOverview(){
  var wk = currentWeekNumber();
  var w = weekById(wk);
  var doneTotal = totalSessionsDone();
  var pct = Math.round((doneTotal/(TOTAL_WEEKS*4))*100);
  var mastered = skillsMasteredCount();
  var nb = nextBenchmarkInfo();
  var avg = bestQuizAverage();

  var quarterBands = [1,2,3,4].map(function(q){
    var weeksInQ = CURRICULUM.weeks.filter(function(x){return x.quarter===q;});
    var range = weeksInQ[0].week + "–" + weeksInQ[weeksInQ.length-1].week;
    return '<div class="q '+(w.quarter===q?"current-q":"")+'">Q'+q+' &middot; wk '+range+'</div>';
  }).join("");

  var marks = [];
  [13,26,39,52].forEach(function(bw){ marks.push('<div class="tick" style="left:'+((bw-0.5)/52*100)+'%" title="Benchmark week '+bw+'"></div>'); });
  [12,16,17].forEach(function(hw){ marks.push('<div class="tick holiday" style="left:'+((hw-0.5)/52*100)+'%" title="Holiday / flex week"></div>'); });
  marks.push('<div class="marker" style="left:'+((wk-0.5)/52*100)+'%"><span class="flag">Today &middot; Wk '+wk+'</span></div>');

  var bars = [1,2,3,4].map(function(q){
    var p = quarterCompletionPct(q);
    return '<div class="bar-col"><div class="bar-track"><div class="bar-fill" style="height:'+p+'%"></div></div>'
      + '<div class="bar-value">'+p+'%</div><div class="bar-label">Q'+q+'</div></div>';
  }).join("");

  var metrics = [
    {key:"servePct", label:"Serve Consistency", unit:"%", lowerBetter:false},
    {key:"rallyBalls", label:"Rally Tolerance", unit:" balls", lowerBetter:false},
    {key:"agilitySec", label:"Agility (5-10-5)", unit:"s", lowerBetter:true},
    {key:"coachRating", label:"Coach Tactical Rating", unit:"/5", lowerBetter:false}
  ];
  var sparkCards = metrics.map(function(m){
    var pts = [1,2,3,4].map(function(b){ return state.benchmarks[String(b)][m.key]; });
    var last=null; for (var i=3;i>=0;i--){ if (pts[i]!==null&&pts[i]!==undefined&&pts[i]!==""){ last=pts[i]; break; } }
    return '<div class="card spark-card"><div class="spark-head"><span class="t">'+m.label+'</span>'
      + '<span class="v">'+(last!==null?(last+m.unit):"–")+' '+trendChip(pts,m.lowerBetter)+'</span></div>' + sparklineSvg(pts) + '</div>';
  }).join("");

  return '<main>'
    + '<div class="page-head"><div><h1>Welcome back, Judah</h1><div class="meta">Week '+wk+' of 52 &middot; '+w.quarter_name+'</div></div></div>'
    + '<div class="timeline">' + quarterBands + marks.join("") + '</div>'
    + '<div class="section-title">This Season</div>'
    + '<div class="grid stat-row">'
      + '<div class="card stat-tile"><span class="label">Sessions Completed</span><span class="value">'+doneTotal+'<span style="font-size:14px;color:var(--ink-faint)">/'+(TOTAL_WEEKS*4)+'</span></span><span class="sub">'+pct+'% of the season</span></div>'
      + '<div class="card stat-tile"><span class="label">Skills Mastered</span><span class="value">'+mastered+'<span style="font-size:14px;color:var(--ink-faint)">/48</span></span><span class="sub">across all 4 categories</span></div>'
      + '<div class="card stat-tile"><span class="label">Best Quiz Average</span><span class="value">'+(avg!==null?avg:"–")+'<span style="font-size:14px;color:var(--ink-faint)">/10</span></span><span class="sub">across attempted quarters</span></div>'
      + '<div class="card stat-tile"><span class="label">Next Benchmark</span><span class="value">'+(nb?("Wk "+nb.week):"Done")+'</span><span class="sub">'+(nb?(nb.weeksAway<=0?"This week":nb.weeksAway+" week(s) away"):"Season complete")+'</span></div>'
    + '</div>'
    + '<div class="section-title">Completion by Quarter</div>'
    + '<div class="card"><div class="barchart">'+bars+'</div></div>'
    + '<div class="section-title">Benchmark Trends</div>'
    + '<div class="grid spark-grid">' + sparkCards + '</div>'
    + '</main>';
}

function renderWeekDayRow(w, dnum){
  var key="d"+dnum, done=dayDone(w.week,key), text=w["day"+dnum];
  return '<div class="day-row"><button class="day-check '+(done?"done":"")+'" data-action="toggleday" data-week="'+w.week+'" data-day="'+key+'" aria-label="Toggle Day '+dnum+'">'+ICON.check+'</button>'
    + '<div class="day-body"><div class="d-label">Day '+dnum+'</div><div class="d-text">'+escapeHtml(text)+'</div></div></div>';
}

function renderWeeklyLog(){
  var wk = ui.selectedWeek, w = weekById(wk), wl = state.weeklyLog[wk] || {};
  var options = CURRICULUM.weeks.map(function(x){
    return '<option value="'+x.week+'" '+(x.week===wk?"selected":"")+'>Week '+x.week+' — '+x.start+' ('+x.week_label+')</option>';
  }).join("");
  var badges = '<span class="pill pill-accent">'+w.quarter_name.split(" — ")[0]+'</span>'
    + '<span class="pill pill-muted">'+escapeHtml(w.block_title)+'</span>'
    + '<span class="pill pill-muted">'+escapeHtml(w.week_label)+'</span>'
    + (w.is_benchmark ? '<span class="pill pill-warn">Benchmark Week</span>' : "")
    + (w.is_holiday ? '<span class="pill pill-muted">Holiday / Flex Week</span>' : "");
  var days = [1,2,3,4].map(function(d){ return renderWeekDayRow(w,d); }).join("");
  var heatCards = [1,2,3,4].map(function(q){
    var weeks = CURRICULUM.weeks.filter(function(x){return x.quarter===q;});
    var pct = quarterCompletionPct(q);
    var rows = weeks.map(function(x){
      var cells = ["d1","d2","d3","d4"].map(function(d){
        var on = dayDone(x.week,d);
        var cls = "heat-cell"+(on?" on":"")+(x.is_benchmark?" bench":"")+(x.is_holiday && !on?" hol":"")+(x.week===wk?" selected":"");
        return '<div class="'+cls+'" data-action="goweek" data-week="'+x.week+'" title="Week '+x.week+'"></div>';
      }).join("");
      return '<div class="heat-row"><span class="wknum">'+x.week+'</span>'+cells+'</div>';
    }).join("");
    return '<div class="card heat-card" style="--ndays:4"><div class="heat-head"><span class="t">Q'+q+' &middot; weeks '+weeks[0].week+'–'+weeks[weeks.length-1].week+'</span><span class="pct">'+pct+'%</span></div><div class="heat-rows">'+rows+'</div></div>';
  }).join("");
  return '<main>'
    + '<div class="page-head"><div><h1>Weekly Log</h1><div class="meta">Check off each session as it happens; notes save automatically to this browser.</div></div></div>'
    + '<div class="week-nav"><button class="icon-btn" data-action="prevweek">'+ICON.chevL+'</button><select data-action="selectweek">'+options+'</select><button class="icon-btn" data-action="nextweek">'+ICON.chevR+'</button></div>'
    + '<div class="card week-card"><h3>Week '+w.week+' &middot; '+w.start+' – '+w.end+'</h3><div class="wk-badges">'+badges+'</div>'+days
    + '<textarea class="notes" data-action="weeknotes" data-week="'+w.week+'" placeholder="Coach notes for this week (optional)">'+escapeHtml(wl.note||"")+'</textarea></div>'
    + '<div class="section-title">Season at a Glance</div>'
    + '<div class="grid heat-wrap">' + heatCards + '</div>'
    + '</main>';
}

function renderSkills(){
  var cats = CAT_KEYS.map(function(cat){
    var m = catMasteredCount(cat), pct = Math.round((m/12)*100);
    var items = CURRICULUM.blocks.map(function(b){
      var key = b.id+"-"+cat, val = state.skillStatus[key] || "not-started";
      var text = b[cat==="technical"?"tech":cat==="tactical"?"tact":cat==="physical"?"phys":"ment"];
      return '<div class="skill-item"><span class="s-text">'+escapeHtml(text)+'</span><span class="s-week">Wk '+b.wk[0]+'–'+b.wk[1]+'</span>'
        + '<select class="status-select" data-action="statuschange" data-block="'+b.id+'" data-cat="'+cat+'">'
        + '<option value="not-started" '+(val==="not-started"?"selected":"")+'>Not started</option>'
        + '<option value="in-progress" '+(val==="in-progress"?"selected":"")+'>In progress</option>'
        + '<option value="mastered" '+(val==="mastered"?"selected":"")+'>Mastered</option></select></div>';
    }).join("");
    return '<div class="skill-cat"><div class="cat-head"><span class="cat-dot" style="background:var(--cat-'+cat+')"></span><h3>'+CAT_LABELS[cat]+'</h3><span class="cat-frac">'+m+'/12 mastered</span></div>'
      + '<div class="cat-bar"><div class="cat-bar-fill" style="width:'+pct+'%;background:var(--cat-'+cat+')"></div></div><div class="card">'+items+'</div></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Skill Checklist</h1><div class="meta">One skill focus per training block &middot; 12 blocks &times; 4 categories</div></div></div>'+cats+'</main>';
}

function renderBenchmarks(){
  var cards = [1,2,3,4].map(function(b){
    var data = state.benchmarks[String(b)], wk = BENCH_WEEKS[b], w = weekById(wk);
    var field = function(labelText, key){
      var v = data[key];
      return '<div class="field-row"><label>'+labelText+'</label><input type="number" inputmode="decimal" data-action="benchfield" data-bench="'+b+'" data-field="'+key+'" value="'+(v===null||v===undefined?"":v)+'" placeholder="–" /></div>';
    };
    return '<div class="card bench-card"><h3>Benchmark '+b+' &middot; Week '+wk+'</h3><div class="bdate">'+w.start+' &middot; '+w.block_title+'</div>'
      + field("Serve consistency (%)","servePct") + field("Rally tolerance (balls)","rallyBalls") + field("Agility 5-10-5 (sec)","agilitySec")
      + field("Matches played","matches") + field("Matches won","wins") + field("Coach tactical rating (1–5)","coachRating")
      + '<div class="field-row"><label>NTRP self-assessment</label><select data-action="benchfield" data-bench="'+b+'" data-field="ntrp">'
      + ['','2.5','3.0','3.5','4.0'].map(function(v){ return '<option value="'+v+'" '+(data.ntrp===v?"selected":"")+'>'+(v||"–")+'</option>'; }).join("") + '</select></div>'
      + '<textarea class="bench-notes" data-action="benchnotes" data-bench="'+b+'" placeholder="Notes on this benchmark session">'+escapeHtml(data.notes||"")+'</textarea></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Benchmarks</h1><div class="meta">Testing weeks: 13, 26, 39 &amp; 52 &middot; enter results as they happen</div></div></div><div class="grid bench-grid">'+cards+'</div></main>';
}

function renderQuiz(){
  var qid = ui.quizQuarter, qdata = QUIZDATA.quarters[qid-1], results = state.quizResults[String(qid)], answers = ui.quizAnswers[qid], submitted = ui.quizSubmitted[qid];
  var tabs = [1,2,3,4].map(function(q){
    var r = state.quizResults[String(q)];
    return '<button class="qtab '+(q===qid?"active":"")+'" data-action="qtab" data-quarter="'+q+'">'+QUIZDATA.quarters[q-1].name+(r.attempts>0?' &middot; best '+r.best+'/10':"")+'</button>';
  }).join("");
  var banner = "";
  if (submitted){
    var score=0; qdata.questions.forEach(function(q,i){ if (answers[i]===q.correct) score++; });
    banner = '<div class="score-banner"><span class="big">'+score+'/10</span><span>Best: '+results.best+'/10 &middot; Attempts: '+results.attempts+'</span>'
      + '<button class="btn secondary" data-action="retakequiz" data-quarter="'+qid+'" style="margin-left:auto">Retake Quarter</button></div>';
  }
  var qitems = qdata.questions.map(function(q,i){
    var opts = q.options.map(function(opt,oi){
      var cls=""; var chosen=answers[i];
      if (submitted){ if (oi===q.correct) cls="correct"; else if (oi===chosen) cls="incorrect"; }
      var checked = chosen===oi?"checked":"";
      return '<label class="q-opt '+cls+'"><input type="radio" name="q'+qid+'_'+i+'" value="'+oi+'" data-action="quizanswer" data-q="'+i+'" '+checked+' '+(submitted?"disabled":"")+' /> '+escapeHtml(opt)+'</label>';
    }).join("");
    var explain = submitted ? '<div class="q-explain"><strong>Why: </strong>'+escapeHtml(q.explain)+'</div>' : "";
    return '<div class="q-item"><div class="q-text">'+(i+1)+'. '+escapeHtml(q.q)+'</div><div class="q-opts">'+opts+'</div>'+explain+'</div>';
  }).join("");
  var submitBtn = submitted ? "" : '<div style="margin-top:16px"><button class="btn" data-action="submitquiz" data-quarter="'+qid+'">Submit Answers</button></div>';
  return '<main><div class="page-head"><div><h1>Strategy Quiz</h1><div class="meta">Tactical decision-making, multiple choice &middot; 10 questions per quarter</div></div></div>'
    + '<div class="quarter-tabs">'+tabs+'</div>'+banner+'<div class="card">'+qitems+submitBtn+'</div></main>';
}

function renderApp(){
  var mainHtml;
  if (ui.activeTab==="log") mainHtml=renderWeeklyLog();
  else if (ui.activeTab==="skills") mainHtml=renderSkills();
  else if (ui.activeTab==="benchmarks") mainHtml=renderBenchmarks();
  else if (ui.activeTab==="quiz") mainHtml=renderQuiz();
  else mainHtml=renderOverview();
  return renderSidebar()+mainHtml;
}

/* ---------------------------- Persistence ---------------------------- */
var persistTimer=null;
function showToast(msg){ var t=document.getElementById("toast"); if(!t) return; t.textContent=msg; t.classList.add("show"); setTimeout(function(){t.classList.remove("show");},1400); }
function schedulePersist(){ if (persistTimer) clearTimeout(persistTimer); persistTimer=setTimeout(function(){ saveLocalState(STORAGE_KEY,state); showToast("Saved"); },500); }

/* ---------------------------- Event wiring ---------------------------- */
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
    if (!state.weeklyLog[wk]) state.weeklyLog[wk]={d1:false,d2:false,d3:false,d4:false,note:""};
    state.weeklyLog[wk][day]=!state.weeklyLog[wk][day];
    rerender(); schedulePersist();
  }
  else if (action==="qtab"){ ui.quizQuarter=+el.getAttribute("data-quarter"); rerender(); }
  else if (action==="submitquiz"){
    var qid=+el.getAttribute("data-quarter"), qdata=QUIZDATA.quarters[qid-1], answers=ui.quizAnswers[qid], score=0;
    qdata.questions.forEach(function(q,i){ if (answers[i]===q.correct) score++; });
    var r=state.quizResults[String(qid)]; r.last=score; r.best=Math.max(r.best,score); r.attempts+=1; r.lastDate=todayISO();
    ui.quizSubmitted[qid]=true; rerender(); schedulePersist();
  }
  else if (action==="retakequiz"){ var rq=+el.getAttribute("data-quarter"); ui.quizAnswers[rq]={}; ui.quizSubmitted[rq]=false; rerender(); }
  else if (action==="exportdata"){ downloadJson("judah-tennis-backup-"+todayISO()+".json", state); showToast("Backup downloaded"); }
  else if (action==="importdata"){
    uploadJson(function(parsed){
      if (parsed && typeof parsed==="object" && parsed.weeklyLog){ state=parsed; saveLocalState(STORAGE_KEY,state); rerender(); showToast("Progress restored"); }
      else alert("That file doesn't look like a Judah backup.");
    });
  }
}

function onChange(e){
  var el = e.target, action = el.getAttribute && el.getAttribute("data-action");
  if (action==="selectweek"){ ui.selectedWeek=+el.value; rerender(); }
  else if (action==="weeknotes"){
    var wk=+el.getAttribute("data-week");
    if (!state.weeklyLog[wk]) state.weeklyLog[wk]={d1:false,d2:false,d3:false,d4:false,note:""};
    state.weeklyLog[wk].note=el.value; schedulePersist();
  }
  else if (action==="statuschange"){
    var bId=el.getAttribute("data-block"), cat=el.getAttribute("data-cat");
    state.skillStatus[bId+"-"+cat]=el.value; rerender(); schedulePersist();
  }
  else if (action==="benchfield"){
    var b=el.getAttribute("data-bench"), field=el.getAttribute("data-field"), val=el.value;
    if (field!=="ntrp") val = val===""?null:(+val);
    state.benchmarks[b][field]=val; rerender(); schedulePersist();
  }
  else if (action==="benchnotes"){ var bn=el.getAttribute("data-bench"); state.benchmarks[bn].notes=el.value; schedulePersist(); }
  else if (action==="quizanswer"){ var qi=+el.getAttribute("data-q"); ui.quizAnswers[ui.quizQuarter][qi]=+el.value; }
}

function init(){
  document.getElementById("app").innerHTML = renderApp();
  document.getElementById("app").addEventListener("click", onClick);
  document.getElementById("app").addEventListener("change", onChange);
}
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", init); else init();

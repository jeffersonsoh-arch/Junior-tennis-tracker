/* =========================================================================
   Deuce Board — generic player dashboard.
   Works for any player (NTRP 1.0-7.0 or the youth red/orange pathway),
   any coach-chosen quarter count, any sessions/week. Content is generated
   client-side from the drill_blocks/quiz_banks library (see
   assets/planGenerator.js) rather than hand-authored per player.
   ========================================================================= */

var NTRP_LEVELS = [1.0,1.5,2.0,2.5,3.0,3.5,4.0,4.5,5.0,5.5,6.0,6.5,7.0];
var YOUTH_STAGES = [
  {key:"red_starter", label:"Red Starter"},
  {key:"red_rally", label:"Red Rally"},
  {key:"red_game_player", label:"Red Game Player"},
  {key:"orange_ready", label:"Orange Ready"}
];

function playerIdFromUrl(){
  var m = /[?&]id=([^&]+)/.exec(window.location.search);
  return m ? decodeURIComponent(m[1]) : null;
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}
/* PostgREST serializes Postgres `numeric` columns as JSON strings (to
   avoid float-precision surprises) — ntrp_level, level_min/max, and
   agility_sec_target all need coercing back to real numbers, or
   .toFixed()/comparisons downstream break or silently do string math. */
function normalizeLevelRows(rows){
  rows.forEach(function(r){ if (r.ntrp_level != null) r.ntrp_level = Number(r.ntrp_level); });
  return rows;
}
function normalizeBlockRows(rows){
  rows.forEach(function(r){
    if (r.level_min != null) r.level_min = Number(r.level_min);
    if (r.level_max != null) r.level_max = Number(r.level_max);
  });
  return rows;
}
function normalizeThresholdRows(rows){
  rows.forEach(function(r){
    if (r.ntrp_level != null) r.ntrp_level = Number(r.ntrp_level);
    if (r.next_ntrp_level != null) r.next_ntrp_level = Number(r.next_ntrp_level);
    if (r.agility_sec_target != null) r.agility_sec_target = Number(r.agility_sec_target);
  });
  return rows;
}

function levelLabel(entry){
  if (!entry) return "–";
  return entry.ntrp_level != null ? "NTRP " + entry.ntrp_level.toFixed(1) : YOUTH_STAGES.filter(function(s){ return s.key === entry.youth_stage; }).map(function(s){ return s.label; })[0];
}

/* ---------------------------- App state ---------------------------- */
var PLAYER_ID = playerIdFromUrl();
var player = null, plan = null, levelHistory = [], members = [];
var drillBlocks = [], quizBanks = [], thresholds = [], skillItems = [];
var CURRICULUM = null, QUIZDATA = null;
var TOTAL_WEEKS = 0, BENCH_WEEKS = {};
var state = null;
var authClient = null, authUserId = null, authUserEmail = "";
var ui = { activeTab: "overview", selectedWeek: 1, quizGroup: null, quizAnswers: {}, quizSubmitted: {}, levelSuggestionDismissed: {} };

var TABS_BASE = [
  {id:"overview", label:"Overview", icon:"overview"},
  {id:"log", label:"Weekly Log", icon:"log"},
  {id:"aicoach", label:"AI Coach", icon:"aicoach"}
];

function weekById(n){ return CURRICULUM.weeks[n - 1]; }
function currentWeekNumber(){
  var start = new Date(CURRICULUM.start_date + "T00:00:00");
  var now = new Date();
  var wk = Math.floor((now - start) / 86400000 / 7) + 1;
  if (wk < 1) return 1;
  if (wk > TOTAL_WEEKS) return TOTAL_WEEKS;
  return wk;
}

function DEFAULT_STATE(){
  var s = { weeklyLog: {}, skillStatus: {}, badgeStatus: {}, benchmarks: {}, checkins: {}, quizResults: {} };
  for (var q = 1; q <= plan.quarters; q++){
    s.benchmarks[q] = {servePct:null, rallyBalls:null, agilitySec:null, matches:null, wins:null, coachRating:null, notes:""};
    s.checkins[q] = {longestRally:null, funMatches:null, coachNote:""};
  }
  return s;
}

/* ---------------------------- Derived stats ---------------------------- */
function dayDone(week, d){ var wl = state.weeklyLog[week]; return !!(wl && wl[d]); }
function weekDoneCount(week){
  var n = 0;
  for (var d = 1; d <= player.sessions_per_week; d++){ if (dayDone(week, "d" + d)) n++; }
  return n;
}
function totalSessionsDone(){ var n = 0; for (var w = 1; w <= TOTAL_WEEKS; w++) n += weekDoneCount(w); return n; }
function quarterCompletionPct(q){
  var weeks = CURRICULUM.weeks.filter(function(w){ return (w.quarter || w.stage_id) === q; });
  var total = weeks.length * player.sessions_per_week, done = 0;
  weeks.forEach(function(w){ done += weekDoneCount(w.week); });
  return total ? Math.round((done / total) * 100) : 0;
}
/* Skill checklist items are matched to whichever level is current right
   now (not resolved per-week like drill content) — the checklist is a
   "where do things stand today" view, not a historical one. */
function currentSkillItems(){
  var latest = levelHistory[levelHistory.length - 1];
  if (!latest || latest.ntrp_level == null) return [];
  return skillItems.filter(function(s){ return latest.ntrp_level >= s.level_min && latest.ntrp_level <= s.level_max; });
}
function skillsMasteredCount(){
  var items = currentSkillItems(), n = 0;
  items.forEach(function(s){ if (state.skillStatus[s.id] === "mastered") n++; });
  return n;
}
function groupMasteredCount(items, group){
  var n = 0;
  items.forEach(function(s){ if (s.group_label === group && state.skillStatus[s.id] === "mastered") n++; });
  return n;
}
function badgesEarnedCount(stageId){
  var n = 0, s = CURRICULUM.stages[stageId - 1];
  s.badges.forEach(function(_, i){ if (state.badgeStatus[stageId + "-" + i]) n++; });
  return n;
}
function totalBadgesEarned(){ var n = 0; CURRICULUM.stages.forEach(function(s){ n += badgesEarnedCount(s.id); }); return n; }
function nextCheckpointInfo(){
  var wk = currentWeekNumber();
  var order = Object.keys(BENCH_WEEKS).map(function(k){ return BENCH_WEEKS[k]; }).sort(function(a,b){return a-b;});
  for (var i = 0; i < order.length; i++){ if (order[i] >= wk) return {week: order[i], id: i + 1, weeksAway: order[i] - wk}; }
  return null;
}
function bestQuizAverage(){
  var vals = [];
  QUIZDATA.groups.forEach(function(g){ var r = state.quizResults[g.id]; if (r && r.attempts > 0) vals.push(r.best); });
  if (!vals.length) return null;
  return Math.round((vals.reduce(function(a,b){return a+b;},0) / vals.length) * 10) / 10;
}
function thresholdFor(entry){
  return thresholds.filter(function(t){
    return entry.ntrp_level != null ? t.ntrp_level === entry.ntrp_level : t.youth_stage === entry.youth_stage;
  })[0];
}
function suggestedLevelUp(){
  var isNtrp = player.pathway === "ntrp";
  var source = isNtrp ? state.benchmarks : state.checkins;
  var lastQ = null;
  Object.keys(source).map(Number).sort(function(a,b){return b-a;}).forEach(function(q){
    if (lastQ !== null) return;
    var d = source[q];
    var filled = isNtrp ? (d.servePct != null && d.rallyBalls != null && d.agilitySec != null) : (d.longestRally != null);
    if (filled) lastQ = q;
  });
  if (lastQ === null) return null;
  var wkAtCheckpoint = BENCH_WEEKS[lastQ];
  var entry = resolveLevelForDate(levelHistory, weekById(wkAtCheckpoint).start);
  var t = thresholdFor(entry);
  if (!t) return null;
  var cleared = isNtrp
    ? source[lastQ].servePct >= t.serve_pct_target && source[lastQ].rallyBalls >= t.rally_balls_target && source[lastQ].agilitySec <= t.agility_sec_target
    : source[lastQ].longestRally >= t.longest_rally_target;
  if (!cleared) return null;
  var nextLabel = t.next_ntrp_level != null ? "NTRP " + Number(t.next_ntrp_level).toFixed(1) : YOUTH_STAGES.filter(function(s){return s.key===t.next_youth_stage;}).map(function(s){return s.label;})[0];
  var key = lastQ + "-" + (t.next_ntrp_level || t.next_youth_stage);
  if (ui.levelSuggestionDismissed[key]) return null;
  return { key: key, quarter: lastQ, nextNtrpLevel: t.next_ntrp_level, nextYouthStage: t.next_youth_stage, nextLabel: nextLabel, crossesPathway: player.pathway === "youth" && t.next_ntrp_level != null };
}

/* ---------------------------- Small chart helpers (unchanged from the original dashboards) ---------------------------- */
function sparklineSvg(points){
  var have = [];
  points.forEach(function(v, i){ if (v !== null && v !== undefined && v !== "") have.push({i:i, v:+v}); });
  if (have.length < 2) return '<div class="empty-note">Add at least two entries to see a trend.</div>';
  var w=200,h=52,padX=8,padY=8, n=points.length;
  var xs = have.map(function(p){ return padX + (p.i/(n-1))*(w-padX*2); });
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
function tabsForPathway(){
  var t = TABS_BASE.slice();
  if (player.pathway === "ntrp") t.push({id:"skills", label:"Skill Checklist", icon:"skills"}, {id:"benchmarks", label:"Benchmarks", icon:"bench"});
  else t.push({id:"badges", label:"Skill Badges", icon:"badge"}, {id:"checkins", label:"Check-Ins", icon:"bench"});
  t.push({id:"quiz", label:"Strategy Quiz", icon:"quiz"}, {id:"settings", label:"Settings", icon:"bench"});
  return t;
}

function renderSidebar(){
  var tabsHtml = tabsForPathway().map(function(t){
    return '<button class="tab-btn '+(ui.activeTab===t.id?"active":"")+'" data-action="tab" data-tab="'+t.id+'">'+ICON[t.icon]+'<span>'+t.label+'</span></button>';
  }).join("");
  return '<div class="sidebar">'
    + '<a class="brand" href="../index.html">'+ICON.brand+'<div class="brand-text"><span class="name">Deuce Board</span><span class="sub">Junior Development Tracker</span></div></a>'
    + '<div class="player-box"><span class="p-label">Player</span><span class="p-name">'+escapeHtml(player.name)+'</span><a href="../index.html">&larr; Switch player</a></div>'
    + '<nav class="tabs">'+tabsHtml+'</nav>'
    + '<div class="sidebar-foot">Season '+CURRICULUM.start_date+' &rarr; '+CURRICULUM.end_date+'<br/>'+escapeHtml(levelLabel(levelHistory[levelHistory.length-1]))+' &middot; '+player.sessions_per_week+' sessions / week'
    + '<div class="data-tools" style="margin-top:10px"><button class="btn secondary" data-action="exportdata">Backup</button><button class="btn secondary" data-action="importdata">Restore</button></div>'
    + (authUserEmail ? '<div style="margin-top:10px; font-size:10.5px; color:var(--ink-faint)">Signed in as '+escapeHtml(authUserEmail)+'<br/><button class="btn link" style="padding:4px 0" data-action="signout">Sign out</button></div>' : "")
    + '</div></div>';
}

/* Condensed one-line-per-stroke summary of a youth block, used to show
   "what's new"/"what's coming" without needing separately-authored diff
   text — just the headline clause of each stroke field (reusing
   planGenerator.js's clauseAt, already used the same way for NTRP
   benchmark-week text). */
function stageFocusLines(block){
  if (!block) return [];
  var c = block.content;
  return [
    "Forehand — " + clauseAt(c.forehand, [",", ";"]),
    "Backhand — " + clauseAt(c.backhand, [",", ";"]),
    "Serve — " + clauseAt(c.serve, [",", ";"]),
    "Volley — " + clauseAt(c.volley, [",", ";"])
  ];
}

function progCard(cls, label, name, lines){
  var linesHtml = lines.map(function(l){ return '<div class="prog-line">'+escapeHtml(l)+'</div>'; }).join("");
  return '<div class="card prog-card '+cls+'"><div class="prog-label">'+escapeHtml(label)+'</div><div class="prog-name">'+escapeHtml(name)+'</div>'
    + '<div class="prog-lines">'+(linesHtml || '<div class="prog-line empty-note">—</div>')+'</div></div>';
}

/* Youth-only: a Previous / Current / Next stage strip, so a coach can see
   at a glance what changed moving into this stage and what's coming next
   — otherwise progression through the red/orange pathway is invisible
   until you go dig through the Weekly Log week by week. */
function renderStageProgression(){
  if (player.pathway !== "youth") return "";
  var current = levelHistory[levelHistory.length - 1];
  var idx = YOUTH_STAGES.map(function(s){ return s.key; }).indexOf(current.youth_stage);
  if (idx === -1) return "";

  var prevStage = idx > 0 ? YOUTH_STAGES[idx - 1] : null;
  var nextStage = idx < YOUTH_STAGES.length - 1 ? YOUTH_STAGES[idx + 1] : null;

  var prevCard = prevStage
    ? (function(){
        var pb = bestYouthBlock(drillBlocks, prevStage.key, 1);
        var badges = pb ? pb.content.badges.slice(0, 3).map(function(b){ return "Mastered: " + b; }) : [];
        return progCard("prog-prev", "Where You Came From", prevStage.label, badges);
      })()
    : "";

  var currentBlock = bestYouthBlock(drillBlocks, current.youth_stage, 1);
  var currentCard = progCard("prog-current", "New This Stage", YOUTH_STAGES[idx].label, stageFocusLines(currentBlock));

  var nextCard = nextStage
    ? (function(){
        var nb = bestYouthBlock(drillBlocks, nextStage.key, 1);
        return progCard("prog-next", "Coming Up Next", nextStage.label, stageFocusLines(nb));
      })()
    : progCard("prog-next", "Coming Up Next", "NTRP Pathway", ["Graduate whenever ready — the same stroke-by-stroke structure continues into the full NTRP 1.0-7.0 scale."]);

  return '<div class="section-title">Stage Progression</div><div class="grid prog-grid">'+prevCard+currentCard+nextCard+'</div>';
}

function levelSuggestionBanner(){
  var s = suggestedLevelUp();
  if (!s) return "";
  return '<div class="card" style="border-color:var(--accent); margin-bottom:14px"><b>Results suggest '+escapeHtml(player.name)+' is ready for '+escapeHtml(s.nextLabel)+'.</b>'
    + '<p style="margin:6px 0 10px; color:var(--ink-soft); font-size:13px">Based on the Quarter '+s.quarter+' check-in. Confirming updates future weeks — logged history stays as it was.</p>'
    + '<button class="btn" data-action="confirmlevelup" data-key="'+s.key+'" data-ntrp="'+(s.nextNtrpLevel||"")+'" data-youth="'+(s.nextYouthStage||"")+'">Confirm level-up</button> '
    + '<button class="btn secondary" data-action="dismisslevelup" data-key="'+s.key+'">Not yet</button></div>';
}

function renderOverview(){
  var wk = currentWeekNumber(), w = weekById(wk);
  var doneTotal = totalSessionsDone(), pct = Math.round((doneTotal/(TOTAL_WEEKS*player.sessions_per_week))*100);
  var nb = nextCheckpointInfo(), avg = bestQuizAverage();
  var isNtrp = player.pathway === "ntrp";

  var bands = Array.from({length: plan.quarters}, function(_, i){ return i + 1; }).map(function(q){
    var weeksInQ = CURRICULUM.weeks.filter(function(x){ return (x.quarter||x.stage_id) === q; });
    var cur = (w.quarter||w.stage_id) === q;
    return '<div class="q '+(cur?"current-q":"")+'">Q'+q+' &middot; wk '+weeksInQ[0].week+'–'+weeksInQ[weeksInQ.length-1].week+'</div>';
  }).join("");
  var marks = [];
  Object.keys(BENCH_WEEKS).forEach(function(k){ var bw=BENCH_WEEKS[k]; marks.push('<div class="tick" style="left:'+((bw-0.5)/TOTAL_WEEKS*100)+'%" title="Checkpoint week '+bw+'"></div>'); });
  marks.push('<div class="marker" style="left:'+((wk-0.5)/TOTAL_WEEKS*100)+'%"><span class="flag">Today &middot; Wk '+wk+'</span></div>');

  var bars = Array.from({length: plan.quarters}, function(_, i){ return i + 1; }).map(function(q){
    var p = quarterCompletionPct(q);
    return '<div class="bar-col"><div class="bar-track"><div class="bar-fill" style="height:'+p+'%"></div></div><div class="bar-value">'+p+'%</div><div class="bar-label">Q'+q+'</div></div>';
  }).join("");

  var statTiles = isNtrp
    ? '<div class="card stat-tile"><span class="label">Skills Mastered</span><span class="value">'+skillsMasteredCount()+'<span style="font-size:14px;color:var(--ink-faint)">/'+currentSkillItems().length+'</span></span><span class="sub">across all skill groups</span></div>'
    : '<div class="card stat-tile"><span class="label">Badges Earned</span><span class="value">'+totalBadgesEarned()+'<span style="font-size:14px;color:var(--ink-faint)">/'+(CURRICULUM.stages.length*6)+'</span></span><span class="sub">across all stages</span></div>';

  var spark = "";
  if (isNtrp){
    var metrics = [
      {key:"servePct", label:"Serve Consistency", unit:"%", lowerBetter:false},
      {key:"rallyBalls", label:"Rally Tolerance", unit:" balls", lowerBetter:false},
      {key:"agilitySec", label:"Agility (5-10-5)", unit:"s", lowerBetter:true}
    ];
    var sparkCards = metrics.map(function(m){
      var pts = Array.from({length: plan.quarters}, function(_, i){ return state.benchmarks[i+1][m.key]; });
      var last=null; for (var i=pts.length-1;i>=0;i--){ if (pts[i]!==null&&pts[i]!==undefined&&pts[i]!==""){ last=pts[i]; break; } }
      return '<div class="card spark-card"><div class="spark-head"><span class="t">'+m.label+'</span><span class="v">'+(last!==null?(last+m.unit):"–")+' '+trendChip(pts,m.lowerBetter)+'</span></div>'+sparklineSvg(pts)+'</div>';
    }).join("");
    spark = '<div class="section-title">Benchmark Trends</div><div class="grid spark-grid">'+sparkCards+'</div>';
  }

  return '<main>'
    + levelSuggestionBanner()
    + '<div class="page-head"><div><h1>Welcome back, '+escapeHtml(player.name)+'</h1><div class="meta">Week '+wk+' of '+TOTAL_WEEKS+' &middot; '+escapeHtml(levelLabel(resolveLevelForDate(levelHistory, w.start)))+'</div></div></div>'
    + '<div class="timeline">'+bands+marks.join("")+'</div>'
    + renderStageProgression()
    + '<div class="section-title">This Season</div>'
    + '<div class="grid stat-row">'
      + '<div class="card stat-tile"><span class="label">Sessions Completed</span><span class="value">'+doneTotal+'<span style="font-size:14px;color:var(--ink-faint)">/'+(TOTAL_WEEKS*player.sessions_per_week)+'</span></span><span class="sub">'+pct+'% of the season</span></div>'
      + statTiles
      + '<div class="card stat-tile"><span class="label">Best Quiz Average</span><span class="value">'+(avg!==null?avg:"–")+'</span><span class="sub">across attempted quarters</span></div>'
      + '<div class="card stat-tile"><span class="label">Next Checkpoint</span><span class="value">'+(nb?("Wk "+nb.week):"Done")+'</span><span class="sub">'+(nb?(nb.weeksAway<=0?"This week":nb.weeksAway+" week(s) away"):"Season complete")+'</span></div>'
    + '</div>'
    + '<div class="section-title">Completion by Quarter</div>'
    + '<div class="card"><div class="barchart">'+bars+'</div></div>'
    + spark
    + '</main>';
}

/* A day's content is either a plain string (benchmark weeks, youth
   pathway, or "no content yet") or an array of {label, minutes, text}
   session segments (a normal NTRP week) — render whichever it is. */
function renderDayContent(content){
  if (typeof content === "string") return '<div class="d-text">'+escapeHtml(content)+'</div>';
  var total = content.reduce(function(sum, s){ return sum + (s.minutes || 0); }, 0);
  var segs = content.map(function(s){
    return '<div class="day-seg"><span class="seg-label">'+escapeHtml(s.label)+(s.minutes ? ' <span class="seg-min">'+s.minutes+' min</span>' : '')+'</span>'
      + '<span class="seg-text">'+escapeHtml(s.text)+'</span></div>';
  }).join("");
  return '<div class="d-text"><div class="d-total">~'+total+' min session</div>'+segs+'</div>';
}
function renderWeekDayRow(w, dnum){
  var key="d"+dnum, done=dayDone(w.week,key), content=w["day"+dnum];
  return '<div class="day-row"><button class="day-check '+(done?"done":"")+'" data-action="toggleday" data-week="'+w.week+'" data-day="'+key+'" aria-label="Toggle Day '+dnum+'">'+ICON.check+'</button>'
    + '<div class="day-body"><div class="d-label">Day '+dnum+'</div>'+renderDayContent(content)+'</div></div>';
}

function renderWeeklyLog(){
  var wk = ui.selectedWeek, w = weekById(wk), wl = state.weeklyLog[wk] || {};
  var options = CURRICULUM.weeks.map(function(x){
    return '<option value="'+x.week+'" '+(x.week===wk?"selected":"")+'>Week '+x.week+' — '+x.start+'</option>';
  }).join("");
  var isNtrp = player.pathway === "ntrp";
  var badges = '<span class="pill pill-accent">Q'+(w.quarter||w.stage_id)+'</span>'
    + '<span class="pill pill-muted">'+escapeHtml(w.block_title||w.stage_name||"")+'</span>'
    + (w.week_label ? '<span class="pill pill-muted">'+escapeHtml(w.week_label)+'</span>' : "")
    + ((isNtrp?w.is_benchmark:w.is_checkpoint) ? '<span class="pill pill-warn">Checkpoint Week</span>' : "");
  var phaseNoteHtml = w.phase_note ? '<p class="phase-note">'+escapeHtml(w.phase_note)+'</p>' : "";
  var days = [];
  for (var d = 1; d <= player.sessions_per_week; d++) days.push(renderWeekDayRow(w, d));
  var heatCards = Array.from({length: plan.quarters}, function(_, i){ return i + 1; }).map(function(q){
    var weeks = CURRICULUM.weeks.filter(function(x){ return (x.quarter||x.stage_id) === q; });
    var pct = quarterCompletionPct(q);
    var rows = weeks.map(function(x){
      var cells = [];
      for (var d = 1; d <= player.sessions_per_week; d++){
        var on = dayDone(x.week, "d"+d);
        var cls = "heat-cell"+(on?" on":"")+((isNtrp?x.is_benchmark:x.is_checkpoint)?" bench":"")+(x.week===wk?" selected":"");
        cells.push('<div class="'+cls+'" data-action="goweek" data-week="'+x.week+'" title="Week '+x.week+'"></div>');
      }
      return '<div class="heat-row"><span class="wknum">'+x.week+'</span>'+cells.join("")+'</div>';
    }).join("");
    return '<div class="card heat-card" style="--ndays:'+player.sessions_per_week+'"><div class="heat-head"><span class="t">Q'+q+' &middot; weeks '+weeks[0].week+'–'+weeks[weeks.length-1].week+'</span><span class="pct">'+pct+'%</span></div><div class="heat-rows">'+rows+'</div></div>';
  }).join("");
  return '<main>'
    + '<div class="page-head"><div><h1>Weekly Log</h1><div class="meta">Check off each session as it happens; notes save automatically.</div></div></div>'
    + '<div class="week-nav"><button class="icon-btn" data-action="prevweek">'+ICON.chevL+'</button><select data-action="selectweek">'+options+'</select><button class="icon-btn" data-action="nextweek">'+ICON.chevR+'</button></div>'
    + '<div class="card week-card"><h3>Week '+w.week+' &middot; '+w.start+' – '+w.end+'</h3><div class="wk-badges">'+badges+'</div>'+phaseNoteHtml+days.join("")
    + '<textarea class="notes" data-action="weeknotes" data-week="'+w.week+'" placeholder="Coach notes for this week (optional)">'+escapeHtml(wl.note||"")+'</textarea></div>'
    + '<div class="section-title">Season at a Glance</div>'
    + '<div class="grid heat-wrap">'+heatCards+'</div>'
    + '</main>';
}

var SKILL_GROUP_DOT = {"Forehand":"var(--cat-technical)", "Backhand":"var(--cat-tactical)", "Net Game":"var(--cat-physical)", "Serve":"var(--cat-mental)", "Movement":"var(--accent2)"};
function renderSkills(){
  var items = currentSkillItems();
  if (!items.length){
    return '<main><div class="page-head"><div><h1>Skill Checklist</h1></div></div><div class="card">No skill checklist has been written yet for this level.</div></main>';
  }
  var groups = [];
  items.forEach(function(s){ if (groups.indexOf(s.group_label) === -1) groups.push(s.group_label); });
  var sections = groups.map(function(group){
    var groupItems = items.filter(function(s){ return s.group_label === group; }).sort(function(a,b){ return a.sort_order - b.sort_order; });
    var m = groupMasteredCount(items, group), total = groupItems.length, pct = total ? Math.round((m/total)*100) : 0;
    var dot = SKILL_GROUP_DOT[group] || "var(--accent)";
    var rows = groupItems.map(function(s){
      var val = state.skillStatus[s.id] || "not-started";
      return '<div class="skill-item"><span class="s-text"><b>'+escapeHtml(s.title)+'</b><br/><span style="color:var(--ink-soft); font-size:12.5px">'+escapeHtml(s.description)+'</span></span>'
        + '<select class="status-select" data-action="statuschange" data-skill="'+s.id+'">'
        + '<option value="not-started" '+(val==="not-started"?"selected":"")+'>Not started</option>'
        + '<option value="in-progress" '+(val==="in-progress"?"selected":"")+'>In progress</option>'
        + '<option value="mastered" '+(val==="mastered"?"selected":"")+'>Mastered</option></select></div>';
    }).join("");
    return '<div class="skill-cat"><div class="cat-head"><span class="cat-dot" style="background:'+dot+'"></span><h3>'+escapeHtml(group)+'</h3><span class="cat-frac">'+m+'/'+total+' mastered</span></div>'
      + '<div class="cat-bar"><div class="cat-bar-fill" style="width:'+pct+'%;background:'+dot+'"></div></div><div class="card">'+rows+'</div></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Skill Checklist</h1><div class="meta">'+items.length+' skills across '+groups.length+' groups &middot; tracked continuously, not tied to a single week</div></div></div>'+sections+'</main>';
}

function renderBadges(){
  var stages = CURRICULUM.stages.map(function(s){
    var earned = badgesEarnedCount(s.id);
    var items = s.badges.map(function(name, i){
      var key = s.id+"-"+i, on = !!state.badgeStatus[key];
      return '<div class="badge '+(on?"earned":"")+'" data-action="togglebadge" data-key="'+key+'"><div class="ring">'+ICON.check+'</div><div class="b-name">'+escapeHtml(name)+'</div></div>';
    }).join("");
    return '<div class="skill-cat"><div class="cat-head"><span class="cat-dot" style="background:var(--accent)"></span><h3>Q'+s.id+' — '+escapeHtml(s.name)+'</h3><span class="cat-frac">'+earned+'/6 earned</span></div>'
      + '<div class="cat-bar"><div class="cat-bar-fill" style="width:'+Math.round(earned/6*100)+'%;background:var(--accent)"></div></div>'
      + '<p style="color:var(--ink-soft); font-size:13px; margin:0 0 12px">'+escapeHtml(s.blurb)+'</p><div class="badge-grid">'+items+'</div></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Skill Badges</h1><div class="meta">Tap a badge to mark it earned &middot; 6 badges per quarter</div></div></div>'+stages+'</main>';
}

function renderBenchmarks(){
  var cards = Array.from({length: plan.quarters}, function(_, i){ return i + 1; }).map(function(b){
    var data = state.benchmarks[b], wk = BENCH_WEEKS[b], w = weekById(wk);
    var entry = resolveLevelForDate(levelHistory, w.start), t = thresholdFor(entry);
    var field = function(labelText, key, placeholder){
      var v = data[key];
      return '<div class="field-row"><label>'+labelText+'</label><input type="number" inputmode="decimal" data-action="benchfield" data-bench="'+b+'" data-field="'+key+'" value="'+(v===null||v===undefined?"":v)+'" placeholder="'+(placeholder||"–")+'" /></div>';
    };
    return '<div class="card bench-card"><h3>Benchmark '+b+' &middot; Week '+wk+'</h3><div class="bdate">'+w.start+' &middot; '+escapeHtml(w.block_title||"")+'</div>'
      + (t ? '<p style="color:var(--ink-soft); font-size:13px; margin:0 0 12px">Target to suggest leveling up from '+escapeHtml(levelLabel(entry))+': '+t.serve_pct_target+'%+ serve, '+t.rally_balls_target+'+ rally balls, &le;'+t.agility_sec_target+'s agility.</p>' : "")
      + field("Serve consistency (%)","servePct") + field("Rally tolerance (balls)","rallyBalls") + field("Agility 5-10-5 (sec)","agilitySec")
      + field("Matches played","matches") + field("Matches won","wins") + field("Coach tactical rating (1–5)","coachRating")
      + '<textarea class="bench-notes" data-action="benchnotes" data-bench="'+b+'" placeholder="Notes on this benchmark session">'+escapeHtml(data.notes||"")+'</textarea></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Benchmarks</h1><div class="meta">One checkpoint at the end of each quarter</div></div></div>'+levelSuggestionBanner()+'<div class="grid bench-grid">'+cards+'</div></main>';
}

function renderCheckins(){
  var cards = Array.from({length: plan.quarters}, function(_, i){ return i + 1; }).map(function(c){
    var data = state.checkins[c], wk = BENCH_WEEKS[c], w = weekById(wk);
    var entry = resolveLevelForDate(levelHistory, w.start), t = thresholdFor(entry);
    var field = function(labelText, key){
      var v = data[key];
      return '<div class="field-row"><label>'+labelText+'</label><input type="number" inputmode="numeric" data-action="checkinfield" data-checkin="'+c+'" data-field="'+key+'" value="'+(v===null||v===undefined?"":v)+'" placeholder="–" /></div>';
    };
    return '<div class="card bench-card"><h3>Check-In '+c+' &middot; Week '+wk+'</h3><div class="bdate">'+w.start+' &middot; '+escapeHtml(levelLabel(entry))+'</div>'
      + (t ? '<p style="color:var(--ink-soft); font-size:13px; margin:0 0 12px">Target to suggest the next stage: '+t.longest_rally_target+'+ ball rally.</p>' : "")
      + field("Longest rally (balls in a row)","longestRally") + field("Fun matches played","funMatches")
      + '<div class="field-row"><label>Badges earned so far</label><input value="'+badgesEarnedCount(c)+' / 6" disabled style="text-align:right;color:var(--ink-faint)"/></div>'
      + '<textarea class="bench-notes" data-action="checkinnotes" data-checkin="'+c+'" placeholder="How did this stage go?">'+escapeHtml(data.coachNote||"")+'</textarea></div>';
  }).join("");
  return '<main><div class="page-head"><div><h1>Check-Ins</h1><div class="meta">One easy check-in at the end of each quarter</div></div></div>'+levelSuggestionBanner()+'<div class="grid bench-grid">'+cards+'</div></main>';
}

function renderQuiz(){
  if (!QUIZDATA.groups.length){
    return '<main><div class="page-head"><div><h1>Strategy Quiz</h1></div></div><div class="card">No quiz has been written yet for '+escapeHtml(levelLabel(levelHistory[levelHistory.length-1]))+'. This level\'s content library is still growing — check back after the drill library is expanded.</div></main>';
  }
  var gid = ui.quizGroup || QUIZDATA.groups[0].id;
  var gdata = QUIZDATA.groups.filter(function(g){return g.id===gid;})[0];
  var results = state.quizResults[gid] || {best:0,last:0,attempts:0,lastDate:""};
  var answers = ui.quizAnswers[gid] || {}; var submitted = !!ui.quizSubmitted[gid];
  var tabs = QUIZDATA.groups.map(function(g){
    var r = state.quizResults[g.id] || {attempts:0};
    return '<button class="qtab '+(g.id===gid?"active":"")+'" data-action="qtab" data-quarter="'+g.id+'">'+g.name+(r.attempts>0?' &middot; best '+r.best+'/'+g.questions.length:"")+'</button>';
  }).join("");
  var banner = "";
  if (submitted){
    var score=0; gdata.questions.forEach(function(q,i){ if (answers[i]===q.correct) score++; });
    banner = '<div class="score-banner"><span class="big">'+score+'/'+gdata.questions.length+'</span><span>Best: '+results.best+'/'+gdata.questions.length+' &middot; Attempts: '+results.attempts+'</span>'
      + '<button class="btn secondary" data-action="retakequiz" data-quarter="'+gid+'" style="margin-left:auto">Try Again</button></div>';
  }
  var qitems = gdata.questions.map(function(q,i){
    var opts = q.options.map(function(opt,oi){
      var cls=""; var chosen=answers[i];
      if (submitted){ if (oi===q.correct) cls="correct"; else if (oi===chosen) cls="incorrect"; }
      var checked = chosen===oi?"checked":"";
      return '<label class="q-opt '+cls+'"><input type="radio" name="q'+gid+'_'+i+'" value="'+oi+'" data-action="quizanswer" data-q="'+i+'" '+checked+' '+(submitted?"disabled":"")+' /> '+escapeHtml(opt)+'</label>';
    }).join("");
    var explain = submitted ? '<div class="q-explain"><strong>Why: </strong>'+escapeHtml(q.explain)+'</div>' : "";
    return '<div class="q-item"><div class="q-text">'+(i+1)+'. '+escapeHtml(q.q)+'</div><div class="q-opts">'+opts+'</div>'+explain+'</div>';
  }).join("");
  var submitBtn = submitted ? "" : '<div style="margin-top:16px"><button class="btn" data-action="submitquiz" data-quarter="'+gid+'">Submit Answers</button></div>';
  return '<main><div class="page-head"><div><h1>Strategy Quiz</h1><div class="meta">'+gdata.questions.length+' questions this quarter</div></div></div>'
    + '<div class="quarter-tabs">'+tabs+'</div>'+banner+'<div class="card">'+qitems+submitBtn+'</div></main>';
}

function renderSettings(){
  var levelOptionsHtml = player.pathway === "ntrp"
    ? NTRP_LEVELS.map(function(l){ return '<option value="'+l+'">NTRP '+l.toFixed(1)+'</option>'; }).join("")
    : YOUTH_STAGES.map(function(s){ return '<option value="'+s.key+'">'+s.label+'</option>'; }).join("");
  var historyRows = levelHistory.slice().reverse().map(function(e){
    return '<div class="day-row"><div class="day-body"><div class="d-label">'+e.effective_date+' &middot; '+(e.set_by==="manual"?"Manual":"Suggested, confirmed")+'</div><div class="d-text">'+escapeHtml(levelLabel(e))+(e.note?" — "+escapeHtml(e.note):"")+'</div></div></div>';
  }).join("");

  var membersHtml = members.map(function(m){
    var canRemove = members.some(function(x){ return x.user_id===authUserId && x.role==="owner"; }) && m.user_id !== authUserId;
    return '<div class="day-row"><div class="day-body"><div class="d-label">'+escapeHtml(m.invited_email)+' &middot; '+m.role+'</div><div class="d-text">'+(m.status==="active"?"Active":"Invited, not yet accepted")+'</div></div>'
      + (canRemove ? '<button class="btn secondary" data-action="removemember" data-member="'+m.id+'">Remove</button>' : "") + '</div>';
  }).join("");

  var graduateBtn = player.pathway === "youth"
    ? '<button class="btn secondary" data-action="graduatepathway" style="margin-top:8px">Graduate to NTRP pathway (starts at NTRP 1.0)</button>'
    : "";

  return '<main><div class="page-head"><div><h1>Settings</h1><div class="meta">Level, sharing, and player details</div></div></div>'
    + '<div class="card"><h3 style="margin-bottom:10px">Change level</h3>'
    + '<div class="field-row"><label>New level</label><select id="newlevel-select">'+levelOptionsHtml+'</select></div>'
    + '<button class="btn" data-action="changelevel" style="margin-top:8px">Set level</button>'+graduateBtn
    + '<h3 style="margin:20px 0 10px">Level history</h3>'+(historyRows||'<div class="empty-note">No history yet.</div>')+'</div>'
    + '<div class="card" style="margin-top:14px"><h3 style="margin-bottom:10px">Who has access</h3>'+membersHtml
    + '<div class="field-row" style="margin-top:12px"><label>Invite by email</label><input type="email" id="invite-email" placeholder="parent@example.com" /></div>'
    + '<button class="btn" data-action="invitemember" style="margin-top:8px">Send invite</button></div>'
    + '</main>';
}

function renderApp(){
  var mainHtml;
  if (ui.activeTab==="log") mainHtml=renderWeeklyLog();
  else if (ui.activeTab==="aicoach") mainHtml=renderAiCoach();
  else if (ui.activeTab==="skills") mainHtml=renderSkills();
  else if (ui.activeTab==="badges") mainHtml=renderBadges();
  else if (ui.activeTab==="benchmarks") mainHtml=renderBenchmarks();
  else if (ui.activeTab==="checkins") mainHtml=renderCheckins();
  else if (ui.activeTab==="quiz") mainHtml=renderQuiz();
  else if (ui.activeTab==="settings") mainHtml=renderSettings();
  else mainHtml=renderOverview();
  return renderSidebar()+mainHtml;
}

/* ---------------------------- Persistence ---------------------------- */
var persistTimer=null;
function showToast(msg){ var t=document.getElementById("toast"); if(!t) return; t.textContent=msg; t.classList.add("show"); setTimeout(function(){t.classList.remove("show");},1400); }
function schedulePersist(){
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer=setTimeout(function(){
    if (!authClient){ saveLocalState(plan.id, state); showToast("Saved"); return; }
    saveRemoteState(authClient, plan.id, plan.id, state)
      .then(function(){ showToast("Saved"); })
      .catch(function(e){ saveLocalState(plan.id, state); showToast("Saved offline (sync failed)"); console.warn(e); });
  }, 500);
}

/* ---------------------------- Event wiring ---------------------------- */
function rerender(){ document.getElementById("app").innerHTML = renderApp(); }

function applyLevelChange(ntrpLevel, youthStage, setBy){
  return authClient.from("player_levels").insert({
    player_id: player.id, ntrp_level: ntrpLevel || null, youth_stage: youthStage || null,
    effective_date: todayISO(), set_by: setBy, created_by: authUserId
  }).then(function(res){
    if (res.error) throw res.error;
    return authClient.from("player_levels").select("*").eq("player_id", player.id).order("effective_date");
  }).then(function(res){
    if (res.error) throw res.error;
    levelHistory = normalizeLevelRows(res.data);
    CURRICULUM = buildCurriculum({ pathway: player.pathway, levelHistory: levelHistory, quarters: plan.quarters, startDate: plan.start_date, sessionsPerWeek: player.sessions_per_week, drillBlocks: drillBlocks });
    QUIZDATA = { groups: buildQuizGroups({ pathway: player.pathway, levelHistory: levelHistory, quarters: plan.quarters, startDate: plan.start_date, quizBanks: quizBanks }) };
    rerender(); showToast("Level updated");
  }).catch(function(e){ alert("Could not update level: " + e.message); });
}

function onClick(e){
  var el = e.target.closest("[data-action]");
  if (!el) return;
  var action = el.getAttribute("data-action");
  if (action==="tab"){ ui.activeTab=el.getAttribute("data-tab"); rerender(); }
  else if (action==="goweek"){ ui.selectedWeek=+el.getAttribute("data-week"); ui.activeTab="log"; rerender(); }
  else if (action==="prevweek"){ ui.selectedWeek=Math.max(1,ui.selectedWeek-1); rerender(); }
  else if (action==="nextweek"){ ui.selectedWeek=Math.min(TOTAL_WEEKS,ui.selectedWeek+1); rerender(); }
  else if (action==="toggleday"){
    var wk=+el.getAttribute("data-week"), day=el.getAttribute("data-day");
    if (!state.weeklyLog[wk]) state.weeklyLog[wk]={note:""};
    state.weeklyLog[wk][day]=!state.weeklyLog[wk][day];
    rerender(); schedulePersist();
  }
  else if (action==="togglebadge"){
    var key=el.getAttribute("data-key");
    state.badgeStatus[key]=!state.badgeStatus[key];
    rerender(); schedulePersist();
  }
  else if (action==="qtab"){ ui.quizGroup=+el.getAttribute("data-quarter"); rerender(); }
  else if (action==="submitquiz"){
    var gid=+el.getAttribute("data-quarter"), gdata=QUIZDATA.groups.filter(function(g){return g.id===gid;})[0];
    var answers=ui.quizAnswers[gid]||{}, score=0;
    gdata.questions.forEach(function(q,i){ if (answers[i]===q.correct) score++; });
    if (!state.quizResults[gid]) state.quizResults[gid]={best:0,last:0,attempts:0,lastDate:""};
    var r=state.quizResults[gid]; r.last=score; r.best=Math.max(r.best,score); r.attempts+=1; r.lastDate=todayISO();
    ui.quizSubmitted[gid]=true; rerender(); schedulePersist();
  }
  else if (action==="retakequiz"){ var rq=+el.getAttribute("data-quarter"); ui.quizAnswers[rq]={}; ui.quizSubmitted[rq]=false; rerender(); }
  else if (action==="exportdata"){ downloadJson(player.name.toLowerCase()+"-tennis-backup-"+todayISO()+".json", state); showToast("Backup downloaded"); }
  else if (action==="importdata"){
    uploadJson(function(parsed){
      if (parsed && typeof parsed==="object" && parsed.weeklyLog){ state=parsed; schedulePersist(); rerender(); showToast("Progress restored"); }
      else alert("That file doesn't look like a valid backup.");
    });
  }
  else if (action==="signout"){ signOutAndReload(); }
  else if (action==="aisend"){
    var aiTa = document.getElementById("ai-chat-input");
    var aiText = aiTa ? aiTa.value.trim() : "";
    if (!aiText || aiState.sending) return;
    sendAiMessage(aiText);
  }
  else if (action==="aisaveproposal"){ saveAiProposal(); }
  else if (action==="aidiscardproposal"){ aiState.draftStructured = null; rerender(); }
  else if (action==="aideleteitem"){
    if (confirm("Delete this saved item?")) deleteAiSavedItem(el.getAttribute("data-id"));
  }
  else if (action==="changelevel"){
    var sel = document.getElementById("newlevel-select").value;
    if (player.pathway==="ntrp") applyLevelChange(parseFloat(sel), null, "manual");
    else applyLevelChange(null, sel, "manual");
  }
  else if (action==="graduatepathway"){
    if (!confirm("Graduate " + player.name + " from the youth pathway to NTRP 1.0? This can't be undone.")) return;
    authClient.from("players").update({pathway:"ntrp"}).eq("id", player.id).then(function(res){
      if (res.error) throw res.error;
      player.pathway = "ntrp";
      ui.activeTab = "overview"; // youth-only tabs (badges/check-ins) no longer apply
      return applyLevelChange(1.0, null, "manual");
    }).catch(function(e){ alert("Could not graduate player: " + e.message); });
  }
  else if (action==="confirmlevelup"){
    var ntrp = el.getAttribute("data-ntrp"), youth = el.getAttribute("data-youth");
    applyLevelChange(ntrp ? parseFloat(ntrp) : null, youth || null, "benchmark_suggested");
  }
  else if (action==="dismisslevelup"){ ui.levelSuggestionDismissed[el.getAttribute("data-key")]=true; rerender(); }
  else if (action==="invitemember"){
    var email = document.getElementById("invite-email").value.trim();
    if (!email) return;
    authClient.from("player_members").insert({player_id: player.id, invited_email: email, player_name_snapshot: player.name, role:"member", status:"invited"})
      .then(function(res){
        if (res.error) throw res.error;
        return authClient.from("player_members").select("*").eq("player_id", player.id);
      }).then(function(res){ members = res.data; rerender(); showToast("Invite sent"); })
      .catch(function(e){ alert("Could not send invite: " + e.message); });
  }
  else if (action==="removemember"){
    authClient.from("player_members").delete().eq("id", el.getAttribute("data-member"))
      .then(function(res){
        if (res.error) throw res.error;
        return authClient.from("player_members").select("*").eq("player_id", player.id);
      }).then(function(res){ members = res.data; rerender(); showToast("Member removed"); })
      .catch(function(e){ alert("Could not remove member: " + e.message); });
  }
}

function onChange(e){
  var el = e.target, action = el.getAttribute && el.getAttribute("data-action");
  if (action==="selectweek"){ ui.selectedWeek=+el.value; rerender(); }
  else if (action==="weeknotes"){
    var wk=+el.getAttribute("data-week");
    if (!state.weeklyLog[wk]) state.weeklyLog[wk]={note:""};
    state.weeklyLog[wk].note=el.value; schedulePersist();
  }
  else if (action==="statuschange"){
    var skillId=el.getAttribute("data-skill");
    state.skillStatus[skillId]=el.value; rerender(); schedulePersist();
  }
  else if (action==="benchfield"){
    var b=el.getAttribute("data-bench"), field=el.getAttribute("data-field"), val=el.value===""?null:(+el.value);
    state.benchmarks[b][field]=val; rerender(); schedulePersist();
  }
  else if (action==="benchnotes"){ var bn=el.getAttribute("data-bench"); state.benchmarks[bn].notes=el.value; schedulePersist(); }
  else if (action==="checkinfield"){
    var c=el.getAttribute("data-checkin"), cfield=el.getAttribute("data-field"), cval=el.value===""?null:(+el.value);
    state.checkins[c][cfield]=cval; schedulePersist();
  }
  else if (action==="checkinnotes"){ var cn=el.getAttribute("data-checkin"); state.checkins[cn].coachNote=el.value; schedulePersist(); }
  else if (action==="quizanswer"){
    var qi=+el.getAttribute("data-q"); if (!ui.quizAnswers[ui.quizGroup]) ui.quizAnswers[ui.quizGroup]={};
    ui.quizAnswers[ui.quizGroup][qi]=+el.value;
  }
}

/* ---------------------------- Boot ---------------------------- */
function startApp(){
  document.getElementById("app").innerHTML = renderApp();
  document.getElementById("app").addEventListener("click", onClick);
  document.getElementById("app").addEventListener("change", onChange);
}

function loadingScreen(msg){ document.getElementById("app").innerHTML = '<div class="app-loading">'+escapeHtml(msg)+'</div>'; }

function boot(client, session){
  authClient = client; authUserId = session.user.id; authUserEmail = session.user.email || "";
  if (!PLAYER_ID){ document.getElementById("app").innerHTML = '<div class="app-loading">No player selected. <a href="../index.html">Back to My Players</a></div>'; return; }
  loadingScreen("Loading…");

  Promise.all([
    client.from("players").select("*").eq("id", PLAYER_ID).maybeSingle(),
    client.from("player_levels").select("*").eq("player_id", PLAYER_ID).order("effective_date"),
    client.from("plans").select("*").eq("player_id", PLAYER_ID).eq("status", "active").maybeSingle(),
    client.from("player_members").select("*").eq("player_id", PLAYER_ID)
  ]).then(function(results){
    var pRes=results[0], lRes=results[1], planRes=results[2], mRes=results[3];
    if (pRes.error) throw pRes.error;
    if (lRes.error) throw lRes.error;
    if (planRes.error) throw planRes.error;
    if (mRes.error) throw mRes.error;
    if (!pRes.data) throw new Error("This player doesn't exist, or you don't have access to it.");
    if (!lRes.data.length) throw new Error("This player has no level set yet — it looks like it was created without completing setup. Delete it and re-add the player from My Players.");
    if (!planRes.data) throw new Error("This player has no active plan yet — it looks like it was created without completing setup. Delete it and re-add the player from My Players.");
    player = pRes.data; levelHistory = normalizeLevelRows(lRes.data); plan = planRes.data; members = mRes.data;
    document.body.setAttribute("data-player", player.pathway);

    return client.from("drill_blocks").select("*").eq("pathway", player.pathway);
  }).then(function(res){
    if (res.error) throw res.error;
    drillBlocks = normalizeBlockRows(res.data);
    return authClient.from("quiz_banks").select("*").eq("pathway", player.pathway);
  }).then(function(res){
    if (res.error) throw res.error;
    quizBanks = normalizeBlockRows(res.data);
    return authClient.from("level_thresholds").select("*").eq("pathway", player.pathway);
  }).then(function(res){
    if (res.error) throw res.error;
    thresholds = normalizeThresholdRows(res.data);
    return player.pathway === "ntrp" ? authClient.from("skill_items").select("*").eq("pathway", "ntrp") : Promise.resolve({data: [], error: null});
  }).then(function(res){
    if (res.error) throw res.error;
    skillItems = normalizeBlockRows(res.data);

    CURRICULUM = buildCurriculum({ pathway: player.pathway, levelHistory: levelHistory, quarters: plan.quarters, startDate: plan.start_date, sessionsPerWeek: player.sessions_per_week, drillBlocks: drillBlocks });
    QUIZDATA = { groups: buildQuizGroups({ pathway: player.pathway, levelHistory: levelHistory, quarters: plan.quarters, startDate: plan.start_date, quizBanks: quizBanks }) };
    TOTAL_WEEKS = plan.quarters * WEEKS_PER_QUARTER;
    BENCH_WEEKS = {}; for (var q = 1; q <= plan.quarters; q++) BENCH_WEEKS[q] = q * WEEKS_PER_QUARTER;
    ui.selectedWeek = currentWeekNumberSafe();

    return Promise.all([
      loadRemoteState(authClient, plan.id, plan.id, DEFAULT_STATE),
      loadAiCoach(authClient, player.id)
    ]);
  }).then(function(results){
    state = results[0]; startApp();
  }).catch(function(e){
    console.error("Failed to load player dashboard:", e);
    document.getElementById("app").innerHTML = '<div class="app-loading">Could not load this player: '+escapeHtml(e.message||String(e))+'</div>';
  });
}
function currentWeekNumberSafe(){
  var start = new Date(plan.start_date + "T00:00:00");
  var wk = Math.floor((new Date() - start) / 86400000 / 7) + 1;
  if (wk < 1) return 1;
  if (wk > TOTAL_WEEKS) return TOTAL_WEEKS;
  return wk;
}

function init(){ requireAuth(boot); }
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", init); else init();

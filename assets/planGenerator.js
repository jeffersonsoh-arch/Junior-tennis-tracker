/* Client-side plan generator.
   Turns (pathway, level history, quarters, start date, sessions/week) plus
   the drill_blocks library into the same CURRICULUM shape the dashboards
   already render — nothing is persisted, so a level change or a library
   edit is reflected immediately on next render, and past weeks always
   resolve against whichever level was active on their own date (R4.3). */

var WEEKS_PER_QUARTER = 13;
var WEEK_LABELS = ["Introduce & Groove", "Develop Under Light Feed", "Combine Footwork + Stroke", "Compete: Apply in Games"];

function addDaysISO(iso, n){
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* Finds the earliest delimiter that's outside any (parenthetical) —
   otherwise "Full service motion (bounce, toss, swing) into..." would
   truncate to "Full service motion (bounce" at the first inner comma. */
function clauseAt(text, delims){
  var depth = 0, idx = -1;
  for (var i = 0; i < text.length && idx === -1; i++){
    var ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && delims.indexOf(ch) !== -1) idx = i;
  }
  return idx === -1 ? text : text.slice(0, idx);
}

/* Most-recent level/stage whose effective_date is on or before the given
   week-start date; falls back to the earliest entry if the plan starts
   before any recorded level (shouldn't happen — creating a player always
   writes an initial level row). */
function resolveLevelForDate(levelHistory, dateISO){
  var sorted = levelHistory.slice().sort(function(a, b){ return a.effective_date < b.effective_date ? -1 : 1; });
  var active = sorted[0];
  sorted.forEach(function(entry){
    if (entry.effective_date <= dateISO) active = entry;
  });
  return active;
}

/* NTRP bands have distinct content per plan-quarter (progression through
   a season at the same level), matched on the `quarter` column. Youth
   rows repurpose that same column for something else entirely: it holds
   the stage's fixed position (1-4 for red_starter..orange_ready), a
   legacy stand-in for "which stage" from before stages had their own
   column. So youth progression *within* a stage is matched on
   `block_order` instead (1 = that stage's first quarter of content, 2 =
   its second, etc.) via bestYouthBlock() below — see stageQuarterFor()
   for how the current in-stage quarter number is derived. */
function blocksForBandQuarter(drillBlocks, pathway, level, quarter){
  return drillBlocks
    .filter(function(b){ return b.pathway === pathway && b.quarter === quarter && level >= b.level_min && level <= b.level_max; })
    .sort(function(a, b){ return a.block_order - b.block_order; });
}

/* How many 13-week quarters into the CURRENT stage a given week falls —
   counted from the date the player entered that stage (the level_levels
   effective_date), not the plan's own start date, so a mid-plan level
   change still starts that stage's progression back at quarter 1. */
function stageQuarterFor(stageEffectiveDateISO, weekStartISO){
  var start = new Date(stageEffectiveDateISO + "T00:00:00Z");
  var week = new Date(weekStartISO + "T00:00:00Z");
  var daysSince = Math.round((week - start) / 86400000);
  return Math.max(1, Math.floor(daysSince / (WEEKS_PER_QUARTER * 7)) + 1);
}

/* Picks the best-matching youth block for a stage at a given stage-
   relative quarter (matched on block_order — see the comment on
   blocksForBandQuarter for why `quarter` isn't usable here): an exact
   match if authored, otherwise the highest authored quarter at or below
   it (so a stage authored with only one block still works, and a player
   who plateaus at a stage past its last authored quarter keeps that
   stage's most advanced content instead of losing drill content
   entirely). */
function bestYouthBlock(drillBlocks, youthStage, desiredQuarter){
  var rows = drillBlocks
    .filter(function(b){ return b.pathway === "youth" && b.youth_stage === youthStage; })
    .sort(function(a, b){ return a.block_order - b.block_order; });
  if (!rows.length) return null;
  var exact = rows.filter(function(b){ return b.block_order === desiredQuarter; })[0];
  if (exact) return exact;
  var atOrBelow = rows.filter(function(b){ return b.block_order <= desiredQuarter; });
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : rows[0];
}

/* Splits `weeksInQuarter` weeks as evenly as possible across `n` blocks,
   front-loading the remainder (a 13-week quarter over 3 blocks: 5,4,4). */
function splitWeeks(weeksInQuarter, n){
  var base = Math.floor(weeksInQuarter / n), rem = weeksInQuarter % n, out = [];
  for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

/* Each on-court day is a real, multi-block session plan — warm-up through
   cool-down — not a single one-line focus. This matches how academy/high-
   performance junior sessions are actually structured (dynamic warm-up,
   ball control, technical reps, live-ball patterns, point play,
   competitive play, conditioning, cool-down — USTA Net Generation /
   typical academy practice-plan templates). Rather than repeat all of
   that identically every day, four profiles rotate which block is the
   "main course" — a realistic week mixes a technical day, a pattern day,
   a situational/point-play day, and a competitive day, each still
   warming up and cooling down like every real session does. Each segment
   is {label, minutes, text}; the UI renders these as a mini practice
   card instead of one flat sentence. */
var NTRP_DAY_PROFILES = [
  function(block){ // main course: technical repetition
    return [
      {label:"Warm-Up", minutes:10, text:"Dynamic movement — jog/skip, lateral shuffle, high knees, carioca — then shadow swings on both wings to prime today's stroke."},
      {label:"Technical", minutes:30, text: block.content.tech + " — build from shadow swings to a fed-ball feed, high rep count, coach correction between sets."},
      {label:"Live-Ball Application", minutes:15, text: block.content.tact + " — light cooperative rally applying the stroke just drilled, not yet at full pattern speed."},
      {label:"Conditioning", minutes:10, text: block.content.phys},
      {label:"Cool-Down", minutes:5, text: block.content.ment + " — review one takeaway before leaving the court."}
    ];
  },
  function(block){ // main course: tactical / live-ball patterns
    return [
      {label:"Warm-Up", minutes:10, text:"Dynamic movement plus short-court mini-tennis and reflex volleys to sharpen touch before full-court work."},
      {label:"Technical Review", minutes:10, text: block.content.tech + " — quick reactivation reps, not the day's focus."},
      {label:"Live-Ball Tactical Patterns", minutes:30, text: block.content.tact + " — full-speed pattern drilling with defined targets and a scoring system to keep reps honest."},
      {label:"Point Play", minutes:15, text:"Points started mid-pattern from today's tactical setup, server/feeder alternating every few points."},
      {label:"Cool-Down", minutes:5, text: block.content.ment + " — review what worked in the pattern work."}
    ];
  },
  function(block){ // main course: situational point construction
    return [
      {label:"Warm-Up", minutes:10, text:"Dynamic movement plus full-court cooperative rallying to raise intensity before live points."},
      {label:"Live-Ball Reps", minutes:15, text: block.content.tact + " — brief reactivation before points start."},
      {label:"Situational Point Play", minutes:30, text:"Points started from block scenarios (short ball, deep ball, serve+1) applying " + block.content.tech + "; play to game or set targets, not just rally count."},
      {label:"Conditioning", minutes:15, text: block.content.phys},
      {label:"Cool-Down", minutes:5, text: block.content.ment}
    ];
  },
  function(block){ // main course: competitive match play
    return [
      {label:"Warm-Up", minutes:10, text:"Full match-day warm-up sequence: groundstrokes, volleys, overheads, serves, returns — same routine as before a real match."},
      {label:"Technical & Tactical Review", minutes:10, text: block.content.tech + "; " + block.content.tact + " — brief reps of both, not extended drilling."},
      {label:"Competitive Match Play", minutes:35, text:"Sets or tiebreaks, real scoring, applying this week's focus under match conditions — no coaching mid-point."},
      {label:"Mental Review & Cool-Down", minutes:10, text: block.content.ment + " — debrief one thing that worked and one adjustment for next time."}
    ];
  }
];

function ntrpDaySegments(dayIdx, block){
  return NTRP_DAY_PROFILES[dayIdx % NTRP_DAY_PROFILES.length](block);
}

function ntrpBenchmarkDayText(slot, block){
  if (slot === 0) return "BENCHMARK TESTING — serve consistency, rally tolerance, footwork agility (see Testing Protocol)";
  if (slot === 1) return "Video review of benchmark results; targeted correction on: " + clauseAt(block.content.tech, [",", ";"]);
  if (slot === 2) return "Match simulation applying the block's tactics: " + clauseAt(block.content.tact, [";"]);
  return "Challenge match or tournament match + goal-setting review (" + block.content.ment + ")";
}
var NTRP_BENCHMARK_SLOTS = 4;

function buildNtrpCurriculum(opts){
  var totalWeeks = opts.quarters * WEEKS_PER_QUARTER;
  var weeks = [], blocksUsed = {}, blockWkRange = {};
  for (var wk = 1; wk <= totalWeeks; wk++){
    var weekStart = addDaysISO(opts.startDate, (wk - 1) * 7);
    var weekEnd = addDaysISO(weekStart, 6);
    var quarter = Math.ceil(wk / WEEKS_PER_QUARTER);
    var weekInQuarter = wk - (quarter - 1) * WEEKS_PER_QUARTER; // 1..13
    var isBenchmark = weekInQuarter === WEEKS_PER_QUARTER;

    /* Resolved against the week's END, not its start: a level change
       made mid-week (the common case — a coach levels someone up on
       whatever day they happen to be looking at the app) should show up
       in that same week's content immediately, not wait until the
       following Monday. Only a week that's fully in the past (its end
       date before the change) keeps showing the old level. */
    var levelEntry = resolveLevelForDate(opts.levelHistory, weekEnd);
    var level = levelEntry.ntrp_level;
    var quarterBlocks = blocksForBandQuarter(opts.drillBlocks, "ntrp", level, quarter);
    var spans = splitWeeks(WEEKS_PER_QUARTER, quarterBlocks.length || 1);
    var cursor = 0, block = quarterBlocks[0], idxInBlock = weekInQuarter - 1;
    for (var i = 0; i < quarterBlocks.length; i++){
      if (weekInQuarter <= cursor + spans[i]){ block = quarterBlocks[i]; idxInBlock = weekInQuarter - 1 - cursor; break; }
      cursor += spans[i];
    }
    if (block){
      blocksUsed[block.id] = block;
      if (!blockWkRange[block.id]) blockWkRange[block.id] = [wk, wk];
      else blockWkRange[block.id][1] = wk;
    }

    var week = {
      week: wk, start: weekStart, end: weekEnd,
      quarter: quarter, quarter_name: "Quarter " + quarter,
      block_id: block ? block.id : null, block_title: block ? block.title : "",
      week_label: WEEK_LABELS[idxInBlock % WEEK_LABELS.length],
      is_benchmark: isBenchmark, is_holiday: false
    };
    var n = Math.max(1, opts.sessionsPerWeek);
    for (var d = 1; d <= n; d++){
      week["day" + d] = !block ? "No drill content available yet for NTRP " + level.toFixed(1) + " — add rows to drill_blocks for this level."
        : isBenchmark ? ntrpBenchmarkDayText((d - 1) % NTRP_BENCHMARK_SLOTS, block)
        : ntrpDaySegments(d - 1, block);
    }
    weeks.push(week);
  }
  return {
    start_date: opts.startDate, end_date: weeks[weeks.length - 1].end,
    blocks: Object.keys(blocksUsed).map(function(id){
      var b = blocksUsed[id];
      return { id: b.id, wk: blockWkRange[id], q: b.quarter, title: b.title, tech: b.content.tech, tact: b.content.tact, phys: b.content.phys, ment: b.content.ment };
    }),
    quarters: (function(){ var m = {}; for (var q = 1; q <= opts.quarters; q++) m[q] = "Quarter " + q; return m; })(),
    weeks: weeks
  };
}

/* Same idea as the NTRP session profiles, scaled to real USTA Net
   Generation Red Ball / Orange Ball session lengths (45-60 min, not
   90+) and playful, age-appropriate segment names. USTA's own red/
   orange curriculum is itself organized by stroke — forehand, backhand
   (+ slice), serve, volley — so youth content gets that same structure
   instead of the old generic "skill/rally/play" grouping. */
var YOUTH_DAY_PROFILES = [
  function(block){ // groundstrokes day
    return [
      {label:"Warm-Up Game", minutes:5, text:"Ready-position freeze game plus animal-walk footwork to the net and back — energetic, no ball pressure yet."},
      {label:"Forehand Station", minutes:12, text: block.content.forehand},
      {label:"Backhand Station", minutes:12, text: block.content.backhand},
      {label:"Rally Game", minutes:10, text:"Cooperative rally applying today's forehand and backhand reps — count together and try to beat the team's best streak."},
      {label:"Cool-Down", minutes:3, text:"High-fives and a quick 'what did we work on today?' recap."}
    ];
  },
  function(block){ // net game day
    return [
      {label:"Warm-Up Game", minutes:5, text:"Balloon-keepy-uppy or a reflex-catch game to wake up the hands."},
      {label:"Volley Station", minutes:15, text: block.content.volley},
      {label:"Net-Point Game", minutes:12, text:"Live points started with a feed to the net position, applying today's volley work."},
      {label:"Cool-Down", minutes:3, text:"Quick stretch and one 'what worked' share."}
    ];
  },
  function(block){ // serve & footwork day
    return [
      {label:"Warm-Up Game", minutes:5, text:"Freeze-tag ready position plus a split-step reaction game."},
      {label:"Serve Station", minutes:12, text: block.content.serve},
      {label:"Footwork Station", minutes:10, text: block.content.footwork},
      {label:"Serve-and-Play Game", minutes:10, text:"Serve into a target zone, then play the point out — first to 5 points."},
      {label:"Cool-Down", minutes:3, text:"Quick stretch and a shout-out for today's best serve."}
    ];
  },
  function(block){ // play day
    return [
      {label:"Warm-Up Game", minutes:5, text:"Quick full-body activation game to get moving before match play."},
      {label:"Quick Skill Refresh", minutes:8, text: block.content.forehand + " / " + block.content.backhand + " — a few reps of each, not the day's focus."},
      {label:"Match Play", minutes:20, text: block.content.game},
      {label:"Cool-Down & Celebration", minutes:5, text:"Handshake routine, sticker chart check-in, and a shout-out for one good shot from today."}
    ];
  }
];

function youthDaySegments(dayIdx, block){
  return YOUTH_DAY_PROFILES[dayIdx % YOUTH_DAY_PROFILES.length](block);
}

var YOUTH_CHECKPOINT_SLOTS = [
  "Badge Day: try out for any badge that's ready — no pressure, just a fun check-in.",
  "Coach plays quick mini-games to see how each skill is coming along.",
  "Celebration mini-match + badge stickers handed out for anything earned this stage."
];

/* One stage entry per configured quarter, id = quarter number — this is
   what renderOverview's stage-path and stageById(w.stage_id) lookups key
   on. If a manual level change lands mid-quarter, each week's own day
   text still resolves against whichever stage was active that week; the
   summary entry represents the quarter by the stage active at its first
   week, which keeps stage_id and the stages array in lockstep even when
   they don't quite agree with a week deep inside the quarter. */
function buildYouthCurriculum(opts){
  var totalWeeks = opts.quarters * WEEKS_PER_QUARTER;
  var weeks = [], stages = [];
  for (var q = 1; q <= opts.quarters; q++){
    // Resolved against the quarter's end (not its start), so this
    // summary stays in sync with the per-week resolution below when a
    // level change lands mid-quarter.
    var qEnd = addDaysISO(opts.startDate, q * WEEKS_PER_QUARTER * 7 - 1);
    var qLevel = resolveLevelForDate(opts.levelHistory, qEnd);
    // name/blurb/badges represent the stage itself, not a particular
    // quarter within it, and are duplicated across a stage's authored
    // quarter rows — any match for the stage carries the same values.
    var qBlock = bestYouthBlock(opts.drillBlocks, qLevel.youth_stage, 1);
    stages.push(qBlock
      ? { id: q, name: qBlock.content.name, blurb: qBlock.content.blurb, badges: qBlock.content.badges }
      : { id: q, name: "Quarter " + q, blurb: "", badges: [] });
  }
  for (var wk = 1; wk <= totalWeeks; wk++){
    var weekStart = addDaysISO(opts.startDate, (wk - 1) * 7);
    var weekEnd = addDaysISO(weekStart, 6);
    var quarter = Math.ceil(wk / WEEKS_PER_QUARTER);
    var weekInQuarter = wk - (quarter - 1) * WEEKS_PER_QUARTER;
    var isCheckpoint = weekInQuarter === WEEKS_PER_QUARTER;

    // Resolved against the week's end, not its start — see the matching
    // comment in buildNtrpCurriculum for why.
    var levelEntry = resolveLevelForDate(opts.levelHistory, weekEnd);
    var stageQuarter = stageQuarterFor(levelEntry.effective_date, weekEnd);
    var block = bestYouthBlock(opts.drillBlocks, levelEntry.youth_stage, stageQuarter);

    var week = {
      week: wk, start: weekStart, end: weekEnd,
      stage_id: quarter, stage_name: block ? block.content.name : stages[quarter - 1].name,
      is_checkpoint: isCheckpoint, is_holiday: false
    };
    var n = Math.max(1, opts.sessionsPerWeek);
    for (var d = 1; d <= n; d++){
      week["day" + d] = !block ? "No drill content available yet for this stage — add rows to drill_blocks."
        : isCheckpoint ? YOUTH_CHECKPOINT_SLOTS[(d - 1) % YOUTH_CHECKPOINT_SLOTS.length]
        : youthDaySegments(d - 1, block);
    }
    weeks.push(week);
  }
  return { start_date: opts.startDate, end_date: weeks[weeks.length - 1].end, stages: stages, weeks: weeks };
}

function buildCurriculum(opts){
  return opts.pathway === "ntrp" ? buildNtrpCurriculum(opts) : buildYouthCurriculum(opts);
}

/* Groups quiz_banks rows into one entry per quarter that has an authored
   bank for the level/stage active at that quarter's start — sparse by
   design (see schema.sql comment on quiz_banks), so a level with no quiz
   content yet just contributes no group. */
function buildQuizGroups(opts){
  var groups = [];
  for (var q = 1; q <= opts.quarters; q++){
    var qStart = addDaysISO(opts.startDate, (q - 1) * WEEKS_PER_QUARTER * 7);
    var levelEntry = resolveLevelForDate(opts.levelHistory, qStart);
    var bank = opts.quizBanks.filter(function(b){
      if (b.pathway !== opts.pathway || b.quarter !== q) return false;
      if (opts.pathway === "ntrp") return levelEntry.ntrp_level >= b.level_min && levelEntry.ntrp_level <= b.level_max;
      return b.youth_stage === levelEntry.youth_stage;
    })[0];
    if (bank) groups.push({ id: q, name: "Quarter " + q, questions: bank.questions });
  }
  return groups;
}

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

function clauseAt(text, delims){
  var idx = -1;
  delims.forEach(function(d){
    var i = text.indexOf(d);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  });
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

function blocksForBandQuarter(drillBlocks, pathway, level, youthStage, quarter){
  return drillBlocks
    .filter(function(b){
      if (b.pathway !== pathway || b.quarter !== quarter) return false;
      if (pathway === "ntrp") return level >= b.level_min && level <= b.level_max;
      return b.youth_stage === youthStage;
    })
    .sort(function(a, b){ return a.block_order - b.block_order; });
}

/* Splits `weeksInQuarter` weeks as evenly as possible across `n` blocks,
   front-loading the remainder (a 13-week quarter over 3 blocks: 5,4,4). */
function splitWeeks(weeksInQuarter, n){
  var base = Math.floor(weeksInQuarter / n), rem = weeksInQuarter % n, out = [];
  for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

function ntrpDayText(category, block){
  if (category === "technical") return "Technical: " + block.content.tech + " — fed-ball reps + shadow work";
  if (category === "tactical") return "Tactical Patterns: " + block.content.tact + " — live-ball target drilling";
  if (category === "situational") return "Situational Play: points started from block scenarios; physical focus: " + block.content.phys;
  return "Competitive Match Play: sets/tiebreaks applying the week's focus; mental skill: " + block.content.ment;
}
var NTRP_CATEGORIES = ["technical", "tactical", "situational", "competitive"];

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

    var levelEntry = resolveLevelForDate(opts.levelHistory, weekStart);
    var level = levelEntry.ntrp_level;
    var quarterBlocks = blocksForBandQuarter(opts.drillBlocks, "ntrp", level, null, quarter);
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
      week["day" + d] = block ? (isBenchmark ? ntrpBenchmarkDayText((d - 1) % NTRP_BENCHMARK_SLOTS, block) : ntrpDayText(NTRP_CATEGORIES[(d - 1) % NTRP_CATEGORIES.length], block))
        : "No drill content available yet for NTRP " + level.toFixed(1) + " — add rows to drill_blocks for this level.";
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

var YOUTH_CATEGORIES = ["skill", "rally", "play"];
function youthDayText(category, block, cyc){
  var label = category === "skill" ? "Skill Builder: " : category === "rally" ? "Rally Games: " : "Play Day: ";
  return label + block.content[category][cyc % block.content[category].length];
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
    var qStart = addDaysISO(opts.startDate, (q - 1) * WEEKS_PER_QUARTER * 7);
    var qLevel = resolveLevelForDate(opts.levelHistory, qStart);
    var qBlock = blocksForBandQuarter(opts.drillBlocks, "youth", null, qLevel.youth_stage, q)[0];
    stages.push(qBlock
      ? { id: q, name: qBlock.content.name, blurb: qBlock.content.blurb, badges: qBlock.content.badges, skill: qBlock.content.skill, rally: qBlock.content.rally, play: qBlock.content.play }
      : { id: q, name: "Quarter " + q, blurb: "", badges: [], skill: [], rally: [], play: [] });
  }
  for (var wk = 1; wk <= totalWeeks; wk++){
    var weekStart = addDaysISO(opts.startDate, (wk - 1) * 7);
    var weekEnd = addDaysISO(weekStart, 6);
    var quarter = Math.ceil(wk / WEEKS_PER_QUARTER);
    var weekInQuarter = wk - (quarter - 1) * WEEKS_PER_QUARTER;
    var isCheckpoint = weekInQuarter === WEEKS_PER_QUARTER;

    var levelEntry = resolveLevelForDate(opts.levelHistory, weekStart);
    var block = blocksForBandQuarter(opts.drillBlocks, "youth", null, levelEntry.youth_stage, quarter)[0];
    var cyc = (weekInQuarter - 1) % 6;

    var week = {
      week: wk, start: weekStart, end: weekEnd,
      stage_id: quarter, stage_name: block ? block.content.name : stages[quarter - 1].name,
      is_checkpoint: isCheckpoint, is_holiday: false
    };
    var n = Math.max(1, opts.sessionsPerWeek);
    for (var d = 1; d <= n; d++){
      week["day" + d] = !block ? "No drill content available yet for this stage — add rows to drill_blocks."
        : isCheckpoint ? YOUTH_CHECKPOINT_SLOTS[(d - 1) % YOUTH_CHECKPOINT_SLOTS.length]
        : youthDayText(YOUTH_CATEGORIES[(d - 1) % YOUTH_CATEGORIES.length], block, cyc);
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

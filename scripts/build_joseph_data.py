import json, datetime

start = datetime.date(2026, 9, 7)  # same season as Judah's, Monday
TOTAL_WEEKS = 52
HOLIDAY_WEEKS = {12, 16, 17}
CHECKPOINT_WEEKS = {13, 26, 39, 52}

STAGES = [
    dict(id=1, wk=(1,13), name="Red Starter",
         blurb="Ball tracking, balance, catching, and first taps with the racquet — no rallying pressure yet, just games.",
         badges=["Bounce & Catch","Ready-Position Freeze Game","Balloon Volley Rally","Rolling-Ball Scoop Pickup","Underhand Toss to a Target","Racquet Balance Walk"],
         skill=["Bounce a ball and catch it in a cup or hand, 5 times in a row","Practice the 'freeze' ready position on a clap or whistle cue","Volley a balloon back and forth without letting it touch the ground","Scoop up rolling balls with the racquet face, no hands","Underhand toss a ball into a hoop or box target","Balance a ball on the racquet while walking a line"],
         rally=["Bounce-and-catch relay race with a partner","Balloon rally: keep it up as a team, count together","Roll-and-catch with a partner across a short distance","Toss-and-catch over a low rope or line","Freeze-tag ready position game","Animal-walk footwork game to the net and back"],
         play=["Sticker chart check: which skills are 'green light' today?","Team balloon-keepy-uppy challenge, beat yesterday's count","Obstacle course mixing today's skills","Simon Says with tennis ready positions","Coach vs. kid toss-and-catch challenge","Show-and-tell: demonstrate one badge skill to a grown-up"]),
    dict(id=2, wk=(14,26), name="Red Rally",
         blurb="First real racquet-and-ball rallying on the mini (36-ft) red-ball court, plus first serves.",
         badges=["Self-Bounce Rally (3 hits)","Forehand Contact Point","Backhand Contact Point","Sideways Shuffle Steps","Mini-Court Feed Rally (5 balls)","Drop-and-Hit Serve"],
         skill=["Bounce the ball off the racquet 3 times in a row, self-fed","Forehand: hit a fed ball back over a low net to a target","Backhand: hit a fed ball back over a low net to a target","Sideways shuffle steps to reach a ball, no crossing feet","Rally with the coach, catch-feed style, 5 balls in a row","Practice a simple drop-and-hit serve into the box"],
         rally=["Mini-court rally game: how many in a row?","Forehand target game — hit the cone, score a point","Backhand target game — hit the cone, score a point","Shuffle-step shadow game before every rally","Coach-feed rally ladder: 3, then 5, then 7 in a row","Serve ladder: serve into 3 different colored zones"],
         play=["Mini-match: first to 5 points, underhand serves allowed","Rally-counting contest with a partner","Team rally relay — keep the ball going across 3 players","Serve-and-catch mini game","Badge check-in: try for a new badge today","Fun match with silly bonus points for good ready position"]),
    dict(id=3, wk=(27,39), name="Red Game Player",
         blurb="Real mini-tennis scoring, court positioning, and the first lessons in sportsmanship.",
         badges=["Count-to-7 Scoring","Two-Bounce Rule Understanding","Court Position Awareness","Doubles Teamwork Game","Good-Sport Handshake","Call-Your-Own-Line Honesty"],
         skill=["Practice counting score out loud during a mini-game","Two-bounce rule drills — when is the point over?","Practice moving back to the middle after every shot","Doubles positioning game with a partner","Practice a good-sport handshake and 'good shot!'","Practice calling a ball in/out honestly during a drill"],
         rally=["Mini-match with the player keeping their own score","Two-bounce scramble game","Center-recovery rally game","Doubles mini-game, 2v1 or 2v2 with a helper","Rally + handshake ritual after every game","Line-calling practice game with cones as lines"],
         play=["Full mini-match on the red-ball court, real scoring","Team doubles mini-tournament with friends/siblings","'Good sport of the day' award game","Best-of-3 mini-games with handshakes after each","Court-awareness obstacle relay","Badge check-in: mini-match performance review"]),
    dict(id=4, wk=(40,52), name="Orange Ready",
         blurb="Stretching rallies longer, first shot-selection ideas, and getting comfortable on the bigger orange-ball court.",
         badges=["Sustained Rally (5+ both sides)","Move-Up on a Short Ball","Stay-Back on a Deep Ball","Play a Mini-Tournament","Orange-Ball Comfort Rally","Serve Into the Box (3 in a row)"],
         skill=["Sustained rally with the coach, 5+ balls each side","'Short ball, move up!' recognition game","'Deep ball, stay back!' recognition game","Practice tournament routines: warm-up, score, handshake","First rallies on the bigger orange-ball court","Serve practice: land 3 in a row inside the box"],
         rally=["Rally-extension ladder: beat your longest rally","Short-ball vs. deep-ball sorting game","Orange-court rally with more running room","Serve ladder on the orange court","Mixed red/orange ball rally challenge","Partner rally with a shot-selection call-out game"],
         play=["Mini-tournament day — real matches, real scoring","Orange-ball fun match","Season badge ceremony rehearsal","Serve challenge contest","Longest-rally leaderboard game","Celebration match: play every skill learned this year"]),
]

def stage_by_week(wk):
    for s in STAGES:
        if s["wk"][0] <= wk <= s["wk"][1]:
            return s
    return STAGES[-1]

def week_index_in_stage(s, wk):
    return wk - s["wk"][0]  # 0-based

weeks_out = []
for wk in range(1, TOTAL_WEEKS+1):
    s = stage_by_week(wk)
    idx = week_index_in_stage(s, wk)
    n = len(s["skill"])
    cyc = idx % n
    ws = start + datetime.timedelta(weeks=wk-1)
    we = ws + datetime.timedelta(days=6)
    is_checkpoint = wk in CHECKPOINT_WEEKS
    is_holiday = wk in HOLIDAY_WEEKS
    if is_checkpoint:
        day1 = "Badge Day: try out for any badge that's ready — no pressure, just a fun check-in."
        day2 = "Coach plays quick mini-games with Joseph to see how each skill is coming along."
        day3 = "Celebration mini-match + badge stickers handed out for anything earned this stage."
    elif is_holiday:
        day1 = "Optional light play — " + s["skill"][cyc]
        day2 = "Optional family game — " + s["rally"][cyc]
        day3 = "Optional — free play, no pressure this week"
    else:
        day1 = "Skill Builder: " + s["skill"][cyc]
        day2 = "Rally Games: " + s["rally"][cyc]
        day3 = "Play Day: " + s["play"][cyc]
    weeks_out.append(dict(
        week=wk, start=ws.isoformat(), end=we.isoformat(),
        stage_id=s["id"], stage_name=s["name"],
        is_checkpoint=is_checkpoint, is_holiday=is_holiday,
        day1=day1, day2=day2, day3=day3,
    ))

data = dict(
    start_date=start.isoformat(),
    end_date=(start + datetime.timedelta(weeks=TOTAL_WEEKS) - datetime.timedelta(days=1)).isoformat(),
    stages=STAGES,
    weeks=weeks_out,
)
with open("joseph/data_curriculum.json", "w") as f:
    json.dump(data, f, indent=2)
print("weeks:", len(weeks_out), "checkpoints:", sorted(CHECKPOINT_WEEKS), "holidays:", sorted(HOLIDAY_WEEKS))

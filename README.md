# Deuce Board — Junior Tennis Development Platform

A multi-tenant junior tennis development tracker — static HTML/CSS/JS frontend (deployed on GitHub Pages) backed by a hosted [Supabase](https://supabase.com) project (Postgres, auth, and Row Level Security). Any parent or coach can sign up, add as many players as they coach, and get a training plan generated for each one:

- **Any NTRP level, 1.0–7.0** — the real half-point USTA scale, not a simplified 7-level version. Content is pulled from a shared drill library (`drill_blocks`) rather than hand-authored per player.
- **A separate youth on-ramp** — the standard red-ball → orange-ball pathway (Red Starter → Red Rally → Red Game Player → Orange Ready) for players below NTRP 1.0, with a "graduate to NTRP" action once they're ready.
- **Coach-chosen plan length** — 1 to 4 quarters (13 weeks each), not a fixed 52-week season.
- **Level up or down at any time** — manually, or accepted from a benchmark-suggested nudge — with full level history kept so past weeks always show what was actually assigned.
- **Shareable players** — invite a second parent or a coach by email; they get full access without owning the account that created the player.
- **AI Coach** — a per-player chat tab that knows the player's pathway and current level, can suggest drills and full session plans, and lets you save anything useful straight into that player's own saved-drills list.

Open `index.html` — you'll be asked to sign in (or create an account) first, then see every player you have access to, with a button to add another.

## Backend setup (one-time)

The site talks to Supabase directly from the browser — there's no server to deploy, but you do need a Supabase project:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, open **SQL Editor → New query**, and run, in order:
   1. [`supabase/schema.sql`](supabase/schema.sql) — tables, triggers, and Row Level Security policies.
   2. [`supabase/seed_drill_library.sql`](supabase/seed_drill_library.sql) — the drill content library (48 blocks across all 13 NTRP levels + the youth pathway) and benchmark thresholds.
   3. [`supabase/seed_skill_items.sql`](supabase/seed_skill_items.sql) — the Skill Checklist taxonomy (162 rows: 18 stroke-by-stroke skills × all 9 NTRP level bands).
   4. [`supabase/seed_quiz_banks.sql`](supabase/seed_quiz_banks.sql) — quiz questions (currently authored for NTRP 3.5 and the youth pathway only; other levels show "not yet written" in the Quiz tab until more banks are added).

   If you already ran `schema.sql` once for an earlier version of this project (i.e. you already have players/plans data you don't want to lose), also run [`supabase/patch_ai_coach.sql`](supabase/patch_ai_coach.sql) — it only adds the two new AI Coach tables and doesn't touch anything else. A fresh `schema.sql` run already includes them.
3. Under **Authentication → Providers**, confirm **Email** is enabled (it is by default). You may also want to turn off "Confirm email" under **Authentication → Settings** so a new sign-up doesn't need to click an email link before their first session.
4. Under **Project Settings → API**, copy the **Project URL** and **anon public** key into [`assets/config.js`](assets/config.js), replacing the two placeholder strings. The anon key is meant to be public — it only grants what the RLS policies in `schema.sql` allow.
5. Commit and push `assets/config.js` (or keep it out of version control and set it at deploy time, if you'd rather not commit even a non-secret key).
6. **AI Coach (optional)** — this feature calls [Groq](https://groq.com)'s API (free tier, no credit card) from a Supabase Edge Function, never from the browser, so your API key is never exposed to visitors. To enable it:
   1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run `supabase link --project-ref <your-project-ref>` from the repo root.
   2. `supabase secrets set GROQ_API_KEY=gsk_...` (get a free key at [console.groq.com/keys](https://console.groq.com/keys) — no card required).
   3. `supabase functions deploy ai-coach`
   4. That's it — the AI Coach tab on every player's dashboard now works. Without this step the tab still shows (chat history and saved items still load), but sending a message fails: with the secret unset it replies with a friendly "AI Coach isn't configured yet" error; without the function deployed at all, it's a generic network/invoke error instead.
   5. Optional: `supabase secrets set GROQ_MODEL=llama-3.3-70b-versatile` to use a different Groq-hosted model (this is already the default).

## How it fits together

- **`players`** — name, birth year, pathway (`ntrp` or `youth`), sessions/week. Deliberately minimal — no other PII is stored.
- **`player_members`** — who can access a player. The creator is `role: owner`; anyone invited by email is `role: member`. RLS on every player-scoped table resolves through this table, not a direct owner column, so sharing works without any table needing to know about it directly.
- **`player_levels`** — an append-only history of NTRP level or youth stage, each with an effective date. Never edited or deleted, so a plan always shows what was actually assigned on any given week, even after a level change.
- **`plans`** — just `player_id`, `quarters` (1–4), and `start_date`. No curriculum content is stored here.
- **`drill_blocks` / `quiz_banks` / `level_thresholds` / `skill_items`** — the shared content library, read-only from the client. A `drill_blocks` row covers one quarter for either an NTRP level band or a youth stage; `assets/planGenerator.js` assembles the right blocks into the same week-by-week shape the dashboards render, resolving each week against whichever level was active *on that week's date* — a level change is never a rewrite of history. `skill_items` is separate: an 18-skill, stroke-by-stroke NTRP checklist (forehand/backhand by shot type, net game, all three serve types, movement, warm-up), each with a level-appropriate description at every band — tracked continuously against the player's *current* level, not tied to any one week.
- **Every day — NTRP and youth alike — is a real practice plan, not a one-liner.** Each non-checkpoint day is generated as a sequence of timed segments (warm-up, main drill work, live/point play, cool-down) mirroring how USTA Net Generation and academy practice-plan templates actually structure a session, rather than a single sentence naming one focus. NTRP rotates four ~65-75 min profiles (technical-focus / tactical-pattern-focus / situational-point-play-focus / competitive-match-play-focus); the youth red/orange pathway rotates four shorter, playful ~35-45 min profiles (groundstrokes day / net-game day / serve-and-footwork day / play day) matching real USTA Red Ball and Orange Ball session lengths. Benchmark/checkpoint weeks stay single-line by design — a testing week or a badge day isn't a normal session.
- **The youth pathway is stroke-specific too, not generic.** USTA's own Red Ball and Orange Ball curriculum is itself organized by stroke (forehand, backhand + slice, serve, volley), so `drill_blocks` content for each of the 4 stages is broken into forehand / backhand / volley / serve / footwork / game fields — the same shape as the NTRP technical track, just scaled to age-appropriate mechanics (grip checks and racquet-face awareness at Red Starter, real topspin shape and serve-box targets by Orange Ready) instead of a flat "skill/rally/play" list.
- **`player_progress`** — one JSON row per plan (weekly log, badges/skills, benchmarks/check-ins, quiz results), synced to Supabase on a debounce and cached in `localStorage` as an offline fallback.
- **`ai_conversations` / `ai_saved_items`** — the AI Coach tab. One chat thread per player (`ai_conversations`, upserted whole after each reply, same pattern as `player_progress`); anything the AI proposes and a coach chooses to keep becomes a row in `ai_saved_items` with the same `{label, minutes, text}` segment shape as a generated plan day, so it reuses the same renderer. The chat itself is served by `supabase/functions/ai-coach`, a Supabase Edge Function — the only place in this project that talks to a third-party API (currently [Groq](https://groq.com), free tier), kept server-side so the key is never shipped to the browser. It forwards the caller's own Supabase session, so it's still bound by the same `player_members` RLS as everything else: you can only get AI help for a player you actually have access to.

## Content library coverage

`drill_blocks` has real, level-appropriate content for all 13 NTRP levels and all 4 youth stages — 9 level bands (1.0–1.5, 2.0–2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5–6.0, 6.5–7.0), each with one block per quarter. The 3.5 band and the youth pathway carry the deepest, most granular content (migrated from this project's original hand-authored plans); the other 8 bands are a solid starting seed synthesized from USTA's published level characteristics — real and usable, but worth a coach's review before treating it as the only source of truth. `skill_items` covers all 9 NTRP bands too, with a full 18-skill breakdown at each: forehand and backhand by shot type (high ball, low ball, topspin, slice, drop shot), overhead, forehand/backhand volleys, all three serve types (flat, slice, kick), footwork, and warm-up. `quiz_banks` is sparser: only NTRP 3.5 and the youth pathway have authored questions today.

## Hosting

Deployed via GitHub Pages using the included GitHub Actions workflow (`.github/workflows/pages.yml`). In the repo's **Settings → Pages**, set the source to **GitHub Actions** — pushes to `main` deploy automatically. The backend (Supabase) is hosted separately and configured once via `assets/config.js` (see above).

## Structure

```
index.html                  My Players — sign-in gate, player list, add-player, invite acceptance
player/index.html           Generic player dashboard (any level, any pathway) — ?id=<player-uuid>
supabase/schema.sql          Database schema, triggers, and RLS policies
supabase/seed_drill_library.sql   drill_blocks + level_thresholds seed content
supabase/seed_skill_items.sql     skill_items seed content (the Skill Checklist taxonomy)
supabase/seed_quiz_banks.sql      quiz_banks seed content
supabase/patch_youth_drill_content.sql   one-time UPDATE patch for the youth stroke-specific rewrite (already-seeded DBs only — a fresh seed_drill_library.sql run doesn't need it)
supabase/patch_ai_coach.sql       one-time additive patch adding the AI Coach tables (already-seeded DBs only — a fresh schema.sql run doesn't need it)
supabase/functions/ai-coach/index.ts   Edge Function: calls Anthropic server-side, gated by the caller's own RLS session
assets/config.js             Your Supabase project URL + anon key
assets/supabaseClient.js     Shared Supabase client singleton
assets/auth.js               Login / signup / password-reset UI + session gate
assets/style.css             Shared design tokens + components ([data-player="ntrp"|"youth"] theming)
assets/icons.js               Shared nav icons
assets/storage.js             Supabase read/write helpers + localStorage cache + JSON backup/restore
assets/planGenerator.js       Turns (pathway, level history, quarters, drill_blocks) into a rendered plan
assets/aiCoach.js             AI Coach tab: chat UI, calls the ai-coach Edge Function, saves proposals per player
assets/dashboardApp.js        The dashboard itself: tabs, rendering, event wiring, level-change, sharing
```

## Known gaps (v1)

- **Quiz content** exists only for NTRP 3.5 and the youth pathway — other levels show a "not yet written" message rather than thin filler questions.
- **No holiday-week calendar logic** — a generated plan has normal weeks and one benchmark/check-in week per quarter; it doesn't know about real-world holidays the way the original hand-authored Judah/Joseph plans did.
- **Level-up thresholds are one flat target per level**, not a season-long progression curve — good enough to gate a real suggestion, but a coach should sanity-check it against `level_thresholds` in the SQL editor.
- **AI Coach has one chat thread per player**, not a history of separate conversations — a new question just continues the same thread. It also doesn't yet see the player's actual weekly log, skill checklist, or quiz results, only their pathway/level/sessions-per-week — so it can't yet ground a suggestion in what's actually been logged.

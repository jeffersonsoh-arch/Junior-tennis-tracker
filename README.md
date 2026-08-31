# Deuce Board — Junior Tennis Development Platform

A multi-tenant junior tennis development tracker — static HTML/CSS/JS frontend (deployed on GitHub Pages) backed by a hosted [Supabase](https://supabase.com) project (Postgres, auth, and Row Level Security). Any parent or coach can sign up, add as many players as they coach, and get a training plan generated for each one:

- **Any NTRP level, 1.0–7.0** — the real half-point USTA scale, not a simplified 7-level version. Content is pulled from a shared drill library (`drill_blocks`) rather than hand-authored per player.
- **A separate youth on-ramp** — the standard red-ball → orange-ball pathway (Red Starter → Red Rally → Red Game Player → Orange Ready) for players below NTRP 1.0, with a "graduate to NTRP" action once they're ready.
- **Coach-chosen plan length** — 1 to 4 quarters (13 weeks each), not a fixed 52-week season.
- **Level up or down at any time** — manually, or accepted from a benchmark-suggested nudge — with full level history kept so past weeks always show what was actually assigned.
- **Shareable players** — invite a second parent or a coach by email; they get full access without owning the account that created the player.

Open `index.html` — you'll be asked to sign in (or create an account) first, then see every player you have access to, with a button to add another.

## Backend setup (one-time)

The site talks to Supabase directly from the browser — there's no server to deploy, but you do need a Supabase project:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, open **SQL Editor → New query**, and run, in order:
   1. [`supabase/schema.sql`](supabase/schema.sql) — tables, triggers, and Row Level Security policies.
   2. [`supabase/seed_drill_library.sql`](supabase/seed_drill_library.sql) — the drill content library (48 blocks across all 13 NTRP levels + the youth pathway) and benchmark thresholds.
   3. [`supabase/seed_skill_items.sql`](supabase/seed_skill_items.sql) — the Skill Checklist taxonomy (162 rows: 18 stroke-by-stroke skills × all 9 NTRP level bands).
   4. [`supabase/seed_quiz_banks.sql`](supabase/seed_quiz_banks.sql) — quiz questions (currently authored for NTRP 3.5 and the youth pathway only; other levels show "not yet written" in the Quiz tab until more banks are added).
3. Under **Authentication → Providers**, confirm **Email** is enabled (it is by default). You may also want to turn off "Confirm email" under **Authentication → Settings** so a new sign-up doesn't need to click an email link before their first session.
4. Under **Project Settings → API**, copy the **Project URL** and **anon public** key into [`assets/config.js`](assets/config.js), replacing the two placeholder strings. The anon key is meant to be public — it only grants what the RLS policies in `schema.sql` allow.
5. Commit and push `assets/config.js` (or keep it out of version control and set it at deploy time, if you'd rather not commit even a non-secret key).

## How it fits together

- **`players`** — name, birth year, pathway (`ntrp` or `youth`), sessions/week. Deliberately minimal — no other PII is stored.
- **`player_members`** — who can access a player. The creator is `role: owner`; anyone invited by email is `role: member`. RLS on every player-scoped table resolves through this table, not a direct owner column, so sharing works without any table needing to know about it directly.
- **`player_levels`** — an append-only history of NTRP level or youth stage, each with an effective date. Never edited or deleted, so a plan always shows what was actually assigned on any given week, even after a level change.
- **`plans`** — just `player_id`, `quarters` (1–4), and `start_date`. No curriculum content is stored here.
- **`drill_blocks` / `quiz_banks` / `level_thresholds` / `skill_items`** — the shared content library, read-only from the client. A `drill_blocks` row covers one quarter for either an NTRP level band or a youth stage; `assets/planGenerator.js` assembles the right blocks into the same week-by-week shape the dashboards render, resolving each week against whichever level was active *on that week's date* — a level change is never a rewrite of history. `skill_items` is separate: an 18-skill, stroke-by-stroke NTRP checklist (forehand/backhand by shot type, net game, all three serve types, movement, warm-up), each with a level-appropriate description at every band — tracked continuously against the player's *current* level, not tied to any one week.
- **NTRP daily sessions are real practice plans, not one-liners.** Each non-benchmark day is generated as a sequence of timed segments — warm-up, technical reps, live-ball/tactical patterns, point play, conditioning, cool-down — mirroring how USTA Net Generation and academy practice-plan templates actually structure a session, rather than a single sentence naming one focus. Four rotating profiles (technical-focus / tactical-pattern-focus / situational-point-play-focus / competitive-match-play-focus) keep a week from feeling repetitive while every day still warms up and cools down like a real one. Benchmark weeks and the youth pathway stay single-line, appropriately simpler for a testing week or a 6-year-old's session.
- **`player_progress`** — one JSON row per plan (weekly log, badges/skills, benchmarks/check-ins, quiz results), synced to Supabase on a debounce and cached in `localStorage` as an offline fallback.

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
assets/config.js             Your Supabase project URL + anon key
assets/supabaseClient.js     Shared Supabase client singleton
assets/auth.js               Login / signup / password-reset UI + session gate
assets/style.css             Shared design tokens + components ([data-player="ntrp"|"youth"] theming)
assets/icons.js               Shared nav icons
assets/storage.js             Supabase read/write helpers + localStorage cache + JSON backup/restore
assets/planGenerator.js       Turns (pathway, level history, quarters, drill_blocks) into a rendered plan
assets/dashboardApp.js        The dashboard itself: tabs, rendering, event wiring, level-change, sharing
```

## Known gaps (v1)

- **Quiz content** exists only for NTRP 3.5 and the youth pathway — other levels show a "not yet written" message rather than thin filler questions.
- **No holiday-week calendar logic** — a generated plan has normal weeks and one benchmark/check-in week per quarter; it doesn't know about real-world holidays the way the original hand-authored Judah/Joseph plans did.
- **Level-up thresholds are one flat target per level**, not a season-long progression curve — good enough to gate a real suggestion, but a coach should sanity-check it against `level_thresholds` in the SQL editor.

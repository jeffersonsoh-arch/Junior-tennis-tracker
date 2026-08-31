# Deuce Board — Family Tennis Tracker

A junior tennis development tracker for two players — static HTML/CSS/JS frontend (deployed on GitHub Pages) backed by a hosted [Supabase](https://supabase.com) project (Postgres + email/password auth) so progress syncs across devices:

- **[Judah](judah/index.html)** — age 10, NTRP 3.5, 4 sessions/week. Full 52-week periodized plan (quarters → mesocycle blocks → weekly sessions), a 48-item technical/tactical/physical/mental skill checklist, 4 benchmark testing weeks, and a 40-question tactical strategy quiz.
- **[Joseph](joseph/index.html)** — age 6, NTRP 2.5, 3 sessions/week. A distinct, age-appropriate red-ball → orange-ball pathway across 4 stages, 24 skill badges, 4 simple check-ins, and a 12-question picture-simple strategy quiz.

Open `index.html` to pick a player. You'll be asked to sign in first (see setup below).

## Backend setup (one-time)

The site talks to Supabase directly from the browser — there's no server to deploy, but you do need a Supabase project:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the `player_progress` table with Row Level Security so each signed-in account can only see its own data.
3. Under **Authentication → Providers**, confirm **Email** is enabled (it is by default). For a family app you may also want to turn off "Confirm email" under **Authentication → Settings** so the first sign-up doesn't need to click an email link.
4. Under **Project Settings → API**, copy the **Project URL** and **anon public** key into [`assets/config.js`](assets/config.js), replacing the two placeholder strings. The anon key is meant to be public — it only grants what the RLS policy in `schema.sql` allows.
5. Commit and push `assets/config.js` (or keep it out of version control and set it at deploy time, if you'd rather not commit even a non-secret key).

Once configured, the first visit to the site prompts you to create an account (email + password) — one account covers both players, distinguished by a `player` column. Sign in again on any other device to see the same progress.

## How progress is saved

Each dashboard reads/writes a single JSON row per player (`player_progress.data`) in Supabase, debounced ~500ms after each change. The previous local-only copy is kept as a resilience layer, not the source of truth:

- A copy of the last-synced state is cached in the browser's `localStorage`, so the app still loads (read-only-ish, last-known state) if the network is briefly down, and a save that fails to reach Supabase falls back to saving locally instead of being lost silently.
- The first time a signed-in account opens a player with no Supabase row yet, it seeds the row from any pre-existing local backup for that browser (useful if you used an earlier, localStorage-only version of this site).

Every dashboard still has **Backup** (downloads a `.json` snapshot of that player's progress) and **Restore** (loads a previously downloaded snapshot, then syncs it up) buttons in the sidebar for manual, out-of-band copies.

## Hosting

Deployed via GitHub Pages using the included GitHub Actions workflow (`.github/workflows/pages.yml`). In the repo's **Settings → Pages**, set the source to **GitHub Actions** — pushes to `main` deploy automatically. The backend (Supabase) is hosted separately and configured once via `assets/config.js` (see above).

## Structure

```
index.html                Home / player picker (also the sign-in gate)
supabase/schema.sql        Database schema + Row Level Security policy
assets/config.js           Your Supabase project URL + anon key
assets/supabaseClient.js   Shared Supabase client singleton
assets/auth.js             Login / signup / password-reset UI + session gate
assets/style.css           Shared design tokens + components (both players)
assets/icons.js             Shared nav icons
assets/storage.js           Supabase read/write helpers + localStorage cache + JSON backup/restore
judah/                     Judah's dashboard (index.html, app.js, data_curriculum.js, data_quiz.js)
joseph/                     Joseph's dashboard (index.html, app.js, data_curriculum.js, data_quiz.js)
```

Each player's `data_curriculum.js` / `data_quiz.js` defines the season's plan and quiz bank as plain JS constants — edit those to adjust content without touching the app logic.

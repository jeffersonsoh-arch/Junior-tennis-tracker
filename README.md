# Deuce Board — Family Tennis Tracker

A junior tennis development tracker for two players, built as a static site (plain HTML/CSS/JS, no backend):

- **[Judah](judah/index.html)** — age 10, NTRP 3.5, 4 sessions/week. Full 52-week periodized plan (quarters → mesocycle blocks → weekly sessions), a 48-item technical/tactical/physical/mental skill checklist, 4 benchmark testing weeks, and a 40-question tactical strategy quiz.
- **[Joseph](joseph/index.html)** — age 6, NTRP 2.5, 3 sessions/week. A distinct, age-appropriate red-ball → orange-ball pathway across 4 stages, 24 skill badges, 4 simple check-ins, and a 12-question picture-simple strategy quiz.

Open `index.html` to pick a player.

## How progress is saved

This site has no server or database — each dashboard saves its progress in the browser's `localStorage`, scoped to that browser/device only. Two things follow from that:

- Progress made on one device/browser won't automatically show up on another.
- Clearing site data/browser storage will erase it.

Every dashboard has **Backup** (downloads a `.json` snapshot of that player's progress) and **Restore** (loads a previously downloaded snapshot) buttons in the sidebar — use Backup regularly, and Restore to move progress to a new device or recover from a wipe.

## Hosting

Deployed via GitHub Pages using the included GitHub Actions workflow (`.github/workflows/pages.yml`). In the repo's **Settings → Pages**, set the source to **GitHub Actions** — pushes to `main` deploy automatically.

## Structure

```
index.html            Home / player picker
assets/style.css       Shared design tokens + components (both players)
assets/icons.js         Shared nav icons
assets/storage.js       localStorage + JSON backup/restore helpers
judah/                 Judah's dashboard (index.html, app.js, data_curriculum.js, data_quiz.js)
joseph/                Joseph's dashboard (index.html, app.js, data_curriculum.js, data_quiz.js)
```

Each player's `data_curriculum.js` / `data_quiz.js` defines the season's plan and quiz bank as plain JS constants — edit those to adjust content without touching the app logic.

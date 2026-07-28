# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pocrastinados is a solo-use personal dashboard that aggregates entertainment
activity (Steam, Trakt.tv, YouTube) into stats, a GitHub-style activity
heatmap, and a monthly "Wrapped" recap. Next.js (App Router) + TypeScript +
Tailwind, Supabase (Postgres) for storage, Vercel for hosting + cron. No
multi-user auth — every Supabase table has RLS enabled with zero policies,
so only the `service_role` key (server-side only) can read/write; the
dashboard fetches data from Server Components, never the browser.

## Commands

```bash
npm run dev                    # Next.js dev server
npm run build                  # production build (also the TypeScript check)
npm run lint                   # eslint
npx tsc --noEmit                # typecheck only (repo has no test suite)

npm run fetch:steam             # manual Steam snapshot fetch
npm run fetch:trakt             # manual Trakt history sync
npm run trakt:authorize         # one-time Trakt device-code OAuth, run once per environment

npm run build:extension         # bundles extension/src/*.ts -> extension/dist via esbuild

npm run import:youtube-history -- /path/to/watch-history.json|.html   # one-off backfill, add --dry-run first
npm run import:netflix-to-trakt -- /path/to/NetflixViewingHistory.csv # add --commit to actually write, --skip-movies/--episodes-from=N to resume
```

`extension/` has its own `tsconfig.json` (DOM + `chrome` types, no Next.js
globals) and is excluded from the root `tsconfig.json` — the two projects'
type environments don't mix. Run `npx tsc --noEmit` inside `extension/` to
typecheck it separately.

## Architecture

### Three data sources, three different sync models

Each source has a fundamentally different data shape, which is why
`src/lib/steam.ts`, `src/lib/trakt.ts`, and the ingestion route don't share
a common interface:

- **Steam** (`src/lib/steam.ts`) — the API only reports a lifetime total per
  game, never session history. Every fetch snapshots `playtime_forever` into
  `steam_playtime_snapshots`, then diffs against the previous snapshot
  (`steam_latest_snapshots` view) to derive a `steam_sessions` row for the
  elapsed period. "This month" stats need at least two fetches to exist.
- **Trakt** (`src/lib/trakt.ts`) — OAuth2 device-code flow (`scripts/trakt-authorize.ts`,
  no callback URL). The token pair lives in the `trakt_tokens` table, not an
  env var, because Trakt rotates the refresh token on every use;
  `getValidAccessToken()` refreshes and persists it automatically ~3 days
  before expiry. `trakt_watches` is a true append-only history log — no
  delta math needed, `syncTraktHistory()` just fetches everything since the
  last stored `watched_at`.
- **YouTube** — no usable official history API, so `extension/` (Manifest V3)
  watches `youtube.com/watch` pages and POSTs events to
  `/api/ingest/youtube`, authenticated by a shared secret
  (`YOUTUBE_INGEST_SECRET`), not user auth. The content script reports a
  chunk **every ~60s during playback**, not once per video — anything that
  counts "videos" must group by `video_url` (see `aggregateYoutubeRows` in
  `dashboard-data.ts`), never count raw rows, or a single 10-minute video
  becomes "10 videos."

### `src/lib/dashboard-data.ts` is the one place all pages read from

`dashboard/page.tsx`, `wrapped/[month]/page.tsx`, the heatmap, and the
weekly breakdown all call into this file rather than querying Supabase
directly. Each source's dashboard/wrapped view is fetched independently via
`Promise.allSettled` in the page components, so one source failing (e.g.
Trakt token expired) doesn't blank out the other two — errors render inline
per-section instead of throwing the whole page.

**Supabase silently caps a plain `.select()` at 1000 rows with no error.**
This bit the dashboard once `trakt_watches`/`youtube_events` grew past that
line — stats looked plausible but were quietly wrong. Every query in
`dashboard-data.ts` not already scoped to a single day/week/month goes
through `selectAllRows()`, which pages with `.range()` until a short page
comes back. Any new query over a table that can grow unbounded needs the
same treatment.

### Vercel Cron auth pattern

`/api/cron/steam` and `/api/cron/trakt` both require
`Authorization: Bearer $CRON_SECRET` and return 500 (not silently succeed)
if `CRON_SECRET` isn't configured — refuse-closed rather than refuse-open.
Vercel sends that header automatically for scheduled invocations in
`vercel.json`. Hobby-tier Vercel limits cron jobs to once/day, hence the
daily schedule rather than something more frequent; manual syncs
(`npm run fetch:steam` / `fetch:trakt`) work anytime against the same DB
regardless of where the app is deployed.

### Extension message flow

`content.ts` (samples `<video>` play state every 5s, reports a chunk every
60s or on video change/tab close) → `chrome.runtime.sendMessage` →
`background.ts` (queues in `chrome.storage.local`, flushes on message +
every 5 min via `chrome.alarms`) → `/api/ingest/youtube`. The background
script logs `inserted`/`skipped` counts from the response body rather than
trusting HTTP 200 alone — a 200 with `skipped > 0` means the server-side
`validateEvent()` rejected an item silently.

### Netflix/Trakt import scripts are one-off, not part of the app

`scripts/import-netflix-to-trakt.ts` resolves Netflix CSV rows against
Trakt's search API and pushes real entries into the user's Trakt account
history (not directly into Supabase — Trakt is the source of truth, then
`fetch:trakt` pulls it in normally). Two things worth knowing before
touching it:
- Trakt's `/search` results are **not reliably relevance-ranked** for
  short/generic queries — ties happen and the correct match can be buried.
  Matching prefers an exact normalized-title match over "first result."
  `scripts/netflix-title-overrides.json` maps Netflix's often-abbreviated
  French titles (`"Murder"` → `"How to Get Away with Murder"`) to a better
  search query for cases no algorithm can guess.
- Trakt's `/sync/history` add endpoint reports outcomes under `added` **and
  `updated`** keys, plus `not_found` — checking only `added` (or only HTTP
  status) misses real failures. A movie/episode with no exact-match
  disambiguator (Netflix's export has neither release year nor duration)
  can resolve to the wrong Trakt entry, in which case resubmitting doesn't
  help — Trakt just re-`update`s the same wrong entry.
- `import-youtube-takeout.ts` accepts either Takeout export format (`.json`
  or `.html`, dispatched by extension) since Google hands back whichever
  was requested at export time.

### Visual identity

`src/app/globals.css` defines a single dark theme (not a light/dark pair —
a deliberate choice, see the CSS comment) via custom properties consumed
through Tailwind's `@theme inline`: `--steam`/`--trakt`/`--youtube` are the
fixed per-source identity colors (validated colorblind-safe as a set),
`--accent`/`--pop` are the general UI accents. Reuse these tokens
(`bg-surface`, `text-ink-muted`, `border-line`, etc.) rather than
introducing new colors for dashboard/wrapped UI work.

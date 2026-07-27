// One-time import of a Netflix "viewing activity" CSV export into your real
// Trakt.tv account (not directly into our Supabase table) — once it's in
// Trakt, the existing `npm run fetch:trakt` / daily cron picks it up like
// any other Trakt history.
//
// Get the export from Netflix: Account > Profile & Parental Controls >
// [your profile] > Viewing activity > Download all, or via the full
// "Download your personal information" request. The relevant file is
// NetflixViewingHistory.csv (columns: Title, Date — no watch duration,
// Netflix doesn't provide that).
//
// Usage:
//   npm run import:netflix-to-trakt -- "/path/to/NetflixViewingHistory.csv"          (dry run — matches only, nothing written)
//   npm run import:netflix-to-trakt -- "/path/to/NetflixViewingHistory.csv" --commit  (actually submits to Trakt)
//
// Matching titles to Trakt is inherently best-effort: Netflix's CSV only has
// human-readable titles (often French-localized, which Trakt's database
// often doesn't recognize), no Trakt/TMDB/IMDB ids. Always run the dry run
// first and read the unmatched list before --commit.
//
// For shows/movies whose Netflix title doesn't resemble the real one at all
// (e.g. "Murder" for the French Netflix listing of "How to Get Away with
// Murder" — no amount of fuzzy matching finds that on its own), add an entry
// to netflix-title-overrides.json mapping the raw Netflix title to the
// correct search query, then re-run.

import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getValidAccessToken } from "../src/lib/trakt";

config({ path: ".env.local" });
config();

function loadTitleOverrides(): Record<string, string> {
  try {
    const raw = readFileSync(path.join(__dirname, "netflix-title-overrides.json"), "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_USER_AGENT = "Pocrastinados/0.1 (+https://github.com/Polardoss/Pocrastinados)";
const DELAY_MS = 300; // spacing between Trakt API calls, well under its rate limit
const SUBMIT_BATCH_SIZE = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- minimal quoted-CSV parser (titles routinely contain commas) ----------

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- Netflix title parsing -------------------------------------------------

type ParsedEntry =
  | { kind: "movie"; title: string; watchedAt: string; raw: string }
  | {
      kind: "episode";
      showTitle: string;
      season: number;
      episodeNumber: number | null;
      episodeTitle: string | null;
      watchedAt: string;
      raw: string;
    }
  | { kind: "skip"; reason: string; raw: string };

function parseNetflixDate(dateStr: string): string | null {
  const parts = dateStr.trim().split("/").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [m, d, yy] = parts;
  const year = yy < 100 ? 2000 + yy : yy;
  // No time-of-day in Netflix's export — noon UTC avoids the date shifting
  // to the wrong day when read back in a different timezone.
  return new Date(Date.UTC(year, m - 1, d, 12, 0, 0)).toISOString();
}

function parseEntry(rawTitle: string, rawDate: string): ParsedEntry {
  const raw = `${rawTitle} (${rawDate})`;
  const title = rawTitle.trim();
  const watchedAt = parseNetflixDate(rawDate);

  if (!title) return { kind: "skip", reason: "empty title", raw };
  if (!watchedAt) return { kind: "skip", reason: `unparseable date "${rawDate}"`, raw };

  const seasonMatch = title.match(/^(.+?):\s*Saison\s+(\d+):\s*(.+)$/i);
  if (seasonMatch) {
    return {
      kind: "episode",
      showTitle: seasonMatch[1].trim(),
      season: Number(seasonMatch[2]),
      episodeNumber: null,
      episodeTitle: seasonMatch[3].trim(),
      watchedAt,
      raw,
    };
  }

  const miniMatch = title.match(/^(.+?):\s*Mini-s[ée]rie:\s*(.+)$/i);
  if (miniMatch) {
    return {
      kind: "episode",
      showTitle: miniMatch[1].trim(),
      season: 1,
      episodeNumber: null,
      episodeTitle: miniMatch[2].trim(),
      watchedAt,
      raw,
    };
  }

  // Some (usually single-season) shows omit "Saison" entirely: "Show: Épisode 6".
  const episodeOnlyMatch = title.match(/^(.+?):\s*[ÉE]pisode\s+(\d+)$/i);
  if (episodeOnlyMatch) {
    const showTitle = episodeOnlyMatch[1].trim();
    if (!showTitle) return { kind: "skip", reason: "no show title (old/corrupted Netflix entry)", raw };
    return {
      kind: "episode",
      showTitle,
      season: 1,
      episodeNumber: Number(episodeOnlyMatch[2]),
      episodeTitle: null,
      watchedAt,
      raw,
    };
  }

  return { kind: "movie", title, watchedAt, raw };
}

// --- Trakt API --------------------------------------------------------------

interface TraktIds {
  trakt: number;
}
interface TraktEpisodeSummary {
  season: number;
  number: number;
  title: string | null;
  ids: TraktIds;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents left over from NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function traktGet(path: string, clientId: string, accessToken: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${TRAKT_API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": clientId,
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": TRAKT_USER_AGENT,
      },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "2");
      await sleep(retryAfter * 1000);
      continue;
    }

    await sleep(DELAY_MS);
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

// Trakt's search results routinely come back with identical scores for
// generic/short queries (observed firsthand: searching "You" ties "You"
// (2018) with nine unrelated shows containing the word "you"), so result
// order is not a reliable relevance signal. Prefer an exact, normalized
// title match among the candidates before falling back to whatever's first.
function pickExactOrFirst<T>(results: T[], title: string, getTitle: (item: T) => string | undefined): T | null {
  if (results.length === 0) return null;
  const target = normalize(title);
  const exact = results.find((r) => {
    const t = getTitle(r);
    return t !== undefined && normalize(t) === target;
  });
  return exact ?? results[0];
}

async function searchMovieId(
  title: string,
  clientId: string,
  accessToken: string,
  cache: Map<string, number | null>
): Promise<number | null> {
  if (cache.has(title)) return cache.get(title) ?? null;
  const results = (await traktGet(`/search/movie?query=${encodeURIComponent(title)}&limit=10`, clientId, accessToken)) as
    | Array<{ movie?: { title?: string; ids?: TraktIds } }>
    | null;
  const best = pickExactOrFirst(results ?? [], title, (r) => r.movie?.title);
  const id = best?.movie?.ids?.trakt ?? null;
  cache.set(title, id);
  return id;
}

async function searchShowId(
  title: string,
  clientId: string,
  accessToken: string,
  cache: Map<string, number | null>
): Promise<number | null> {
  if (cache.has(title)) return cache.get(title) ?? null;

  const results = (await traktGet(`/search/show?query=${encodeURIComponent(title)}&limit=10`, clientId, accessToken)) as
    | Array<{ show?: { title?: string; ids?: TraktIds } }>
    | null;
  let id = pickExactOrFirst(results ?? [], title, (r) => r.show?.title)?.show?.ids?.trakt ?? null;

  if (!id) {
    // Netflix's French catalog often appends a localized subtitle after
    // " : " / " - " / " – " (e.g. "The Rookie : Le flic de Los Angeles") that
    // Trakt's database won't recognize — retry with just the first segment.
    const fallback = title.split(/\s+[:\-–]\s+/)[0].trim();
    if (fallback && fallback !== title) {
      const fallbackResults = (await traktGet(
        `/search/show?query=${encodeURIComponent(fallback)}&limit=10`,
        clientId,
        accessToken
      )) as Array<{ show?: { title?: string; ids?: TraktIds } }> | null;
      id = pickExactOrFirst(fallbackResults ?? [], fallback, (r) => r.show?.title)?.show?.ids?.trakt ?? null;
    }
  }

  cache.set(title, id);
  return id;
}

async function getSeasonEpisodes(
  showId: number,
  season: number,
  clientId: string,
  accessToken: string,
  cache: Map<string, TraktEpisodeSummary[]>
): Promise<TraktEpisodeSummary[]> {
  const key = `${showId}:${season}`;
  if (cache.has(key)) return cache.get(key) ?? [];
  const episodes = (await traktGet(`/shows/${showId}/seasons/${season}`, clientId, accessToken)) as
    | TraktEpisodeSummary[]
    | null;
  cache.set(key, episodes ?? []);
  return episodes ?? [];
}

function matchEpisode(
  episodes: TraktEpisodeSummary[],
  entry: Extract<ParsedEntry, { kind: "episode" }>
): TraktEpisodeSummary | null {
  if (entry.episodeNumber != null) {
    return episodes.find((e) => e.number === entry.episodeNumber) ?? null;
  }
  if (entry.episodeTitle) {
    const target = normalize(entry.episodeTitle);
    const exact = episodes.find((e) => e.title && normalize(e.title) === target);
    if (exact) return exact;
    const partial = episodes.find(
      (e) => e.title && (normalize(e.title).includes(target) || target.includes(normalize(e.title)))
    );
    if (partial) return partial;
  }
  return null;
}

async function submitHistoryBatches(
  kind: "movies" | "episodes",
  items: Array<{ watched_at: string; ids: TraktIds }>,
  clientId: string,
  accessToken: string
): Promise<void> {
  for (let i = 0; i < items.length; i += SUBMIT_BATCH_SIZE) {
    const batch = items.slice(i, i + SUBMIT_BATCH_SIZE);
    const res = await fetch(`${TRAKT_API_BASE}/sync/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": clientId,
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": TRAKT_USER_AGENT,
      },
      body: JSON.stringify({ [kind]: batch }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to submit ${kind} batch at offset ${i}: ${res.status} ${bodyText}`);
    }

    // HTTP 200 does not mean every item was accepted — Trakt reports
    // per-item rejects in the body instead of failing the whole request.
    const result = JSON.parse(bodyText) as {
      added?: Record<string, number>;
      not_found?: Record<string, unknown[]>;
    };
    const addedCount = result.added?.[kind] ?? batch.length;
    const notFoundCount = result.not_found?.[kind]?.length ?? 0;
    if (notFoundCount > 0) {
      console.warn(
        `  WARNING: ${notFoundCount}/${batch.length} ${kind} in this batch were rejected by Trakt (not_found):`,
        JSON.stringify(result.not_found?.[kind])
      );
    }

    console.log(
      `Submitted ${kind} ${Math.min(i + SUBMIT_BATCH_SIZE, items.length)}/${items.length} (added ${addedCount}, rejected ${notFoundCount})`
    );
    await sleep(DELAY_MS);
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const commit = args.includes("--commit");
  const skipMovies = args.includes("--skip-movies");
  const episodesFromArg = args.find((a) => a.startsWith("--episodes-from="));
  const episodesFrom = episodesFromArg ? Number(episodesFromArg.split("=")[1]) : 0;

  if (!filePath) {
    throw new Error(
      'Usage: npm run import:netflix-to-trakt -- "/path/to/NetflixViewingHistory.csv" [--commit]'
    );
  }

  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId) throw new Error("Missing TRAKT_CLIENT_ID environment variable.");

  const accessToken = await getValidAccessToken();

  const raw = readFileSync(filePath, "utf-8");
  const rows = parseCsv(raw);
  const [header, ...dataRows] = rows;
  if (!header || header[0]?.trim().toLowerCase() !== "title") {
    throw new Error('Expected a Netflix "Title,Date" CSV — first column header should be "Title".');
  }

  const entries = dataRows.map(([title, date]) => parseEntry(title ?? "", date ?? ""));
  console.log(`Parsed ${entries.length} rows from the CSV.`);

  const titleOverrides = loadTitleOverrides();
  if (Object.keys(titleOverrides).length > 0) {
    console.log(`Loaded ${Object.keys(titleOverrides).length} title override(s) from netflix-title-overrides.json.`);
  }

  const movieCache = new Map<string, number | null>();
  const showCache = new Map<string, number | null>();
  const seasonCache = new Map<string, TraktEpisodeSummary[]>();

  const matchedMovies: Array<{ watched_at: string; ids: TraktIds }> = [];
  const matchedEpisodes: Array<{ watched_at: string; ids: TraktIds }> = [];
  const unmatched: Array<{ raw: string; reason: string }> = [];

  // Pass 1: resolve movies directly; for episodes, resolve the show and
  // group by (show, season) — episode-level matching happens in pass 2,
  // once we know every entry that belongs to that season.
  type EpisodeEntry = Extract<ParsedEntry, { kind: "episode" }>;
  interface SeasonGroup {
    showTitle: string;
    season: number;
    showId: number;
    items: EpisodeEntry[];
  }
  const groups = new Map<string, SeasonGroup>();

  for (const [index, entry] of entries.entries()) {
    if (index > 0 && index % 1000 === 0) {
      console.log(`... resolving shows/movies: ${index}/${entries.length}`);
    }

    if (entry.kind === "skip") {
      unmatched.push({ raw: entry.raw, reason: entry.reason });
      continue;
    }

    if (entry.kind === "movie") {
      const query = titleOverrides[entry.title] ?? entry.title;
      const id = await searchMovieId(query, clientId, accessToken, movieCache);
      if (id) matchedMovies.push({ watched_at: entry.watchedAt, ids: { trakt: id } });
      else unmatched.push({ raw: entry.raw, reason: `movie "${entry.title}" not found on Trakt` });
      continue;
    }

    const showQuery = titleOverrides[entry.showTitle] ?? entry.showTitle;
    const showId = await searchShowId(showQuery, clientId, accessToken, showCache);
    if (!showId) {
      unmatched.push({ raw: entry.raw, reason: `show "${entry.showTitle}" not found on Trakt` });
      continue;
    }

    const key = `${showId}:${entry.season}`;
    let group = groups.get(key);
    if (!group) {
      group = { showTitle: entry.showTitle, season: entry.season, showId, items: [] };
      groups.set(key, group);
    }
    group.items.push(entry);
  }

  // Pass 2: match episodes within each season group. Try episode
  // number/title first; Netflix's French titles routinely don't match
  // Trakt's (English) episode titles at all, so whatever's left over falls
  // back to positional matching — oldest-watched Netflix entry paired with
  // the lowest-numbered remaining Trakt episode. This assumes roughly
  // sequential viewing within a season; it will misfire for entries
  // watched out of order or rewatched.
  console.log(`\nResolved shows/movies — matching episodes across ${groups.size} show-season group(s)...`);

  let groupIndex = 0;
  for (const group of groups.values()) {
    groupIndex++;
    if (groupIndex % 50 === 0) console.log(`... episode groups: ${groupIndex}/${groups.size}`);

    const episodes = await getSeasonEpisodes(group.showId, group.season, clientId, accessToken, seasonCache);
    const usedEpisodeIds = new Set<number>();
    const unresolved: EpisodeEntry[] = [];

    for (const entry of group.items) {
      let episode: TraktEpisodeSummary | null = null;
      if (entry.episodeNumber != null) {
        episode = episodes.find((e) => e.number === entry.episodeNumber) ?? null;
      } else if (entry.episodeTitle) {
        episode = matchEpisode(episodes, entry);
      }

      if (episode) {
        // A confident number/title match is accepted even if that episode
        // was already claimed by an earlier entry — rewatches are valid
        // (Trakt allows multiple history entries for the same episode).
        // It's still marked "used" so the positional fallback below (which
        // guesses at otherwise-unmatchable entries) doesn't also hand it
        // out to some unrelated ambiguous entry.
        usedEpisodeIds.add(episode.ids.trakt);
        matchedEpisodes.push({ watched_at: entry.watchedAt, ids: { trakt: episode.ids.trakt } });
      } else {
        unresolved.push(entry);
      }
    }

    if (unresolved.length === 0) continue;

    const remainingEpisodes = episodes
      .filter((e) => !usedEpisodeIds.has(e.ids.trakt))
      .sort((a, b) => a.number - b.number);
    const sortedUnresolved = [...unresolved].sort(
      (a, b) => new Date(a.watchedAt).getTime() - new Date(b.watchedAt).getTime()
    );

    const positionalCount = Math.min(sortedUnresolved.length, remainingEpisodes.length);
    for (let i = 0; i < positionalCount; i++) {
      matchedEpisodes.push({ watched_at: sortedUnresolved[i].watchedAt, ids: { trakt: remainingEpisodes[i].ids.trakt } });
    }
    for (let i = positionalCount; i < sortedUnresolved.length; i++) {
      unmatched.push({
        raw: sortedUnresolved[i].raw,
        reason: `"${group.showTitle}" season ${group.season} has fewer episodes on Trakt (${episodes.length}) than watched entries`,
      });
    }
  }

  console.log(`\nMatched: ${matchedMovies.length} movie(s), ${matchedEpisodes.length} episode(s).`);
  console.log(`Unmatched: ${unmatched.length}`);

  const dumpArg = args.find((a) => a.startsWith("--dump-json="));
  if (dumpArg) {
    const dumpPath = dumpArg.split("=")[1];
    writeFileSync(dumpPath, JSON.stringify({ matchedMovies, matchedEpisodes }, null, 2), "utf-8");
    console.log(`Dumped matched movies/episodes to ${dumpPath}`);
  }

  if (unmatched.length > 0) {
    const reportPath = filePath.replace(/\.csv$/i, "") + ".unmatched.txt";
    writeFileSync(reportPath, unmatched.map((u) => `${u.raw} — ${u.reason}`).join("\n"), "utf-8");
    console.log(`Full unmatched list written to: ${reportPath}`);
    console.log("Sample:");
    for (const u of unmatched.slice(0, 15)) console.log(`  - ${u.raw} — ${u.reason}`);
    if (unmatched.length > 15) console.log(`  ...and ${unmatched.length - 15} more.`);
  }

  if (!commit) {
    console.log("\nDry run only — nothing was written to Trakt.");
    console.log("Re-run with --commit once you're happy with the match rate above.");
    return;
  }

  console.log("\nSubmitting to Trakt...");
  if (skipMovies) {
    console.log("Skipping movies (--skip-movies).");
  } else {
    await submitHistoryBatches("movies", matchedMovies, clientId, accessToken);
  }
  const episodesToSubmit = matchedEpisodes.slice(episodesFrom);
  if (episodesFrom > 0) {
    console.log(
      `Resuming episodes from index ${episodesFrom} (${episodesToSubmit.length} of ${matchedEpisodes.length} remaining).`
    );
  }
  await submitHistoryBatches("episodes", episodesToSubmit, clientId, accessToken);
  console.log('\nDone. Run "npm run fetch:trakt" to pull this into your Pocrastinados dashboard.');
}

main().catch((error) => {
  console.error("Netflix → Trakt import failed:", error);
  process.exitCode = 1;
});

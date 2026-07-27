// One-time import of pre-existing YouTube watch history from a Google
// Takeout export (the extension only tracks going forward from when it was
// installed). Get the export at https://takeout.google.com/ — select only
// "YouTube and YouTube Music" > "history". Takeout can hand back either
// format depending on what was picked at export time; this script accepts
// both, based on the file extension:
//   - history/watch-history.json (JSON format)
//   - history/watch-history.html (HTML format)
//
// Usage: npm run import:youtube-history -- /path/to/watch-history.json
//        npm run import:youtube-history -- /path/to/watch-history.html
//
// Google's export does not include how long each video was watched, only
// that it was watched and when — imported rows get duration_seconds: null,
// which contributes 0 minutes to totals/heatmap but still counts toward
// video/channel breakdowns. Safe to re-run: duplicates (same video + same
// timestamp) are skipped via the unique index on (video_url, watched_at).

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "../src/lib/supabase-admin";

config({ path: ".env.local" });
config();

const BATCH_SIZE = 500;
const WATCH_URL_PATTERN = /(?:youtube\.com\/watch\?v=|youtu\.be\/)/;

interface ImportRow {
  video_title: string;
  channel_name: string | null;
  video_url: string;
  duration_seconds: null;
  watched_at: string;
  source: "youtube";
}

// --- JSON format -------------------------------------------------------------

interface TakeoutJsonEntry {
  title?: string;
  titleUrl?: string;
  subtitles?: { name?: string }[];
  time?: string;
}

// Google's own template text ("Watched X") is only in English exports —
// other account languages phrase this differently (e.g. French: "Vous avez
// regardé X"), in which case the prefix is simply left in place rather than
// guessed at.
function stripWatchedPrefix(title: string): string {
  return title.replace(/^Watched\s+/i, "").trim();
}

function parseJsonEntry(entry: TakeoutJsonEntry): ImportRow | null {
  if (!entry.titleUrl || !WATCH_URL_PATTERN.test(entry.titleUrl)) return null;
  if (!entry.time) return null;

  const watchedAt = new Date(entry.time);
  if (Number.isNaN(watchedAt.getTime())) return null;

  const title = stripWatchedPrefix(entry.title ?? "") || "Vidéo sans titre";

  return {
    video_title: title,
    channel_name: entry.subtitles?.[0]?.name?.trim() || null,
    video_url: entry.titleUrl,
    duration_seconds: null,
    watched_at: watchedAt.toISOString(),
    source: "youtube",
  };
}

function parseJsonFile(raw: string): ImportRow[] {
  const entries = JSON.parse(raw) as unknown;
  if (!Array.isArray(entries)) {
    throw new Error('Expected a JSON array — this should be the "watch-history.json" file from a Takeout export.');
  }
  const rows = (entries as TakeoutJsonEntry[]).map(parseJsonEntry).filter((r): r is ImportRow => r !== null);
  console.log(`Parsed ${rows.length} watch entries out of ${entries.length} total activity records.`);
  return rows;
}

// --- HTML format -------------------------------------------------------------
//
// Structure per entry (French account shown; the "watched" phrase varies by
// account language — see WATCHED_PHRASES below):
//   Vous avez regardé <a href="VIDEO_URL">TITLE</a><br>
//   <a href="CHANNEL_URL">CHANNEL</a><br>        (absent for deleted channels)
//   26 juil. 2026, 22:45:17 CEST<br>
// Non-watch activity (searches, comments, etc.) uses different phrasing and
// is skipped automatically since it won't match WATCHED_PHRASES.

const WATCHED_PHRASES = ["Vous avez regardé", "Watched"];

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#39;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:amp|#39|quot|lt|gt|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

const FR_MONTHS: Record<string, number> = {
  "janv.": 1,
  "févr.": 2,
  mars: 3,
  "avr.": 4,
  mai: 5,
  juin: 6,
  "juil.": 7,
  août: 8,
  "sept.": 9,
  "oct.": 10,
  "nov.": 11,
  "déc.": 12,
};

const EN_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

// Handles "26 juil. 2026, 22:45:17 CEST" (FR) and "Jul 26, 2026, 10:45:17 PM CEST" (EN)-ish
// formats. Falls back to letting the JS Date parser take a swing at
// anything unrecognized rather than dropping the entry outright.
function parseHtmlDate(text: string): string | null {
  const frMatch = text.match(/(\d{1,2})\s+([a-zéû.]+)\s+(\d{4}),\s+(\d{2}):(\d{2}):(\d{2})\s*(CEST|CET|UTC)?/i);
  if (frMatch) {
    const [, day, monthRaw, year, hh, mm, ss, tz] = frMatch;
    const month = FR_MONTHS[monthRaw.toLowerCase()];
    if (month) {
      const offset = tz?.toUpperCase() === "CEST" ? "+02:00" : tz?.toUpperCase() === "CET" ? "+01:00" : "Z";
      const d = new Date(`${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}T${hh}:${mm}:${ss}${offset}`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }

  const enMatch = text.match(
    /([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?\s*(CEST|CET|UTC)?/i
  );
  if (enMatch) {
    const [, monthRaw, day, year, hourRaw, mm, ss, ampm, tz] = enMatch;
    const month = EN_MONTHS[monthRaw.slice(0, 3).toLowerCase()];
    if (month) {
      let hour = Number(hourRaw);
      if (ampm?.toUpperCase() === "PM" && hour < 12) hour += 12;
      if (ampm?.toUpperCase() === "AM" && hour === 12) hour = 0;
      const offset = tz?.toUpperCase() === "CEST" ? "+02:00" : tz?.toUpperCase() === "CET" ? "+01:00" : "Z";
      const d = new Date(
        `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${mm}:${ss}${offset}`
      );
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }

  // Last resort: let the runtime's own date parser try.
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function parseHtmlFile(html: string): ImportRow[] {
  const rows: ImportRow[] = [];
  let totalEntries = 0;

  for (const phrase of WATCHED_PHRASES) {
    const pattern = new RegExp(
      `${phrase}\\s*<a href="([^"]+)">([^<]*)<\\/a><br>(?:<a href="[^"]+">([^<]*)<\\/a><br>)?([^<]*)<br>`,
      "g"
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      totalEntries++;
      const [, videoUrl, videoTitleRaw, channelNameRaw, dateTextRaw] = match;

      if (!WATCH_URL_PATTERN.test(videoUrl)) continue;
      const watchedAt = parseHtmlDate(dateTextRaw.trim());
      if (!watchedAt) continue;

      const title = decodeHtmlEntities(videoTitleRaw.trim()) || "Vidéo sans titre";
      const channel = channelNameRaw ? decodeHtmlEntities(channelNameRaw.trim()) : null;

      rows.push({
        video_title: title,
        channel_name: channel,
        video_url: videoUrl,
        duration_seconds: null,
        watched_at: watchedAt,
        source: "youtube",
      });
    }
  }

  console.log(`Parsed ${rows.length} watch entries out of ${totalEntries} matched activity blocks.`);
  return rows;
}

// --- main -------------------------------------------------------------------

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: npm run import:youtube-history -- /path/to/watch-history.json|.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const raw = readFileSync(filePath, "utf-8");

  let rows: ImportRow[];
  if (ext === ".json") {
    rows = parseJsonFile(raw);
  } else if (ext === ".html" || ext === ".htm") {
    rows = parseHtmlFile(raw);
  } else {
    throw new Error(`Unrecognized file extension "${ext}" — expected .json or .html.`);
  }

  if (rows.length === 0) return;

  console.log("Sample of parsed rows:");
  for (const row of rows.slice(0, 5)) {
    console.log(`  - [${row.watched_at}] "${row.video_title}" (${row.channel_name ?? "no channel"})`);
  }

  if (process.argv.includes("--dry-run")) {
    console.log("\nDry run only — nothing was written.");
    return;
  }

  const supabase = getSupabaseAdmin();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("youtube_events")
      .upsert(batch, { onConflict: "video_url,watched_at", ignoreDuplicates: true });

    if (error) {
      throw new Error(`Failed to import batch starting at row ${i}: ${error.message}`);
    }

    console.log(`Imported ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error("YouTube history import failed:", error);
  process.exitCode = 1;
});

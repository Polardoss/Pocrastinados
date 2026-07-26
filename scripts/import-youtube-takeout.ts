// One-time import of pre-existing YouTube watch history from a Google
// Takeout export (the extension only tracks going forward from when it was
// installed). Get the export at https://takeout.google.com/ — select only
// "YouTube and YouTube Music" > "history", and choose JSON as the format.
// The relevant file is history/watch-history.json inside the download.
//
// Usage: npm run import:youtube-history -- /path/to/watch-history.json
//
// Google's export does not include how long each video was watched, only
// that it was watched and when — imported rows get duration_seconds: null,
// which contributes 0 minutes to totals/heatmap but still counts toward
// video/channel breakdowns. Safe to re-run: duplicates (same video + same
// timestamp) are skipped via the unique index on (video_url, watched_at).

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { getSupabaseAdmin } from "../src/lib/supabase-admin";

config({ path: ".env.local" });
config();

const BATCH_SIZE = 500;
const WATCH_URL_PATTERN = /(?:youtube\.com\/watch\?v=|youtu\.be\/)/;

interface TakeoutEntry {
  title?: string;
  titleUrl?: string;
  subtitles?: { name?: string }[];
  time?: string;
}

interface ImportRow {
  video_title: string;
  channel_name: string | null;
  video_url: string;
  duration_seconds: null;
  watched_at: string;
  source: "youtube";
}

// Google's own template text ("Watched X") is only in English exports —
// other account languages phrase this differently, in which case the
// prefix is simply left in place rather than guessed at.
function stripWatchedPrefix(title: string): string {
  return title.replace(/^Watched\s+/i, "").trim();
}

function parseEntry(entry: TakeoutEntry): ImportRow | null {
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

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: npm run import:youtube-history -- /path/to/watch-history.json");
  }

  const raw = readFileSync(filePath, "utf-8");
  const entries = JSON.parse(raw) as unknown;

  if (!Array.isArray(entries)) {
    throw new Error(
      "Expected a JSON array — this should be the history/watch-history.json file from a Takeout export (JSON format, not HTML)."
    );
  }

  const rows = (entries as TakeoutEntry[]).map(parseEntry).filter((row): row is ImportRow => row !== null);

  console.log(`Parsed ${rows.length} watch entries out of ${entries.length} total activity records.`);
  if (rows.length === 0) return;

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

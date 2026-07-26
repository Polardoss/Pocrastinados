import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// The caller is a Chrome extension background worker (an opaque
// chrome-extension:// origin), not a browser page we can allowlist by
// origin — auth is handled by the bearer secret below, so CORS is opened
// wide here rather than restricted by origin.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

interface IncomingEvent {
  videoTitle?: unknown;
  channelName?: unknown;
  topicName?: unknown;
  videoUrl?: unknown;
  durationSeconds?: unknown;
  watchedAt?: unknown;
}

interface ValidatedEvent {
  video_title: string;
  channel_name: string | null;
  topic_name: string | null;
  video_url: string | null;
  duration_seconds: number;
  watched_at: string;
  source: "youtube";
}

function validateEvent(event: IncomingEvent): ValidatedEvent | null {
  if (typeof event.videoTitle !== "string" || event.videoTitle.trim().length === 0) return null;
  if (typeof event.durationSeconds !== "number" || event.durationSeconds <= 0) return null;

  const watchedAtDate =
    typeof event.watchedAt === "string" ? new Date(event.watchedAt) : null;
  if (!watchedAtDate || Number.isNaN(watchedAtDate.getTime())) return null;

  return {
    video_title: event.videoTitle.trim(),
    channel_name: typeof event.channelName === "string" ? event.channelName.trim() : null,
    topic_name: typeof event.topicName === "string" ? event.topicName.trim() : null,
    video_url: typeof event.videoUrl === "string" ? event.videoUrl.trim() : null,
    duration_seconds: Math.round(event.durationSeconds),
    watched_at: watchedAtDate.toISOString(),
    source: "youtube",
  };
}

// Called by the Chrome extension's background service worker. Authenticated
// with a shared secret rather than user auth since this is a solo project
// with a single trusted client (the extension itself).
export async function POST(request: Request) {
  const ingestSecret = process.env.YOUTUBE_INGEST_SECRET;
  if (!ingestSecret) {
    return json({ error: "YOUTUBE_INGEST_SECRET is not configured" }, 500);
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${ingestSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.events)) {
    return json({ error: "Expected { events: [...] }" }, 400);
  }

  const validated = body.events.map((event) => validateEvent(event as IncomingEvent));
  const rows = validated.filter((row): row is ValidatedEvent => row !== null);
  const skipped = validated.length - rows.length;

  if (rows.length === 0) {
    return json({ ok: true, inserted: 0, skipped });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("youtube_events").insert(rows);

  if (error) {
    console.error("YouTube ingestion insert failed:", error);
    return json({ error: "Failed to store events" }, 500);
  }

  return json({ ok: true, inserted: rows.length, skipped });
}

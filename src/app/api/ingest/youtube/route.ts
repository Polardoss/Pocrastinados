import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface IncomingEvent {
  videoTitle?: unknown;
  channelName?: unknown;
  videoUrl?: unknown;
  durationSeconds?: unknown;
  watchedAt?: unknown;
}

interface ValidatedEvent {
  video_title: string;
  channel_name: string | null;
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
    return NextResponse.json({ error: "YOUTUBE_INGEST_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${ingestSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.events)) {
    return NextResponse.json({ error: "Expected { events: [...] }" }, { status: 400 });
  }

  const validated = body.events.map((event) => validateEvent(event as IncomingEvent));
  const rows = validated.filter((row): row is ValidatedEvent => row !== null);
  const skipped = validated.length - rows.length;

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, skipped });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("youtube_events").insert(rows);

  if (error) {
    console.error("YouTube ingestion insert failed:", error);
    return NextResponse.json({ error: "Failed to store events" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length, skipped });
}

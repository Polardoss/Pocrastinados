import { NextResponse } from "next/server";
import { syncTraktHistory } from "@/lib/trakt";

export const dynamic = "force-dynamic";

// Triggered by Vercel Cron (see vercel.json), same CRON_SECRET as the Steam
// cron endpoint (Vercel sends `Authorization: Bearer $CRON_SECRET`).
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncTraktHistory();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Trakt cron sync failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

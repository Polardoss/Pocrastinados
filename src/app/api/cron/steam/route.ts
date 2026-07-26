import { NextResponse } from "next/server";
import { syncSteamPlaytime } from "@/lib/steam";

export const dynamic = "force-dynamic";

// Triggered by Vercel Cron (see vercel.json). Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` when invoking cron jobs as long as
// the CRON_SECRET env var is set on the project, which is what we check
// against here.
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
    const result = await syncSteamPlaytime();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Steam cron sync failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

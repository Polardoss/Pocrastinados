import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface GameTotal {
  appid: number;
  name: string;
  minutes: number;
}

export interface SteamDashboardData {
  allTime: {
    totalMinutes: number;
    games: GameTotal[];
  };
  thisMonth: {
    totalMinutes: number;
    games: GameTotal[];
    periodStart: string;
  };
}

/**
 * All-time totals come from the latest Steam snapshot per game (Steam
 * reports a running total, so this is accurate from the very first fetch).
 * "This month" totals come from steam_sessions, which only exist once at
 * least two fetches have happened far enough apart to produce a delta.
 */
export async function getSteamDashboardData(): Promise<SteamDashboardData> {
  const supabase = getSupabaseAdmin();

  const { data: latest, error: latestError } = await supabase
    .from("steam_latest_snapshots")
    .select("steam_appid, game_name, playtime_forever_minutes")
    .order("playtime_forever_minutes", { ascending: false });

  if (latestError) {
    throw new Error(`Failed to load Steam snapshots: ${latestError.message}`);
  }

  const allTimeGames: GameTotal[] = (latest ?? []).map((row) => ({
    appid: row.steam_appid,
    name: row.game_name,
    minutes: row.playtime_forever_minutes,
  }));

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data: sessions, error: sessionsError } = await supabase
    .from("steam_sessions")
    .select("steam_appid, game_name, minutes_played")
    .gte("period_end", monthStart);

  if (sessionsError) {
    throw new Error(`Failed to load Steam sessions: ${sessionsError.message}`);
  }

  const monthTotals = new Map<number, GameTotal>();
  for (const row of sessions ?? []) {
    const existing = monthTotals.get(row.steam_appid);
    if (existing) {
      existing.minutes += row.minutes_played;
    } else {
      monthTotals.set(row.steam_appid, {
        appid: row.steam_appid,
        name: row.game_name,
        minutes: row.minutes_played,
      });
    }
  }

  const thisMonthGames = Array.from(monthTotals.values()).sort(
    (a, b) => b.minutes - a.minutes
  );

  return {
    allTime: {
      totalMinutes: allTimeGames.reduce((sum, g) => sum + g.minutes, 0),
      games: allTimeGames,
    },
    thisMonth: {
      totalMinutes: thisMonthGames.reduce((sum, g) => sum + g.minutes, 0),
      games: thisMonthGames,
      periodStart: monthStart,
    },
  };
}

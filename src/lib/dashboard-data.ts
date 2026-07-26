import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface BreakdownItem {
  key: string;
  label: string;
  minutes: number;
}

export interface SteamDashboardData {
  allTime: {
    totalMinutes: number;
    games: BreakdownItem[];
  };
  thisMonth: {
    totalMinutes: number;
    games: BreakdownItem[];
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

  const allTimeGames: BreakdownItem[] = (latest ?? []).map((row) => ({
    key: String(row.steam_appid),
    label: row.game_name,
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

  const monthTotals = new Map<number, BreakdownItem>();
  for (const row of sessions ?? []) {
    const existing = monthTotals.get(row.steam_appid);
    if (existing) {
      existing.minutes += row.minutes_played;
    } else {
      monthTotals.set(row.steam_appid, {
        key: String(row.steam_appid),
        label: row.game_name,
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

export interface TraktDashboardData {
  allTime: {
    totalMinutes: number;
    totalItems: number;
    items: BreakdownItem[];
  };
  thisMonth: {
    totalMinutes: number;
    totalItems: number;
    items: BreakdownItem[];
    periodStart: string;
  };
}

interface TraktWatchRow {
  title: string;
  media_type: "movie" | "episode";
  show_title: string | null;
  duration_minutes: number | null;
}

function aggregateTraktRows(rows: TraktWatchRow[]): BreakdownItem[] {
  const totals = new Map<string, BreakdownItem>();

  for (const row of rows) {
    const key = row.media_type === "movie" ? `movie:${row.title}` : `show:${row.show_title}`;
    const label = row.media_type === "movie" ? row.title : row.show_title ?? "Série inconnue";
    const minutes = row.duration_minutes ?? 0;

    const existing = totals.get(key);
    if (existing) {
      existing.minutes += minutes;
    } else {
      totals.set(key, { key, label, minutes });
    }
  }

  return Array.from(totals.values()).sort((a, b) => b.minutes - a.minutes);
}

/**
 * Unlike Steam, Trakt history rows are immutable events (no delta needed):
 * "this month" is simply the rows watched since the start of the month.
 */
export async function getTraktDashboardData(): Promise<TraktDashboardData> {
  const supabase = getSupabaseAdmin();

  const { data: allRows, error: allError } = await supabase
    .from("trakt_watches")
    .select("title, media_type, show_title, duration_minutes");

  if (allError) {
    throw new Error(`Failed to load Trakt watches: ${allError.message}`);
  }

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data: monthRows, error: monthError } = await supabase
    .from("trakt_watches")
    .select("title, media_type, show_title, duration_minutes")
    .gte("watched_at", monthStart);

  if (monthError) {
    throw new Error(`Failed to load Trakt watches for this month: ${monthError.message}`);
  }

  const allTimeItems = aggregateTraktRows(allRows ?? []);
  const monthItems = aggregateTraktRows(monthRows ?? []);

  return {
    allTime: {
      totalMinutes: allTimeItems.reduce((sum, item) => sum + item.minutes, 0),
      totalItems: allRows?.length ?? 0,
      items: allTimeItems.slice(0, 15),
    },
    thisMonth: {
      totalMinutes: monthItems.reduce((sum, item) => sum + item.minutes, 0),
      totalItems: monthRows?.length ?? 0,
      items: monthItems.slice(0, 15),
      periodStart: monthStart,
    },
  };
}

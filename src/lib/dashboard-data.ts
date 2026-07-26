import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface BreakdownItem {
  key: string;
  label: string;
  minutes: number;
}

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
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

  const monthStart = startOfCurrentMonthIso();

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

  const monthStart = startOfCurrentMonthIso();

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

export interface YoutubeDashboardData {
  allTime: {
    totalMinutes: number;
    totalVideos: number;
    items: BreakdownItem[];
  };
  thisMonth: {
    totalMinutes: number;
    totalVideos: number;
    items: BreakdownItem[];
    periodStart: string;
  };
}

interface YoutubeEventRow {
  channel_name: string | null;
  duration_seconds: number | null;
}

function aggregateYoutubeRows(rows: YoutubeEventRow[]): BreakdownItem[] {
  const totals = new Map<string, BreakdownItem>();

  for (const row of rows) {
    const label = row.channel_name?.trim() || "Chaîne inconnue";
    const key = `channel:${label}`;
    const minutes = (row.duration_seconds ?? 0) / 60;

    const existing = totals.get(key);
    if (existing) {
      existing.minutes += minutes;
    } else {
      totals.set(key, { key, label, minutes });
    }
  }

  return Array.from(totals.values())
    .map((item) => ({ ...item, minutes: Math.round(item.minutes) }))
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Events are pushed by the Chrome extension (see /api/ingest/youtube), one
 * per video watched, already deduplicated at the source. Like Trakt, this
 * is an append-only log so "this month" is just a date filter.
 */
export async function getYoutubeDashboardData(): Promise<YoutubeDashboardData> {
  const supabase = getSupabaseAdmin();

  const { data: allRows, error: allError } = await supabase
    .from("youtube_events")
    .select("channel_name, duration_seconds");

  if (allError) {
    throw new Error(`Failed to load YouTube events: ${allError.message}`);
  }

  const monthStart = startOfCurrentMonthIso();

  const { data: monthRows, error: monthError } = await supabase
    .from("youtube_events")
    .select("channel_name, duration_seconds")
    .gte("watched_at", monthStart);

  if (monthError) {
    throw new Error(`Failed to load YouTube events for this month: ${monthError.message}`);
  }

  const allTimeItems = aggregateYoutubeRows(allRows ?? []);
  const monthItems = aggregateYoutubeRows(monthRows ?? []);

  return {
    allTime: {
      totalMinutes: allTimeItems.reduce((sum, item) => sum + item.minutes, 0),
      totalVideos: allRows?.length ?? 0,
      items: allTimeItems.slice(0, 15),
    },
    thisMonth: {
      totalMinutes: monthItems.reduce((sum, item) => sum + item.minutes, 0),
      totalVideos: monthRows?.length ?? 0,
      items: monthItems.slice(0, 15),
      periodStart: monthStart,
    },
  };
}

export interface HeatmapDay {
  date: string; // YYYY-MM-DD (UTC)
  minutes: number;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Total entertainment minutes per day across all three sources, for the
 * last `daysBack` days — used to render a GitHub-contributions-style
 * heatmap. Steam minutes are attributed to the day the fetch happened
 * (period_end), which is an approximation since a session can span the
 * gap between two daily cron runs, but it's close enough for a heatmap.
 */
export async function getActivityHeatmap(daysBack = 364): Promise<HeatmapDay[]> {
  const supabase = getSupabaseAdmin();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - daysBack);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const [steamRes, traktRes, youtubeRes] = await Promise.all([
    supabase.from("steam_sessions").select("minutes_played, period_end").gte("period_end", sinceIso),
    supabase.from("trakt_watches").select("duration_minutes, watched_at").gte("watched_at", sinceIso),
    supabase.from("youtube_events").select("duration_seconds, watched_at").gte("watched_at", sinceIso),
  ]);

  if (steamRes.error) {
    throw new Error(`Failed to load Steam sessions for heatmap: ${steamRes.error.message}`);
  }
  if (traktRes.error) {
    throw new Error(`Failed to load Trakt watches for heatmap: ${traktRes.error.message}`);
  }
  if (youtubeRes.error) {
    throw new Error(`Failed to load YouTube events for heatmap: ${youtubeRes.error.message}`);
  }

  const minutesByDay = new Map<string, number>();
  const addMinutes = (dateIso: string, minutes: number) => {
    if (minutes <= 0) return;
    const key = dayKey(dateIso);
    minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + minutes);
  };

  for (const row of steamRes.data ?? []) addMinutes(row.period_end, row.minutes_played);
  for (const row of traktRes.data ?? []) addMinutes(row.watched_at, row.duration_minutes ?? 0);
  for (const row of youtubeRes.data ?? []) {
    addMinutes(row.watched_at, (row.duration_seconds ?? 0) / 60);
  }

  const days: HeatmapDay[] = [];
  const cursor = new Date(since);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    days.push({ date: key, minutes: Math.round(minutesByDay.get(key) ?? 0) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

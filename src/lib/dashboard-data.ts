import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface BreakdownItem {
  key: string;
  label: string;
  sublabel?: string;
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
  video_url: string | null;
  video_title: string;
  channel_name: string | null;
  topic_name: string | null;
  duration_seconds: number | null;
}

const YOUTUBE_EVENT_COLUMNS = "video_url, video_title, channel_name, topic_name, duration_seconds";

function youtubeSublabel(row: YoutubeEventRow): string | undefined {
  const parts = [row.channel_name?.trim(), row.topic_name?.trim() ? `🎮 ${row.topic_name.trim()}` : null].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Groups by video, not by row: the extension reports a chunk every ~60s
 * while a video plays (see content.ts), so a single 8-minute video
 * produces ~8 rows. Grouping by video_url (falling back to the title)
 * collapses those back into one entry before anything gets counted.
 */
function aggregateYoutubeRows(rows: YoutubeEventRow[]): BreakdownItem[] {
  const totals = new Map<string, BreakdownItem>();

  for (const row of rows) {
    const key = row.video_url?.trim() || `title:${row.video_title}`;
    const minutes = (row.duration_seconds ?? 0) / 60;

    const existing = totals.get(key);
    if (existing) {
      existing.minutes += minutes;
      if (!existing.sublabel) existing.sublabel = youtubeSublabel(row);
    } else {
      totals.set(key, {
        key,
        label: row.video_title,
        sublabel: youtubeSublabel(row),
        minutes,
      });
    }
  }

  return Array.from(totals.values())
    .map((item) => ({ ...item, minutes: Math.round(item.minutes) }))
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Events are pushed by the Chrome extension (see /api/ingest/youtube).
 * Like Trakt, this is an append-only log so "this month" is just a date
 * filter — but unlike Trakt, rows aren't one-per-video (see
 * aggregateYoutubeRows), so video counts must come from the grouped
 * result, never from raw row counts.
 */
export async function getYoutubeDashboardData(): Promise<YoutubeDashboardData> {
  const supabase = getSupabaseAdmin();

  const { data: allRows, error: allError } = await supabase
    .from("youtube_events")
    .select(YOUTUBE_EVENT_COLUMNS);

  if (allError) {
    throw new Error(`Failed to load YouTube events: ${allError.message}`);
  }

  const monthStart = startOfCurrentMonthIso();

  const { data: monthRows, error: monthError } = await supabase
    .from("youtube_events")
    .select(YOUTUBE_EVENT_COLUMNS)
    .gte("watched_at", monthStart);

  if (monthError) {
    throw new Error(`Failed to load YouTube events for this month: ${monthError.message}`);
  }

  const allTimeItems = aggregateYoutubeRows(allRows ?? []);
  const monthItems = aggregateYoutubeRows(monthRows ?? []);

  return {
    allTime: {
      totalMinutes: allTimeItems.reduce((sum, item) => sum + item.minutes, 0),
      totalVideos: allTimeItems.length,
      items: allTimeItems.slice(0, 15),
    },
    thisMonth: {
      totalMinutes: monthItems.reduce((sum, item) => sum + item.minutes, 0),
      totalVideos: monthItems.length,
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

export interface WrappedData {
  monthKey: string;
  monthLabel: string;
  totalMinutes: number;
  steam: { totalMinutes: number; topGame: BreakdownItem | null };
  trakt: {
    totalMinutes: number;
    topItem: BreakdownItem | null;
    movieCount: number;
    episodeCount: number;
  };
  youtube: { totalMinutes: number; topVideo: BreakdownItem | null; videoCount: number };
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeyRange(monthKey: string): { start: string; end: string; label: string } {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid month key: "${monthKey}" (expected "YYYY-MM")`);
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const label = start.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return { start: start.toISOString(), end: end.toISOString(), label };
}

/**
 * "Wrapped"-style recap for a single calendar month, combining all three
 * sources. Reuses the same per-source aggregation helpers as the dashboard,
 * just scoped to [start, end) instead of "since the start of this month".
 */
export async function getMonthlyWrapped(monthKey: string): Promise<WrappedData> {
  const supabase = getSupabaseAdmin();
  const { start, end, label } = monthKeyRange(monthKey);

  const [steamRes, traktRes, youtubeRes] = await Promise.all([
    supabase
      .from("steam_sessions")
      .select("steam_appid, game_name, minutes_played")
      .gte("period_end", start)
      .lt("period_end", end),
    supabase
      .from("trakt_watches")
      .select("title, media_type, show_title, duration_minutes")
      .gte("watched_at", start)
      .lt("watched_at", end),
    supabase
      .from("youtube_events")
      .select(YOUTUBE_EVENT_COLUMNS)
      .gte("watched_at", start)
      .lt("watched_at", end),
  ]);

  if (steamRes.error) {
    throw new Error(`Failed to load Steam sessions for Wrapped: ${steamRes.error.message}`);
  }
  if (traktRes.error) {
    throw new Error(`Failed to load Trakt watches for Wrapped: ${traktRes.error.message}`);
  }
  if (youtubeRes.error) {
    throw new Error(`Failed to load YouTube events for Wrapped: ${youtubeRes.error.message}`);
  }

  const steamTotals = new Map<number, BreakdownItem>();
  for (const row of steamRes.data ?? []) {
    const existing = steamTotals.get(row.steam_appid);
    if (existing) {
      existing.minutes += row.minutes_played;
    } else {
      steamTotals.set(row.steam_appid, {
        key: String(row.steam_appid),
        label: row.game_name,
        minutes: row.minutes_played,
      });
    }
  }
  const steamItems = Array.from(steamTotals.values()).sort((a, b) => b.minutes - a.minutes);
  const steamTotalMinutes = steamItems.reduce((sum, item) => sum + item.minutes, 0);

  const traktRows = traktRes.data ?? [];
  const traktItems = aggregateTraktRows(traktRows);
  const traktTotalMinutes = traktItems.reduce((sum, item) => sum + item.minutes, 0);
  const movieCount = traktRows.filter((row) => row.media_type === "movie").length;
  const episodeCount = traktRows.filter((row) => row.media_type === "episode").length;

  const youtubeRows = youtubeRes.data ?? [];
  const youtubeItems = aggregateYoutubeRows(youtubeRows);
  const youtubeTotalMinutes = youtubeItems.reduce((sum, item) => sum + item.minutes, 0);

  return {
    monthKey,
    monthLabel: label,
    totalMinutes: steamTotalMinutes + traktTotalMinutes + youtubeTotalMinutes,
    steam: { totalMinutes: steamTotalMinutes, topGame: steamItems[0] ?? null },
    trakt: {
      totalMinutes: traktTotalMinutes,
      topItem: traktItems[0] ?? null,
      movieCount,
      episodeCount,
    },
    youtube: {
      totalMinutes: youtubeTotalMinutes,
      topVideo: youtubeItems[0] ?? null,
      videoCount: youtubeItems.length,
    },
  };
}

export interface WeeklyCategoryBreakdown {
  weekStart: string; // YYYY-MM-DD (Monday, UTC)
  steamMinutes: number;
  traktMinutes: number;
  youtubeMinutes: number;
}

function mondayOf(date: Date): Date {
  const monday = new Date(date);
  monday.setUTCHours(0, 0, 0, 0);
  const dayOffset = (monday.getUTCDay() + 6) % 7; // 0 = Monday
  monday.setUTCDate(monday.getUTCDate() - dayOffset);
  return monday;
}

/**
 * Total minutes per category (Steam/Trakt/YouTube) for each of the last
 * `weeksBack` ISO weeks (Monday-start) — used to show how the mix of
 * entertainment shifts week over week, as opposed to the heatmap (combined
 * total per day) or the Wrapped view (single month snapshot).
 */
export async function getWeeklyCategoryBreakdown(
  weeksBack = 8
): Promise<WeeklyCategoryBreakdown[]> {
  const supabase = getSupabaseAdmin();

  const currentWeekStart = mondayOf(new Date());
  const sinceWeekStart = new Date(currentWeekStart);
  sinceWeekStart.setUTCDate(sinceWeekStart.getUTCDate() - (weeksBack - 1) * 7);
  const sinceIso = sinceWeekStart.toISOString();

  const [steamRes, traktRes, youtubeRes] = await Promise.all([
    supabase.from("steam_sessions").select("minutes_played, period_end").gte("period_end", sinceIso),
    supabase.from("trakt_watches").select("duration_minutes, watched_at").gte("watched_at", sinceIso),
    supabase.from("youtube_events").select("duration_seconds, watched_at").gte("watched_at", sinceIso),
  ]);

  if (steamRes.error) {
    throw new Error(`Failed to load Steam sessions for weekly breakdown: ${steamRes.error.message}`);
  }
  if (traktRes.error) {
    throw new Error(`Failed to load Trakt watches for weekly breakdown: ${traktRes.error.message}`);
  }
  if (youtubeRes.error) {
    throw new Error(
      `Failed to load YouTube events for weekly breakdown: ${youtubeRes.error.message}`
    );
  }

  const weeks = new Map<string, WeeklyCategoryBreakdown>();
  for (let i = 0; i < weeksBack; i++) {
    const weekStart = new Date(sinceWeekStart);
    weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
    const key = weekStart.toISOString().slice(0, 10);
    weeks.set(key, { weekStart: key, steamMinutes: 0, traktMinutes: 0, youtubeMinutes: 0 });
  }

  const addTo = (
    dateIso: string,
    field: "steamMinutes" | "traktMinutes" | "youtubeMinutes",
    minutes: number
  ) => {
    if (minutes <= 0) return;
    const key = mondayOf(new Date(dateIso)).toISOString().slice(0, 10);
    const bucket = weeks.get(key);
    if (bucket) bucket[field] += minutes;
  };

  for (const row of steamRes.data ?? []) addTo(row.period_end, "steamMinutes", row.minutes_played);
  for (const row of traktRes.data ?? []) {
    addTo(row.watched_at, "traktMinutes", row.duration_minutes ?? 0);
  }
  for (const row of youtubeRes.data ?? []) {
    addTo(row.watched_at, "youtubeMinutes", (row.duration_seconds ?? 0) / 60);
  }

  return Array.from(weeks.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week) => ({
      ...week,
      steamMinutes: Math.round(week.steamMinutes),
      traktMinutes: Math.round(week.traktMinutes),
      youtubeMinutes: Math.round(week.youtubeMinutes),
    }));
}

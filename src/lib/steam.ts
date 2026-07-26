import { getSupabaseAdmin } from "@/lib/supabase-admin";

interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url?: string;
}

interface SteamOwnedGamesResponse {
  response: {
    game_count?: number;
    games?: SteamOwnedGame[];
  };
}

interface LatestSnapshotRow {
  steam_appid: number;
  playtime_forever_minutes: number;
  captured_at: string;
}

export interface SteamSyncResult {
  capturedAt: string;
  gamesProcessed: number;
  sessionsCreated: number;
}

async function fetchOwnedGames(
  apiKey: string,
  steamId: string
): Promise<SteamOwnedGame[]> {
  const url = new URL(
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("format", "json");
  url.searchParams.set("include_appinfo", "true");
  url.searchParams.set("include_played_free_games", "true");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Steam API request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as SteamOwnedGamesResponse;
  return data.response.games ?? [];
}

function iconUrl(appid: number, iconHash?: string): string | null {
  if (!iconHash) return null;
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${iconHash}.jpg`;
}

/**
 * Fetches the current total playtime for every owned game, stores a
 * snapshot, and derives a `steam_sessions` row from the delta against the
 * previous snapshot of the same game (Steam's API only ever reports a
 * running total, not per-session history).
 */
export async function syncSteamPlaytime(): Promise<SteamSyncResult> {
  const apiKey = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_ID64;

  if (!apiKey || !steamId) {
    throw new Error("Missing STEAM_API_KEY or STEAM_ID64 environment variables.");
  }

  const games = await fetchOwnedGames(apiKey, steamId);
  const capturedAt = new Date().toISOString();
  const supabase = getSupabaseAdmin();

  if (games.length === 0) {
    return { capturedAt, gamesProcessed: 0, sessionsCreated: 0 };
  }

  const appids = games.map((game) => game.appid);
  const { data: latestSnapshots, error: latestError } = await supabase
    .from("steam_latest_snapshots")
    .select("steam_appid, playtime_forever_minutes, captured_at")
    .in("steam_appid", appids);

  if (latestError) {
    throw new Error(`Failed to read previous snapshots: ${latestError.message}`);
  }

  const previousByAppid = new Map<number, LatestSnapshotRow>(
    (latestSnapshots ?? []).map((row) => [row.steam_appid, row])
  );

  const sessions = games.flatMap((game) => {
    const previous = previousByAppid.get(game.appid);
    if (!previous) return [];

    const minutesPlayed = game.playtime_forever - previous.playtime_forever_minutes;
    if (minutesPlayed <= 0) return [];

    return [
      {
        steam_appid: game.appid,
        game_name: game.name,
        minutes_played: minutesPlayed,
        period_start: previous.captured_at,
        period_end: capturedAt,
        source: "steam",
      },
    ];
  });

  const snapshots = games.map((game) => ({
    steam_appid: game.appid,
    game_name: game.name,
    icon_url: iconUrl(game.appid, game.img_icon_url),
    playtime_forever_minutes: game.playtime_forever,
    captured_at: capturedAt,
  }));

  if (sessions.length > 0) {
    const { error: sessionsError } = await supabase.from("steam_sessions").insert(sessions);
    if (sessionsError) {
      throw new Error(`Failed to insert steam_sessions: ${sessionsError.message}`);
    }
  }

  const { error: snapshotsError } = await supabase
    .from("steam_playtime_snapshots")
    .insert(snapshots);
  if (snapshotsError) {
    throw new Error(`Failed to insert steam_playtime_snapshots: ${snapshotsError.message}`);
  }

  return {
    capturedAt,
    gamesProcessed: games.length,
    sessionsCreated: sessions.length,
  };
}

import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TRAKT_API_BASE = "https://api.trakt.tv";
const TOKEN_REFRESH_BUFFER_MS = 3 * 24 * 60 * 60 * 1000; // refresh 3 days before expiry
const MAX_HISTORY_PAGES = 50; // safety cap: 50 pages * 100 items = 5000 items per run

interface TraktTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface TraktTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface TraktIds {
  trakt: number;
}

interface TraktShow {
  title: string;
  ids: TraktIds;
  runtime?: number;
}

interface TraktEpisode {
  season: number;
  number: number;
  title: string;
  runtime?: number;
}

interface TraktMovie {
  title: string;
  runtime?: number;
}

interface TraktHistoryItem {
  id: number;
  watched_at: string;
  action: string;
  type: "movie" | "episode";
  show?: TraktShow;
  episode?: TraktEpisode;
  movie?: TraktMovie;
}

export interface TraktSyncResult {
  itemsFetched: number;
  itemsInserted: number;
  pagesFetched: number;
}

function traktCredentials() {
  const clientId = process.env.TRAKT_CLIENT_ID;
  const clientSecret = process.env.TRAKT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing TRAKT_CLIENT_ID or TRAKT_CLIENT_SECRET environment variables.");
  }
  return { clientId, clientSecret };
}

async function getStoredTokens(): Promise<TraktTokenRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trakt_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read Trakt tokens: ${error.message}`);
  }

  return data;
}

async function saveTokens(tokens: TraktTokenResponse): Promise<void> {
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error } = await supabase.from("trakt_tokens").upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to store Trakt tokens: ${error.message}`);
  }
}

async function refreshTokens(refreshToken: string): Promise<TraktTokenResponse> {
  const { clientId, clientSecret } = traktCredentials();

  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Trakt token refresh failed: ${res.status} ${res.statusText}. Re-run "npm run trakt:authorize".`
    );
  }

  return (await res.json()) as TraktTokenResponse;
}

/**
 * Returns a valid access token, refreshing (and persisting the rotated
 * refresh token) if the stored one is missing or close to expiry. Requires
 * `npm run trakt:authorize` to have been run at least once to seed
 * trakt_tokens.
 */
export async function getValidAccessToken(): Promise<string> {
  const stored = await getStoredTokens();
  if (!stored) {
    throw new Error(
      'No Trakt tokens found. Run "npm run trakt:authorize" once to authorize this app.'
    );
  }

  const expiresAt = new Date(stored.expires_at).getTime();
  if (expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return stored.access_token;
  }

  const refreshed = await refreshTokens(stored.refresh_token);
  await saveTokens(refreshed);
  return refreshed.access_token;
}

async function fetchHistoryPage(
  accessToken: string,
  clientId: string,
  page: number,
  startAt: string | null
): Promise<{ items: TraktHistoryItem[]; pageCount: number }> {
  const url = new URL(`${TRAKT_API_BASE}/sync/history`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", "100");
  url.searchParams.set("extended", "full");
  if (startAt) url.searchParams.set("start_at", startAt);

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Trakt history request failed: ${res.status} ${res.statusText}`);
  }

  const items = (await res.json()) as TraktHistoryItem[];
  const pageCount = Number(res.headers.get("x-pagination-page-count") ?? "1");
  return { items, pageCount };
}

function mapHistoryItem(item: TraktHistoryItem) {
  if (item.type === "movie" && item.movie) {
    return {
      trakt_history_id: item.id,
      title: item.movie.title,
      media_type: "movie" as const,
      show_title: null,
      season_number: null,
      episode_number: null,
      duration_minutes: item.movie.runtime ?? null,
      watched_at: item.watched_at,
      source: "trakt",
    };
  }

  if (item.type === "episode" && item.episode && item.show) {
    return {
      trakt_history_id: item.id,
      title: item.episode.title ?? `Episode ${item.episode.number}`,
      media_type: "episode" as const,
      show_title: item.show.title,
      season_number: item.episode.season,
      episode_number: item.episode.number,
      duration_minutes: item.episode.runtime ?? item.show.runtime ?? null,
      watched_at: item.watched_at,
      source: "trakt",
    };
  }

  return null;
}

/**
 * Fetches Trakt watch history since the last stored entry and upserts it
 * into trakt_watches, deduplicating on trakt_history_id. Unlike Steam,
 * Trakt's history endpoint is a true append-only log, so no delta
 * computation is needed here.
 */
export async function syncTraktHistory(): Promise<TraktSyncResult> {
  const { clientId } = traktCredentials();
  const accessToken = await getValidAccessToken();
  const supabase = getSupabaseAdmin();

  const { data: lastWatch, error: lastWatchError } = await supabase
    .from("trakt_watches")
    .select("watched_at")
    .order("watched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastWatchError) {
    throw new Error(`Failed to read last Trakt watch: ${lastWatchError.message}`);
  }

  const startAt = lastWatch?.watched_at ?? null;

  const allItems: TraktHistoryItem[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const result = await fetchHistoryPage(accessToken, clientId, page, startAt);
    allItems.push(...result.items);
    pageCount = result.pageCount;
    page += 1;
  } while (page <= pageCount && page <= MAX_HISTORY_PAGES);

  const rows = allItems.map(mapHistoryItem).filter((row) => row !== null);

  if (rows.length === 0) {
    return { itemsFetched: allItems.length, itemsInserted: 0, pagesFetched: page - 1 };
  }

  const { error: upsertError } = await supabase
    .from("trakt_watches")
    .upsert(rows, { onConflict: "trakt_history_id", ignoreDuplicates: true });

  if (upsertError) {
    throw new Error(`Failed to insert trakt_watches: ${upsertError.message}`);
  }

  return {
    itemsFetched: allItems.length,
    itemsInserted: rows.length,
    pagesFetched: page - 1,
  };
}

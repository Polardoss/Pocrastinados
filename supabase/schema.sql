-- Pocrastinados database schema
--
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh
-- project. Tables are only ever read/written with the service role key from
-- server-side code (API routes, cron jobs, the ingestion endpoint), so Row
-- Level Security is enabled with no policies: the anon/public key gets no
-- access at all, which is the intended behavior for a solo dashboard.

-- ---------------------------------------------------------------------------
-- Steam
-- ---------------------------------------------------------------------------

-- Raw snapshot of "total minutes played" per game, taken on every fetch.
-- The Steam API only exposes a running total (not a session history), so we
-- keep every snapshot and derive sessions from the delta between two
-- consecutive snapshots of the same game (see steam_sessions below).
create table if not exists steam_playtime_snapshots (
  id bigint generated always as identity primary key,
  steam_appid integer not null,
  game_name text not null,
  icon_url text,
  playtime_forever_minutes integer not null,
  captured_at timestamptz not null default now()
);

create index if not exists steam_playtime_snapshots_appid_captured_idx
  on steam_playtime_snapshots (steam_appid, captured_at desc);

-- Derived play sessions: minutes played between two fetches, for a game.
-- One row is inserted per game on every fetch run once a prior snapshot
-- exists to diff against.
create table if not exists steam_sessions (
  id bigint generated always as identity primary key,
  steam_appid integer not null,
  game_name text not null,
  minutes_played integer not null check (minutes_played >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  source text not null default 'steam',
  created_at timestamptz not null default now()
);

create index if not exists steam_sessions_period_end_idx on steam_sessions (period_end desc);
create index if not exists steam_sessions_appid_idx on steam_sessions (steam_appid);

-- ---------------------------------------------------------------------------
-- Trakt (movies / TV episodes)
-- ---------------------------------------------------------------------------

create table if not exists trakt_watches (
  id bigint generated always as identity primary key,
  trakt_history_id bigint unique,
  title text not null,
  media_type text not null check (media_type in ('movie', 'episode')),
  show_title text,
  season_number integer,
  episode_number integer,
  duration_minutes integer,
  watched_at timestamptz not null,
  source text not null default 'trakt',
  created_at timestamptz not null default now()
);

create index if not exists trakt_watches_watched_at_idx on trakt_watches (watched_at desc);

-- ---------------------------------------------------------------------------
-- YouTube (pushed by the Chrome extension)
-- ---------------------------------------------------------------------------

create table if not exists youtube_events (
  id bigint generated always as identity primary key,
  video_title text not null,
  channel_name text,
  video_url text,
  duration_seconds integer,
  watched_at timestamptz not null default now(),
  source text not null default 'youtube',
  created_at timestamptz not null default now()
);

create index if not exists youtube_events_watched_at_idx on youtube_events (watched_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table steam_playtime_snapshots enable row level security;
alter table steam_sessions enable row level security;
alter table trakt_watches enable row level security;
alter table youtube_events enable row level security;

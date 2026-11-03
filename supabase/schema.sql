-- Music Hub database schema.
-- Run this in Supabase → SQL Editor → New query → paste → Run.
-- Safe to run again after updates: it only adds what's missing.

-- Sign-ins to Spotify and YouTube (one row per service).
create table if not exists connections (
  service       text primary key check (service in ('spotify', 'youtube')),
  account_name  text,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

-- One row per song, no matter how many services have it.
create table if not exists tracks (
  id          uuid primary key default gen_random_uuid(),
  match_key   text not null unique,      -- "artist|title", simplified; how duplicates are merged
  title       text not null,
  artist      text not null,
  album       text,
  duration_ms integer,
  isrc        text,                      -- global song ID (Spotify provides it)
  image_url   text,
  created_at  timestamptz not null default now()
);

-- Where a song lives: its Spotify ID and/or YouTube video ID.
create table if not exists track_sources (
  id          bigint generated always as identity primary key,
  track_id    uuid not null references tracks(id) on delete cascade,
  service     text not null check (service in ('spotify', 'youtube')),
  external_id text not null,
  url         text,
  unique (service, external_id)
);
create index if not exists track_sources_track_id_idx on track_sources(track_id);

-- Playlists imported from each service.
create table if not exists playlists (
  id          uuid primary key default gen_random_uuid(),
  service     text not null check (service in ('spotify', 'youtube')),
  external_id text not null,
  name        text not null,
  description text,
  image_url   text,
  imported_at timestamptz not null default now(),
  unique (service, external_id)
);

-- The songs in each playlist, in order.
create table if not exists playlist_items (
  playlist_id uuid not null references playlists(id) on delete cascade,
  position    integer not null,
  track_id    uuid not null references tracks(id) on delete cascade,
  primary key (playlist_id, position)
);
create index if not exists playlist_items_track_id_idx on playlist_items(track_id);

-- Every playlist found on a service, imported or not, with your include/skip choice.
create table if not exists source_playlists (
  service     text not null check (service in ('spotify', 'youtube')),
  external_id text not null,
  name        text not null,
  item_count  integer not null default 0,
  music_ratio real,                 -- share of items that are music (YouTube), 0 to 1
  user_choice boolean,              -- null = automatic, true = always import, false = never
  last_seen   timestamptz not null default now(),
  primary key (service, external_id)
);

-- Music videos: one official video per song, when one exists.
alter table tracks add column if not exists video_id         text;        -- YouTube video ID
alter table tracks add column if not exists video_status     text;        -- null = not checked, 'found', 'none'
alter table tracks add column if not exists video_source     text;        -- how it was found
alter table tracks add column if not exists video_checked_at timestamptz;
create index if not exists tracks_video_status_idx on tracks(video_status);

-- ── Ready for later phases ──────────────────────────────────────────
create table if not exists tags (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  color text
);

create table if not exists track_tags (
  track_id uuid not null references tracks(id) on delete cascade,
  tag_id   uuid not null references tags(id) on delete cascade,
  primary key (track_id, tag_id)
);

create table if not exists ratings (
  track_id   uuid primary key references tracks(id) on delete cascade,
  stars      smallint check (stars between 1 and 5),
  note       text,
  updated_at timestamptz not null default now()
);

create table if not exists plays (
  id        bigint generated always as identity primary key,
  track_id  uuid not null references tracks(id) on delete cascade,
  service   text not null,
  played_at timestamptz not null default now()
);

-- ── Helper functions ────────────────────────────────────────────────

-- Marks videos found during a YouTube import (only fills songs that have none yet).
create or replace function set_track_videos(items jsonb) returns void
language sql set search_path = public as $$
  update tracks t
     set video_id = i.video_id, video_status = 'found', video_source = i.source, video_checked_at = now()
    from jsonb_to_recordset(items) as i(track_id uuid, video_id text, source text)
   where t.id = i.track_id and t.video_id is null;
$$;

-- Removes songs no longer in any playlist (unless you rated or tagged them).
create or replace function delete_orphan_tracks() returns integer
language sql set search_path = public as $$
  with gone as (
    delete from tracks t
     where not exists (select 1 from playlist_items p where p.track_id = t.id)
       and not exists (select 1 from ratings r where r.track_id = t.id)
       and not exists (select 1 from track_tags g where g.track_id = t.id)
    returning 1
  )
  select count(*)::int from gone;
$$;

-- Only your server may call these.
revoke execute on function set_track_videos(jsonb) from public, anon, authenticated;
revoke execute on function delete_orphan_tracks() from public, anon, authenticated;
grant execute on function set_track_videos(jsonb) to service_role;
grant execute on function delete_orphan_tracks() to service_role;

-- Lock every table: with Row Level Security on and no policies, only your
-- server (using the secret key) can read or write. The public key gets nothing.
alter table connections    enable row level security;
alter table tracks         enable row level security;
alter table track_sources  enable row level security;
alter table playlists      enable row level security;
alter table playlist_items enable row level security;
alter table tags           enable row level security;
alter table track_tags     enable row level security;
alter table ratings        enable row level security;
alter table plays          enable row level security;
alter table source_playlists enable row level security;

-- ── YouTube audio versions (for "YouTube mode") ─────────────────────
-- The YouTube upload to play for each song when playing inside the hub.
alter table tracks add column if not exists yt_audio_id         text;
alter table tracks add column if not exists yt_audio_status     text;   -- null = not checked, 'found', 'none'
alter table tracks add column if not exists yt_audio_source     text;   -- 'library', 'ytmusic', 'youtube-search'
alter table tracks add column if not exists yt_audio_checked_at timestamptz;
create index if not exists tracks_yt_audio_status_idx on tracks(yt_audio_status);

-- Songs you already have on YouTube use that upload as their audio version.
create or replace function fill_yt_audio_from_sources() returns integer
language sql set search_path = public as $$
  with src as (
    select distinct on (track_id) track_id, external_id
      from track_sources where service = 'youtube'
     order by track_id, id
  ), upd as (
    update tracks t
       set yt_audio_id = src.external_id, yt_audio_status = 'found',
           yt_audio_source = 'library', yt_audio_checked_at = now()
      from src
     where t.id = src.track_id and t.yt_audio_id is null
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke execute on function fill_yt_audio_from_sources() from public, anon, authenticated;
grant execute on function fill_yt_audio_from_sources() to service_role;

-- When a song was last added to each playlist (for sorting by "Recently updated").
alter table playlists add column if not exists last_added_at timestamptz;

-- Artists for the Library's Artists view: main artist (first name in the
-- credits), with how many songs and music videos each has.
create or replace function artist_summary(search text default null, by_name boolean default false, limit_n integer default 300)
returns table(artist text, songs bigint, videos bigint, image_url text)
language sql stable set search_path = public as $$
  with t as (
    select trim((regexp_split_to_array(artist, '\s*(,|&|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*', 'i'))[1]) as a,
           video_id, image_url
      from tracks
  )
  select a, count(*), count(video_id), (array_agg(image_url) filter (where image_url is not null))[1]
    from t
   where a <> '' and (search is null or a ilike '%' || search || '%')
   group by a
   order by case when by_name then null else count(*) end desc nulls last, lower(a)
   limit limit_n;
$$;
revoke execute on function artist_summary(text, boolean, integer) from public, anon, authenticated;
grant execute on function artist_summary(text, boolean, integer) to service_role;

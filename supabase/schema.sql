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

-- ── Whole-library paging and hub playlists ──────────────────────────
-- Playlists you make inside the hub have service = 'hub'.
alter table playlists drop constraint if exists playlists_service_check, add constraint playlists_service_check check (service in ('spotify', 'youtube', 'hub'));

-- One page of the Library (any filter, any order). `seed` gives a shuffled
-- order that stays the same while paging. Also returns how many match.
create or replace function library_page(
  q text default null, only_videos boolean default false, both_services boolean default false,
  main_artist text default null, sort_by text default 'artist', seed text default null,
  off_n integer default 0, lim_n integer default 200)
returns table(id uuid, total bigint)
language sql stable set search_path = public as $$
  select t.id, count(*) over () as total
    from tracks t
   where (q is null or t.title ilike '%' || q || '%' or t.artist ilike '%' || q || '%' or t.album ilike '%' || q || '%')
     and (not only_videos or t.video_id is not null)
     and (not both_services or (select count(distinct s.service) from track_sources s where s.track_id = t.id) > 1)
     and (main_artist is null or lower(trim((regexp_split_to_array(t.artist, '\s*(,|&|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*', 'i'))[1])) = lower(main_artist))
   order by
     case when seed is not null then md5(t.id::text || seed) end,
     case when sort_by = 'recent' then t.created_at end desc,
     case when sort_by = 'video' then t.video_id is null end,
     case when sort_by = 'title' then lower(t.title) end,
     lower(t.artist), lower(t.title), t.id
   offset off_n limit lim_n;
$$;
revoke execute on function library_page(text, boolean, boolean, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function library_page(text, boolean, boolean, text, text, text, integer, integer) to service_role;

-- Artists in pages (off_n) so every artist can be shown (replaces artist_summary).
create or replace function artist_page(search text default null, by_name boolean default false, off_n integer default 0, limit_n integer default 200)
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
   offset off_n limit limit_n;
$$;
revoke execute on function artist_page(text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function artist_page(text, boolean, integer, integer) to service_role;

-- ── Resumable imports ───────────────────────────────────────────────
-- Spotify's "snapshot" of each playlist changes whenever the playlist
-- changes, so unchanged playlists can be skipped on the next import.
alter table source_playlists add column if not exists snapshot text;
-- Where a long import got to, so the next round carries on from there
-- (each round must finish within Vercel's 5-minute limit).
create table if not exists import_progress (
  service     text primary key check (service in ('spotify', 'youtube')),
  next_offset integer not null default 0,
  total       integer not null default 0,
  playlists   integer not null default 0,
  unchanged   integer not null default 0,
  songs       integer not null default 0,
  excluded    integer not null default 0,
  skipped     jsonb not null default '[]'::jsonb,
  done        boolean not null default false,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table import_progress enable row level security;
-- When Spotify asks the app to wait (a long "429" pause), the end time is
-- kept here so nobody asks Spotify again before then (that can lengthen it).
alter table import_progress add column if not exists blocked_until timestamptz;

-- ── Discover (dated editions that never change) ─────────────────────
-- Every daily / weekly / monthly list is made once by scripts/discover.py,
-- gets a date, and is kept forever so nothing ever disappears.
create table if not exists discover_editions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('daily', 'weekly', 'releases', 'month', 'forgotten')),
  edition_date date not null,
  title        text not null,
  subtitle     text,
  created_at   timestamptz not null default now(),
  unique (kind, edition_date)
);
create table if not exists discover_items (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references discover_editions(id) on delete cascade,
  position    integer not null,
  track_id    uuid references tracks(id) on delete set null,  -- set for library songs, and once hearted
  yt_video_id text,
  title       text not null,
  artist      text not null,
  album       text,
  image_url   text,
  duration_ms integer,
  reason      text,             -- "Because you like HYUKOH"
  match_key   text,             -- same rule as tracks.match_key; never suggest a song twice
  hearted     boolean not null default false
);
create index if not exists discover_items_edition_idx on discover_items(edition_id, position);
create index if not exists discover_items_match_key_idx on discover_items(match_key);
-- Cache of YouTube Music artist pages (related artists, top songs, releases).
create table if not exists discover_artists (
  name_key    text primary key,
  name        text not null,
  browse_id   text,
  data        jsonb,
  fetched_at  timestamptz,
  releases_scanned_at timestamptz
);
-- Releases seen on your artists' pages; new ones become Friday New Releases.
create table if not exists discover_releases (
  browse_id  text primary key,
  artist     text not null,
  title      text not null,
  kind       text,
  year       text,
  first_seen date not null default current_date,
  published  boolean not null default false
);
alter table discover_editions enable row level security;
alter table discover_items enable row level security;
alter table discover_artists enable row level security;
alter table discover_releases enable row level security;
create index if not exists plays_played_at_idx on plays(played_at);

-- Library songs not played in the hub for 6 months (or ever), for Forgotten favorites.
create or replace function forgotten_candidates(lim integer default 300)
returns table (track_id uuid, title text, artist text, album text, image_url text, duration_ms integer,
               yt_audio_id text, playlist text, last_added_at timestamptz, last_played timestamptz)
language sql set search_path = public as $$
  select t.id, t.title, t.artist, t.album, t.image_url, t.duration_ms, t.yt_audio_id,
         (select p.name from playlist_items pi join playlists p on p.id = pi.playlist_id
           where pi.track_id = t.id and p.service <> 'hub' order by p.last_added_at nulls first limit 1),
         (select min(p.last_added_at) from playlist_items pi join playlists p on p.id = pi.playlist_id
           where pi.track_id = t.id and p.service <> 'hub'),
         (select max(pl.played_at) from plays pl where pl.track_id = t.id)
    from tracks t
   where t.yt_audio_id is not null
     and not exists (select 1 from plays pl where pl.track_id = t.id and pl.played_at > now() - interval '180 days')
   order by random()
   limit lim;
$$;

-- Most-played songs of a month, for the Month mix.
create or replace function month_top_tracks(month_start date, lim integer default 40)
returns table (track_id uuid, plays bigint)
language sql set search_path = public as $$
  select pl.track_id, count(*) from plays pl
   where pl.played_at >= month_start and pl.played_at < (month_start + interval '1 month')
   group by pl.track_id order by count(*) desc limit lim;
$$;

-- ── Spotify queue handoff ───────────────────────────────────────────
-- Spotify's apps ignore a list of songs handed over at once, but they do
-- follow their own queue. The hub plays the first song and adds the rest
-- to Spotify's queue; it remembers what it added so leftovers can be
-- skipped next time (Spotify has no "clear queue").
create table if not exists spotify_queue_state (
  id         integer primary key default 1 check (id = 1),
  queued     text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table spotify_queue_state enable row level security;

-- ── Radio ───────────────────────────────────────────────────────────
-- Songs met on a radio (YouTube Music "radio" from any song) that aren't in
-- your library, so they can be kept or added to a playlist later.
create table if not exists radio_songs (
  video_id    text primary key,
  title       text not null,
  artist      text not null,
  album       text,
  image_url   text,
  duration_ms integer,
  seen_at     timestamptz not null default now()
);
alter table radio_songs enable row level security;

-- ── Saved radios ────────────────────────────────────────────────────
-- Every radio you start is kept as a dated edition (kind 'radio'), listing
-- the songs it served, so it shows in Past editions and never disappears.
-- Several radios can share a day, so the one-per-day rule skips them.
alter table discover_editions drop constraint if exists discover_editions_kind_check;
alter table discover_editions add constraint discover_editions_kind_check check (kind in ('daily', 'weekly', 'releases', 'month', 'forgotten', 'radio'));
alter table discover_editions drop constraint if exists discover_editions_kind_edition_date_key;
create unique index if not exists discover_editions_one_per_day on discover_editions(kind, edition_date) where kind <> 'radio';
alter table discover_editions add column if not exists seed_video_id text;
alter table discover_editions add column if not exists playlist_id uuid references playlists(id) on delete set null;  -- set once saved as a playlist

-- ── Crash log ──────────────────────────────────────────────────────
-- Notes the app sends about itself: errors, and restarts that happened
-- while music was playing (iOS shutting the home-screen app down).
create table if not exists client_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null,
  message    text,
  page       text,
  detail     jsonb
);
create index if not exists client_events_at on client_events(at desc);
alter table client_events enable row level security;

-- ── Taste ──────────────────────────────────────────────────────────
-- Your taste, per artist: how much of them you've saved, in how many of your
-- playlists, how often you play them, and what you've kept. Used to fit
-- radios from words to you (lib/taste.ts). Main artist = first name before , & x feat. ft.
create or replace function taste_artists(max_rows int default 4000)
returns table (artist_key text, artist text, songs int, playlists int, plays int, kept int, weight real)
language sql stable as $$
  with t as (
    select id,
      lower(trim(regexp_replace(split_part(regexp_replace(artist, '\s+(feat\.?|ft\.?|x|&|and)\s+.*$', '', 'i'), ',', 1), '\s+', ' ', 'g'))) as k,
      trim(split_part(regexp_replace(artist, '\s+(feat\.?|ft\.?|x|&|and)\s+.*$', '', 'i'), ',', 1)) as name
    from tracks
  ),
  s as (select k, min(name) as name, count(*)::int as songs from t where k <> '' group by k),
  p as (select t.k, count(distinct pi.playlist_id)::int as playlists from playlist_items pi join t on t.id = pi.track_id group by t.k),
  pl as (select t.k, count(*)::int as plays from plays join t on t.id = plays.track_id where plays.played_at > now() - interval '120 days' group by t.k),
  kp as (select t.k, count(*)::int as kept from discover_items d join t on t.id = d.track_id where d.hearted group by t.k)
  select s.k, s.name, s.songs, coalesce(p.playlists, 0), coalesce(pl.plays, 0), coalesce(kp.kept, 0),
    (ln(1 + s.songs) + 1.5 * ln(1 + coalesce(p.playlists, 0)) + 1.2 * ln(1 + coalesce(pl.plays, 0)) + 1.5 * coalesce(kp.kept, 0))::real as weight
  from s left join p using (k) left join pl using (k) left join kp using (k)
  order by weight desc
  limit max_rows;
$$;

-- Your own songs by some artists (keys as made by taste_artists), for mixing
-- them into radios from words. Only songs that can play in YouTube mode.
create or replace function library_tracks_for_artists(keys text[], per_artist int default 3)
returns table (id uuid)
language sql stable as $$
  select id from (
    select t.id, row_number() over (partition by k order by random()) as rn
    from (
      select id, yt_audio_id,
        lower(trim(regexp_replace(split_part(regexp_replace(artist, '\s+(feat\.?|ft\.?|x|&|and)\s+.*$', '', 'i'), ',', 1), '\s+', ' ', 'g'))) as k
      from tracks
    ) t
    where t.k = any(keys) and t.yt_audio_id is not null
  ) x where rn <= per_artist;
$$;

-- ── Artist profiles (deeper taste) ─────────────────────────────────
-- What the hub knows about each artist, filled by scripts/tag_artists.py
-- (MusicBrainz, free, no key): solo or group, vocal gender, where they're
-- from, genres and tags. `priority`: higher is fetched sooner.
create table if not exists artist_profiles (
  artist_key  text primary key,
  name        text not null,
  status      text not null default 'pending' check (status in ('pending', 'found', 'not_found', 'error')),
  priority    real not null default 0,
  mbid        text,
  kind        text,
  voice       text check (voice in ('male', 'female', 'mixed')),
  country     text,
  area        text,
  script      text,
  genres      text[] not null default '{}',
  tags        text[] not null default '{}',
  checked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists artist_profiles_queue on artist_profiles(status, priority desc);
alter table artist_profiles enable row level security;

-- Your own settings for how mixes are made. 'voice': per language, which
-- vocals to favour, e.g. {"thai":"male","chinese":"male"}.
create table if not exists taste_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table taste_settings enable row level security;
insert into taste_settings (key, value) values ('voice', '{"thai": "male", "chinese": "male"}')
on conflict (key) do nothing;

create or replace function queue_taste_artists(max_rows int default 9000)
returns int language sql as $$
  with ins as (
    insert into artist_profiles (artist_key, name, priority)
    select artist_key, artist, 100 + weight from taste_artists(max_rows)
    on conflict (artist_key) do update set priority = greatest(artist_profiles.priority, excluded.priority)
    returning 1
  ) select count(*)::int from ins;
$$;

create or replace function taste_tags(max_rows int default 80)
returns table (tag text, weight real, artists int)
language sql stable as $$
  with t as (select artist_key, weight from taste_artists(6000)),
  x as (
    select unnest(p.genres || p.tags) as tag, t.weight
    from artist_profiles p join t using (artist_key)
    where p.status = 'found'
  )
  select tag, sum(weight)::real, count(*)::int from x group by tag order by 2 desc limit max_rows;
$$;

-- For the "Your taste" page: where your music is from and whose voices,
-- weighted by how much you love each artist, plus tagging progress.
create or replace function taste_overview()
returns jsonb language sql stable as $$
  with t as (select artist_key, weight from taste_artists(6000)),
  p as (select p.*, t.weight from artist_profiles p join t using (artist_key) where p.status = 'found'),
  lang as (
    select case
      when p.script = 'thai' or p.country = 'TH' then 'Thai'
      when p.script = 'hangul' or p.country = 'KR' then 'Korean'
      when p.script = 'kana' or p.country = 'JP' then 'Japanese'
      when p.script = 'han' or p.country in ('CN','TW','HK','MO') then 'Chinese'
      else 'Other' end as lang, p.voice, p.weight from p
  )
  select jsonb_build_object(
    'progress', (select jsonb_object_agg(status, n) from (select status, count(*) n from artist_profiles group by status) s),
    'countries', (select coalesce(jsonb_agg(x order by w desc), '[]') from (select coalesce(country, '?') as country, round(sum(weight)::numeric, 1) as w, count(*) as n from p where country is not null group by 1 order by 2 desc limit 12) x),
    'voices', (select coalesce(jsonb_agg(x), '[]') from (select lang, voice, round(sum(weight)::numeric, 1) as w, count(*) as n from lang where voice is not null group by 1, 2) x)
  );
$$;
-- 'languages': your main languages and the ones you branch out to; Daily
-- discover leans on the main ones (scripts/discover.py weighted_seeds).
insert into taste_settings (key, value) values ('languages', '{"main": ["english", "korean"], "branch": ["japanese", "chinese", "thai", "filipino", "spanish", "french", "russian"]}')
on conflict (key) do nothing;

-- ── Set aside playlists (Playlist Tools Lab F2 + M3) ───────────────
-- Playlists you don't love much. They still play, but your taste profile
-- ignores songs that are only in set-aside playlists.
alter table playlists add column if not exists set_aside boolean not null default false;

-- Songs whose every playlist is set aside.
create or replace function set_aside_track_ids()
returns table (track_id uuid)
language sql stable as $$
  select pi.track_id from playlist_items pi join playlists p on p.id = pi.playlist_id
   group by pi.track_id
  having bool_and(p.set_aside);
$$;

create or replace function taste_artists(max_rows int default 4000)
returns table (artist_key text, artist text, songs int, playlists int, plays int, kept int, weight real)
language sql stable as $$
  with t as (
    select id,
      lower(trim(regexp_replace(split_part(regexp_replace(artist, '\s+(feat\.?|ft\.?|x|&|and)\s+.*$', '', 'i'), ',', 1), '\s+', ' ', 'g'))) as k,
      trim(split_part(regexp_replace(artist, '\s+(feat\.?|ft\.?|x|&|and)\s+.*$', '', 'i'), ',', 1)) as name
    from tracks
    where id not in (select track_id from set_aside_track_ids())
  ),
  s as (select k, min(name) as name, count(*)::int as songs from t where k <> '' group by k),
  p as (select t.k, count(distinct pi.playlist_id)::int as playlists from playlist_items pi join t on t.id = pi.track_id
          join playlists pp on pp.id = pi.playlist_id where not pp.set_aside group by t.k),
  pl as (select t.k, count(*)::int as plays from plays join t on t.id = plays.track_id where plays.played_at > now() - interval '120 days' group by t.k),
  kp as (select t.k, count(*)::int as kept from discover_items d join t on t.id = d.track_id where d.hearted group by t.k)
  select s.k, s.name, s.songs, coalesce(p.playlists, 0), coalesce(pl.plays, 0), coalesce(kp.kept, 0),
    (ln(1 + s.songs) + 1.5 * ln(1 + coalesce(p.playlists, 0)) + 1.2 * ln(1 + coalesce(pl.plays, 0)) + 1.5 * coalesce(kp.kept, 0))::real as weight
  from s left join p using (k) left join pl using (k) left join kp using (k)
  order by weight desc
  limit max_rows;
$$;

create or replace function forgotten_candidates(lim integer default 300)
returns table (track_id uuid, title text, artist text, album text, image_url text, duration_ms integer,
               yt_audio_id text, playlist text, last_added_at timestamptz, last_played timestamptz)
language sql set search_path = public as $$
  select t.id, t.title, t.artist, t.album, t.image_url, t.duration_ms, t.yt_audio_id,
         (select p.name from playlist_items pi join playlists p on p.id = pi.playlist_id
           where pi.track_id = t.id and p.service <> 'hub' and not p.set_aside order by p.last_added_at nulls first limit 1),
         (select min(p.last_added_at) from playlist_items pi join playlists p on p.id = pi.playlist_id
           where pi.track_id = t.id and p.service <> 'hub' and not p.set_aside),
         (select max(pl.played_at) from plays pl where pl.track_id = t.id)
    from tracks t
   where t.yt_audio_id is not null
     and t.id not in (select track_id from set_aside_track_ids())
     and not exists (select 1 from plays pl where pl.track_id = t.id and pl.played_at > now() - interval '180 days')
   order by random()
   limit lim;
$$;

-- The same as one array (no row limit through the API), for scripts/discover.py.
create or replace function set_aside_track_list()
returns uuid[] language sql stable as $$
  select coalesce(array_agg(track_id), '{}') from set_aside_track_ids();
$$;

-- ── Spotify versions of songs that only came from YouTube ───────────
-- Spotify mode hands Spotify a whole line-up so it keeps playing with the
-- phone locked. Songs without a Spotify ID (YouTube-only songs, discoveries,
-- radio songs) are looked up once with Spotify search and remembered here
-- (spotify_id null = not on Spotify). Key: simplified "artist|title".
create table if not exists spotify_matches (
  match_key  text primary key,
  spotify_id text,
  checked_at timestamptz not null default now()
);
alter table spotify_matches enable row level security;

-- ── Home Lab pick L3 + T3 + P2 + G2 + E3 (2026-11-05): pins and playlist tags ──
-- Pinned playlists sit at the top of Home in the order they were pinned.
alter table playlists add column if not exists pinned_at timestamptz;
-- Your own words on playlists (any service; imports never touch them).
-- Uses the same `tags` table as songs would; `color` is a palette name.
create table if not exists playlist_tags (
  playlist_id uuid not null references playlists(id) on delete cascade,
  tag_id      uuid not null references tags(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (playlist_id, tag_id)
);
create index if not exists playlist_tags_tag_idx on playlist_tags(tag_id);
alter table playlist_tags enable row level security;

-- library_page gains tag_ids: only songs from playlists that have every one
-- of those tags (Home's Songs view with tags chosen).
drop function if exists library_page(text, boolean, boolean, text, text, text, integer, integer);
create or replace function library_page(
  q text default null, only_videos boolean default false, both_services boolean default false,
  main_artist text default null, sort_by text default 'artist', seed text default null,
  off_n integer default 0, lim_n integer default 200, tag_ids uuid[] default null)
returns table(id uuid, total bigint)
language sql stable set search_path = public as $$
  with tagged as (
    select pt.playlist_id from playlist_tags pt
     where tag_ids is not null and pt.tag_id = any(tag_ids)
     group by pt.playlist_id
    having count(distinct pt.tag_id) = cardinality(tag_ids)
  )
  select t.id, count(*) over () as total
    from tracks t
   where (q is null or t.title ilike '%' || q || '%' or t.artist ilike '%' || q || '%' or t.album ilike '%' || q || '%')
     and (not only_videos or t.video_id is not null)
     and (not both_services or (select count(distinct s.service) from track_sources s where s.track_id = t.id) > 1)
     and (main_artist is null or lower(trim((regexp_split_to_array(t.artist, '\s*(,|&|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*', 'i'))[1])) = lower(main_artist))
     and (tag_ids is null or cardinality(tag_ids) = 0 or exists (
           select 1 from playlist_items pi join tagged g on g.playlist_id = pi.playlist_id where pi.track_id = t.id))
   order by
     case when seed is not null then md5(t.id::text || seed) end,
     case when sort_by = 'recent' then t.created_at end desc,
     case when sort_by = 'video' then t.video_id is null end,
     case when sort_by = 'title' then lower(t.title) end,
     lower(t.artist), lower(t.title), t.id
   offset off_n limit lim_n;
$$;
revoke execute on function library_page(text, boolean, boolean, text, text, text, integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function library_page(text, boolean, boolean, text, text, text, integer, integer, uuid[]) to service_role;

-- Skips (2026-11-05): songs you pressed Next on early (not songs you tapped
-- to peek at). Artists you keep skipping show up less in radios and Discover.
create table if not exists skips (
  id bigserial primary key,
  at timestamptz not null default now(),
  track_id text,
  artist_key text not null,
  artist text,
  title text,
  played_ms integer,
  duration_ms integer
);
create index if not exists skips_artist_at on skips (artist_key, at desc);
alter table skips enable row level security;

-- Saved albums (2026-11-09): the star on a YouTube Music album page; listed
-- under the "Albums" chip on Home / Library playlists.
create table if not exists saved_albums (
  browse_id text primary key,
  title text not null,
  artist text,
  subtitle text,
  image_url text,
  song_count int,
  saved_at timestamptz not null default now()
);
create index if not exists saved_albums_saved_at on saved_albums (saved_at desc);
alter table saved_albums enable row level security;

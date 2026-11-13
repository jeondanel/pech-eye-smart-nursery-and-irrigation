-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table batches (
  id bigint generated always as identity primary key,
  name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'growing',        -- growing | transplanted
  notes text,
  summary jsonb                                  -- filled at transplantation
);
-- Only one batch may be 'growing' at a time
create unique index one_growing_batch on batches (status) where status = 'growing';

create table readings (
  id bigint generated always as identity primary key,
  batch_id bigint not null references batches(id),
  ts timestamptz not null default now(),
  soil_moisture real,      -- %
  humidity real,           -- %
  temperature real,        -- C
  distance_cm real,        -- raw ultrasonic distance
  height_cm real,          -- derived plant height
  reservoir_low boolean    -- float switch: true = mist reservoir needs refill
);
-- Already created the table earlier? Run just this line instead:
--   alter table readings add column if not exists reservoir_low boolean;
create index on readings (batch_id, ts);

create table images (
  id bigint generated always as identity primary key,
  batch_id bigint not null references batches(id),
  ts timestamptz not null default now(),
  file text not null,      -- path inside the 'tray-images' storage bucket
  analysis jsonb,
  ready_cells int,
  occupied_cells int,
  total_cells int,
  canopy_pct real,
  ready boolean
);
create index on images (batch_id, ts);

-- OpenWeather snapshots (outdoor conditions), logged every ~30 min while the system is active
create table weather (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  temp real, feels_like real, humidity real, pressure real,
  wind_speed real, clouds real, rain_1h real,
  rain_chance_24h real,    -- max probability of rain (%) in the next 24 h
  description text
);
create index on weather (ts);

-- Lock the tables: only the server (service-role key) can read/write. No public access.
alter table batches  enable row level security;
alter table readings enable row level security;
alter table images   enable row level security;
alter table weather  enable row level security;

create or replace function batch_stats(p_batch bigint) returns json
language sql stable as $$
  select json_build_object(
    'n', count(*),
    'avg_humidity', avg(humidity), 'min_humidity', min(humidity), 'max_humidity', max(humidity),
    'avg_soil', avg(soil_moisture), 'min_soil', min(soil_moisture), 'max_soil', max(soil_moisture),
    'avg_temp', avg(temperature), 'avg_height', avg(height_cm), 'max_height', max(height_cm))
  from readings where batch_id = p_batch;
$$;

create or replace function weather_stats(p_from timestamptz, p_to timestamptz) returns json
language sql stable as $$
  select json_build_object(
    'n', count(*), 'avg_temp', avg(temp), 'avg_humidity', avg(humidity),
    'avg_rain_chance', avg(rain_chance_24h), 'max_rain_1h', max(rain_1h))
  from weather where ts between p_from and p_to;
$$;

-- ---------- Remote "take a photo now" (dashboard -> camera) ----------
-- Already ran this file before? Run just this section in a new query.
create table if not exists capture_requests (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,                      -- set when the next photo arrives
  image_id bigint references images(id) on delete set null
);
create table if not exists camera_status (
  id int primary key default 1 check (id = 1),   -- single row
  last_seen timestamptz,                         -- last check-in or upload from the camera
  check_seconds int                              -- how often the camera checks in
);
alter table capture_requests enable row level security;
alter table camera_status    enable row level security;

-- Then: Storage -> New bucket -> name: tray-images -> tick "Public bucket" -> Create.

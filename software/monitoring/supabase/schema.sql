-- PECH-EYE database (Supabase / Postgres).
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- WARNING: drops and recreates every table, so ALL existing data is deleted.
-- Then: Storage -> New bucket -> name: tray-images -> tick "Public bucket" -> Create
-- (or, if it exists, empty it: Storage -> tray-images -> select all -> Delete).

drop table if exists capture_requests, camera_status, images, readings,
  actuator_runs, alerts, weather, batches cascade;
drop function if exists batch_stats(bigint);
drop function if exists weather_stats(timestamptz, timestamptz);
drop function if exists camera_poll(int);

-- One growing cycle of a seedling tray, from sowing to transplanting.
create table batches (
  id bigint generated always as identity primary key,
  name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'growing' check (status in ('growing', 'transplanted', 'stopped')),  -- stopped = ended early
  notes text,
  summary jsonb                                  -- filled when the batch ends
);
create unique index one_growing_batch on batches (status) where status = 'growing';

-- Controller snapshot, every 5 min and whenever the float switch changes.
-- Only recorded while a batch is being monitored (the server drops readings between batches).
create table readings (
  id bigint generated always as identity primary key,
  batch_id bigint references batches(id),
  ts timestamptz not null default now(),
  temperature real,        -- C   (DHT11)
  humidity real,           -- %   (DHT11)
  soil_raw int,            -- capacitive sensor ADC 0..4095 (higher = drier)
  soil_moisture real,      -- %   calibrated from soil_raw
  reservoir_low boolean,   -- float switch: true = mist reservoir needs refill
  mist_on boolean,         -- relay states at the time of the reading
  light_on boolean,
  pump_on boolean
);
create index on readings (batch_id, ts);
create index on readings (ts);

-- One row per relay ON period (logged when it switches OFF).
create table actuator_runs (
  id bigint generated always as identity primary key,
  batch_id bigint references batches(id),
  device text not null check (device in ('mist', 'light', 'pump')),
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  duration_s real not null,
  source text,             -- who switched it on: telegram | auto | dashboard
  stopped_by text,         -- timer | safety | telegram
  water_ml real            -- estimated from duration x flow rate (MIST_ML_PER_MIN / PUMP_ML_PER_MIN)
);
create index on actuator_runs (device, started_at);

-- Notifications from the controller and the server (most are also sent to Telegram).
create table alerts (
  id bigint generated always as identity primary key,
  batch_id bigint references batches(id),
  ts timestamptz not null default now(),
  kind text not null,      -- online | reservoir_low | reservoir_ok | safety_stop | tray_ready | transplanted
  message text,
  source text not null default 'controller',  -- controller | server
  sent_telegram boolean not null default false
);
create index on alerts (ts);

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
  ready boolean,
  source text              -- scheduled (every 12 h from batch start) | manual (dashboard "Take photo")
);
create index on images (batch_id, ts);

-- OpenWeather snapshots (outdoor conditions), at most one every 30 min.
create table weather (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  temp real, feels_like real, humidity real, pressure real,
  wind_speed real, clouds real, rain_1h real,
  rain_chance_24h real,    -- max probability of rain (%) in the next 24 h
  description text
);
create index on weather (ts);

-- Dashboard "Take photo" -> camera picks it up on its next check-in.
create table capture_requests (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  image_id bigint references images(id) on delete set null
);
create table camera_status (
  id int primary key default 1 check (id = 1),   -- single row
  last_seen timestamptz,
  check_seconds int
);

-- Only the server (service-role key) can read/write. No public access.
alter table batches          enable row level security;
alter table readings         enable row level security;
alter table actuator_runs    enable row level security;
alter table alerts           enable row level security;
alter table images           enable row level security;
alter table weather          enable row level security;
alter table capture_requests enable row level security;
alter table camera_status    enable row level security;

create or replace function batch_stats(p_batch bigint) returns json
language sql stable as $$
  select json_build_object(
    'n', count(*),
    'avg_temp', avg(temperature), 'min_temp', min(temperature), 'max_temp', max(temperature),
    'avg_humidity', avg(humidity), 'min_humidity', min(humidity), 'max_humidity', max(humidity),
    'avg_soil', avg(soil_moisture), 'min_soil', min(soil_moisture), 'max_soil', max(soil_moisture),
    'mist_runs', (select count(*) from actuator_runs where batch_id = p_batch and device = 'mist'),
    'water_ml', (select coalesce(sum(water_ml), 0) from actuator_runs where batch_id = p_batch))
  from readings where batch_id = p_batch;
$$;

create or replace function weather_stats(p_from timestamptz, p_to timestamptz) returns json
language sql stable as $$
  select json_build_object(
    'n', count(*), 'avg_temp', avg(temp), 'avg_humidity', avg(humidity),
    'avg_rain_chance', avg(rain_chance_24h), 'max_rain_1h', max(rain_1h))
  from weather where ts between p_from and p_to;
$$;

-- The camera calls this every few seconds (Supabase REST, publishable/anon key) and gets back
-- 'scheduled', 'manual' or null. It also marks the camera online for the dashboard.
--   scheduled: every 12 h counted from "Start monitoring" (none in the first 12 h);
--              manual photos don't move this schedule.
--   manual:    a "Take photo" request made during the current batch is waiting.
-- Nothing is due while no batch is being monitored.
create or replace function camera_poll(p_every int default null) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  b batches;
  slot_start timestamptz;
begin
  insert into camera_status (id, last_seen, check_seconds) values (1, now(), p_every)
  on conflict (id) do update
    set last_seen = excluded.last_seen,
        check_seconds = coalesce(excluded.check_seconds, camera_status.check_seconds)
    where camera_status.last_seen is null or camera_status.last_seen < now() - interval '30 seconds';

  select * into b from batches where status = 'growing' limit 1;
  if not found then return null; end if;

  slot_start := b.started_at + floor(extract(epoch from now() - b.started_at) / 43200) * interval '12 hours';
  if slot_start > b.started_at and not exists (
       select 1 from images where batch_id = b.id and source = 'scheduled' and ts >= slot_start) then
    return 'scheduled';
  end if;

  if exists (select 1 from capture_requests where fulfilled_at is null and requested_at >= b.started_at) then
    return 'manual';
  end if;
  return null;
end $fn$;
revoke all on function camera_poll(int) from public;
grant execute on function camera_poll(int) to anon;

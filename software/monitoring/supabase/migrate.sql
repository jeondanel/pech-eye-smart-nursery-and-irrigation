-- Upgrade an existing PECH-EYE database to the controller + Telegram schema.
-- Safe to run more than once. SQL Editor -> New query -> paste -> Run.

alter table readings add column if not exists soil_raw int;
alter table readings add column if not exists mist_on boolean;
alter table readings add column if not exists light_on boolean;
alter table readings add column if not exists pump_on boolean;
alter table readings add column if not exists reservoir_low boolean;
create index if not exists readings_ts_idx on readings (ts);

-- The ultrasonic sensor is no longer used. Uncomment to remove its columns (deletes that data).
-- alter table readings drop column if exists distance_cm;
-- alter table readings drop column if exists height_cm;

create table if not exists actuator_runs (
  id bigint generated always as identity primary key,
  batch_id bigint references batches(id),
  device text not null check (device in ('mist', 'light', 'pump')),
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  duration_s real not null,
  source text,
  stopped_by text,
  water_ml real
);
create index if not exists actuator_runs_device_started_at_idx on actuator_runs (device, started_at);

create table if not exists alerts (
  id bigint generated always as identity primary key,
  batch_id bigint references batches(id),
  ts timestamptz not null default now(),
  kind text not null,
  message text,
  source text not null default 'controller',
  sent_telegram boolean not null default false
);
create index if not exists alerts_ts_idx on alerts (ts);

create table if not exists capture_requests (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  image_id bigint references images(id) on delete set null
);
create table if not exists camera_status (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  check_seconds int
);

alter table actuator_runs    enable row level security;
alter table alerts           enable row level security;
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

-- Batches start only when someone presses "Start monitoring"; readings before that have no batch.
alter table readings alter column batch_id drop not null;

-- A batch can now be stopped early (plants died / not continued).
alter table batches drop constraint if exists batches_status_check;
alter table batches add constraint batches_status_check check (status in ('growing', 'transplanted', 'stopped'));

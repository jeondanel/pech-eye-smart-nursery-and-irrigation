-- Deletes ALL recorded data (batches, readings, photos list, runs, alerts, weather) and restarts
-- numbering, so the next "Start monitoring" creates Batch 1. Cannot be undone.
-- Run migrate.sql first. Then: SQL Editor -> New query -> paste -> Run.
-- The photo files themselves stay in Storage: Storage -> tray-images -> select all -> Delete.

truncate table capture_requests, images, readings, actuator_runs, alerts, weather, batches restart identity cascade;
update camera_status set last_seen = null where id = 1;

-- Update the process-emails cron job to run every 1 minute instead of every 5 minutes.
-- This ensures scheduled emails are sent within ~1 minute of their scheduled_for time.
--
-- Prerequisites: pg_cron and pg_net extensions must be enabled (via Supabase Dashboard > Extensions).
--
-- If you set up the cron via the Supabase Dashboard UI, simply change the schedule
-- from "*/5 * * * *" to "* * * * *" there instead of running this migration.

-- Remove existing 5-minute schedule (adjust the job name if yours differs)
SELECT cron.unschedule('process-emails');

-- Re-create with 1-minute interval
SELECT cron.schedule(
  'process-emails',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

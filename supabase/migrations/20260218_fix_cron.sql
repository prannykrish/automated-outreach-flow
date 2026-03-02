-- Fix the scheduled email cron job.
--
-- The previous migration used current_setting('app.settings.supabase_url') which
-- may not be configured, causing the cron job to silently fail.
--
-- INSTRUCTIONS:
-- 1. Enable pg_cron and pg_net extensions in Supabase Dashboard > Database > Extensions
-- 2. Replace YOUR_PROJECT_REF with your actual Supabase project reference (e.g. abcdefghijklmnop)
-- 3. Replace YOUR_SERVICE_ROLE_KEY with your actual service role key from Dashboard > Settings > API
-- 4. Run this SQL in Supabase Dashboard > SQL Editor

-- Remove any existing schedule
SELECT cron.unschedule('process-emails');

-- Create new schedule that runs every minute
SELECT cron.schedule(
  'process-emails',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hauanxozzinpehaimfyy.supabase.co/functions/v1/process-emails',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhdWFueG96emlucGVoYWltZnl5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxMzk1OCwiZXhwIjoyMDg0ODg5OTU4fQ.beeFCHVSxUSBB-06KKdPjgPYJUxYHFOPJPxzz5RsBJ4", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

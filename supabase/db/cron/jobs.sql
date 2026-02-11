-- pg_cron job definitions
-- Uses upsert-like pattern: unschedule by name if exists, then schedule

-- Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- Job: med-event-generation-hourly
-- Generate med_dose_events for all users with active regimens
-- Runs every hour at :00
-- ============================================================================
SELECT cron.unschedule('med-event-generation-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'med-event-generation-hourly');

SELECT cron.schedule(
  'med-event-generation-hourly',
  '0 * * * *',
  $$SELECT * FROM public.run_med_event_generation_for_all_users(28)$$
);

-- ============================================================================
-- Job: notifications
-- Call notifications-cron Edge Function via pg_net
-- Runs every minute
-- ============================================================================
SELECT cron.unschedule('notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications');

SELECT cron.schedule(
  'notifications',
  '* * * * *',
  $$SELECT public.run_notifications_cron_http()$$
);

-- Phase 4: Cron Jobs
-- No transaction wrapper (pg_cron can be finicky inside transactions)

\i cron/jobs.sql

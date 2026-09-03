-- Master Deploy Script
-- Orchestrates phased deployment of database code
--
-- Usage: psql $DATABASE_URL -v GIT_SHA=$(git rev-parse HEAD) -f supabase/db/deploy.sql
--
-- This file is the single-shot form, kept for a manual run. CI and the local `db-run` recipe go
-- through supabase/db/run-deploy.js, which applies the same phases in the same order as separate
-- psql invocations so that a phase which loses a lock to live traffic can be retried on its own.
-- A test asserts the two orders stay identical.
--
-- Phases:
--   1. Types + Functions (single transaction)
--   2. Triggers (single transaction)
--   3. Policies (one transaction per policy file, so a lock is held for one file, not sixty)
--   4. Cron Jobs (no transaction - pg_cron is finicky)
--   5. Version stamp

-- Lock behaviour for the whole deploy session. A deploy that cannot get a lock gives it up itself,
-- quickly and with a named error, instead of waiting long enough for the deadlock detector to pick
-- a victim at an arbitrary point -- which on 2026-09-01 and 2026-09-02 was repeatedly the deploy,
-- halfway through the policy phase (T-260902-60d).
--
-- 750ms is deliberately below deadlock_timeout's 1000ms default. Raising deadlock_timeout instead
-- would read better and does not work: it is a superuser-only parameter and the deploy connects as
-- `postgres`, which is not a superuser on Supabase, so the SET fails and ON_ERROR_STOP takes the
-- phase with it. The counterpart session may still detect the deadlock first on its own timer;
-- either way the wait is bounded and the loss is one file wide.
SET lock_timeout = '750ms';

\echo '=========================================='
\echo 'Supabase DB Code Deploy'
\echo '=========================================='
\echo ''

\echo 'Phase 1: Types + Functions'
\echo '--------------------------'
\i 01_types_functions.sql
\echo ''

\echo 'Phase 2: Triggers'
\echo '-----------------'
\i 02_triggers.sql
\echo ''

\echo 'Phase 3: Policies'
\echo '-----------------'
\i 03_policies.sql
\echo ''

\echo 'Phase 4: Cron Jobs'
\echo '------------------'
\i 04_cron.sql
\echo ''

\echo 'Recording deploy version'
\echo '------------------------'
\i _version.sql
\echo ''

\echo '=========================================='
\echo 'Deploy complete!'
\echo '=========================================='

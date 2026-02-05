-- Master Deploy Script
-- Orchestrates phased deployment of database code
--
-- Usage: psql $DATABASE_URL -v GIT_SHA=$(git rev-parse HEAD) -f supabase/db/deploy.sql
--
-- Phases:
--   1. Types + Functions (single transaction)
--   2. Triggers (single transaction)
--   3. Policies (single transaction)
--   4. Cron Jobs (no transaction - pg_cron is finicky)
--   5. Version stamp

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

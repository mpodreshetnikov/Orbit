-- Phase 3: Policies
--
-- One transaction per file, not one for the whole phase.
--
-- Every policy file is DROP POLICY IF EXISTS plus CREATE POLICY, so it takes an
-- AccessExclusiveLock on its table. Wrapping the whole phase in a single transaction held every
-- one of those locks until the final COMMIT: persons is the second file in, so its lock was held
-- across the remaining 40-odd files. Live traffic that had already read notification_routing and
-- then wanted persons -- get_routed_persons_for_recipient(), reached every minute by the
-- notifications cron job -- closed the cycle, and Postgres killed the deploy (T-260902-60d).
--
-- Per file, the lock is held for the length of one file instead, and a failure rolls back one
-- file rather than the phase. The files stay individually atomic, so no table is ever briefly
-- left with its policies dropped and not yet recreated.
--
-- run-deploy.js applies this phase with a lock_timeout, and retries it when it loses a lock:
-- losing to production traffic is the expected outcome here, not an exceptional one.

-- ============================================================================
-- Core tables
-- ============================================================================
BEGIN;
\i policies/allowed_users.sql
COMMIT;

BEGIN;
\i policies/persons.sql
COMMIT;

BEGIN;
\i policies/medical_records.sql
COMMIT;

BEGIN;
\i policies/record_attachments.sql
COMMIT;

-- ============================================================================
-- Storage
-- ============================================================================
BEGIN;
\i policies/storage.sql
COMMIT;

-- ============================================================================
-- Observation catalog
-- ============================================================================
BEGIN;
\i policies/observation_catalog.sql
COMMIT;

BEGIN;
\i policies/record_observations.sql
COMMIT;

-- ============================================================================
-- Measurement catalog
-- ============================================================================
BEGIN;
\i policies/measurement_catalog.sql
COMMIT;

BEGIN;
\i policies/measurements.sql
COMMIT;

-- ============================================================================
-- Finding catalogs
-- ============================================================================
BEGIN;
\i policies/finding_type_catalog.sql
COMMIT;

BEGIN;
\i policies/body_site_catalog.sql
COMMIT;

BEGIN;
\i policies/record_findings.sql
COMMIT;

BEGIN;
\i policies/record_extraction_issues.sql
COMMIT;

-- ============================================================================
-- Conditions
-- ============================================================================
BEGIN;
\i policies/conditions.sql
COMMIT;

BEGIN;
\i policies/condition_records.sql
COMMIT;

-- ============================================================================
-- Money
-- ============================================================================
BEGIN;
\i policies/money_accounts.sql
COMMIT;

BEGIN;
\i policies/money_cards.sql
COMMIT;

BEGIN;
\i policies/money_categories.sql
COMMIT;

BEGIN;
\i policies/money_transaction_brands.sql
COMMIT;

BEGIN;
\i policies/money_transaction_brand_aliases.sql
COMMIT;

BEGIN;
\i policies/money_transactions.sql
COMMIT;

BEGIN;
\i policies/money_line_items.sql
COMMIT;

BEGIN;
\i policies/money_transaction_edit_audits.sql
COMMIT;

BEGIN;
\i policies/money_category_rules.sql
COMMIT;

BEGIN;
\i policies/money_category_rule_runs.sql
COMMIT;

BEGIN;
\i policies/money_category_rule_run_steps.sql
COMMIT;

BEGIN;
\i policies/money_mcc_canonical_category_map.sql
COMMIT;

BEGIN;
\i policies/money_import_batches.sql
COMMIT;

BEGIN;
\i policies/money_import_sessions.sql
COMMIT;

BEGIN;
\i policies/money_import_grants.sql
COMMIT;

BEGIN;
\i policies/money_import_batch_rows.sql
COMMIT;

BEGIN;
\i policies/money_import_batch_brand_resolutions.sql
COMMIT;

BEGIN;
\i policies/money_budget_targets.sql
COMMIT;

BEGIN;
\i policies/money_transfer_self_aliases.sql
COMMIT;

BEGIN;
\i policies/money_fx_rates.sql
COMMIT;

-- ============================================================================
-- Checkups
-- ============================================================================
BEGIN;
\i policies/checkup_items.sql
COMMIT;

BEGIN;
\i policies/checkup_completions.sql
COMMIT;

-- ============================================================================
-- User settings
-- ============================================================================
BEGIN;
\i policies/user_preferences.sql
COMMIT;

BEGIN;
\i policies/push_subscriptions.sql
COMMIT;

BEGIN;
\i policies/notification_digests.sql
COMMIT;

-- ============================================================================
-- Medications
-- ============================================================================
BEGIN;
\i policies/med_regimens.sql
COMMIT;

BEGIN;
\i policies/med_dose_events.sql
COMMIT;

BEGIN;
\i policies/med_inventory_transactions.sql
COMMIT;

-- ============================================================================
-- Notifications
-- ============================================================================
BEGIN;
\i policies/notification_routing.sql
COMMIT;

-- ============================================================================
-- MCP connector (OAuth authorization server storage)
-- ============================================================================
BEGIN;
\i policies/mcp_oauth.sql
COMMIT;


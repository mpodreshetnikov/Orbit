-- Phase 3: Policies
-- Run inside a transaction for atomic deployment

BEGIN;

-- ============================================================================
-- Core tables
-- ============================================================================
\i policies/allowed_users.sql
\i policies/persons.sql
\i policies/medical_records.sql
\i policies/record_attachments.sql

-- ============================================================================
-- Storage
-- ============================================================================
\i policies/storage.sql

-- ============================================================================
-- Observation catalog
-- ============================================================================
\i policies/observation_catalog.sql
\i policies/record_observations.sql

-- ============================================================================
-- Measurement catalog
-- ============================================================================
\i policies/measurement_catalog.sql
\i policies/measurements.sql

-- ============================================================================
-- Finding catalogs
-- ============================================================================
\i policies/finding_type_catalog.sql
\i policies/body_site_catalog.sql
\i policies/record_findings.sql

-- ============================================================================
-- Conditions
-- ============================================================================
\i policies/conditions.sql
\i policies/condition_records.sql

-- ============================================================================
-- Money
-- ============================================================================
\i policies/money_accounts.sql
\i policies/money_cards.sql
\i policies/money_categories.sql
\i policies/money_transactions.sql
\i policies/money_line_items.sql
\i policies/money_import_batches.sql

-- ============================================================================
-- Checkups
-- ============================================================================
\i policies/checkup_items.sql
\i policies/checkup_completions.sql

-- ============================================================================
-- User settings
-- ============================================================================
\i policies/user_preferences.sql
\i policies/push_subscriptions.sql
\i policies/notification_digests.sql

-- ============================================================================
-- Medications
-- ============================================================================
\i policies/med_regimens.sql
\i policies/med_dose_events.sql
\i policies/med_inventory_transactions.sql

-- ============================================================================
-- Notifications
-- ============================================================================
\i policies/notification_routing.sql

COMMIT;

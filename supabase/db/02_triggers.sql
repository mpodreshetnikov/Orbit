-- Phase 2: Triggers
-- Run inside a transaction for atomic deployment

BEGIN;

-- ============================================================================
-- Auth triggers
-- ============================================================================
\i triggers/on_auth_user_created.sql

-- ============================================================================
-- Updated_at triggers
-- ============================================================================
\i triggers/update_persons_updated_at.sql
\i triggers/update_medical_records_updated_at.sql
\i triggers/update_observation_catalog_updated_at.sql
\i triggers/update_record_observations_updated_at.sql
\i triggers/update_measurement_catalog_updated_at.sql
\i triggers/update_measurements_updated_at.sql
\i triggers/update_finding_type_catalog_updated_at.sql
\i triggers/update_body_site_catalog_updated_at.sql
\i triggers/update_record_findings_updated_at.sql
\i triggers/update_conditions_updated_at.sql
\i triggers/update_checkup_items_updated_at.sql
\i triggers/update_user_preferences_updated_at.sql
\i triggers/update_med_regimens_updated_at.sql
\i triggers/update_med_dose_events_updated_at.sql
\i triggers/update_notification_routing_updated_at.sql
\i triggers/update_money_accounts_updated_at.sql
\i triggers/update_money_cards_updated_at.sql
\i triggers/update_money_categories_updated_at.sql
\i triggers/update_money_transactions_updated_at.sql
\i triggers/update_money_line_items_updated_at.sql

-- ============================================================================
-- Checkup triggers
-- ============================================================================
\i triggers/checkup_item_set_next_due_insert.sql
\i triggers/checkup_completion_after_insert_trigger.sql
\i triggers/checkup_completion_after_update_trigger.sql
\i triggers/checkup_completion_after_delete_trigger.sql
\i triggers/checkup_item_after_update_trigger.sql

COMMIT;

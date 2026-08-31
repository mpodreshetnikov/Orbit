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
\i triggers/update_medication_refill_snoozes_updated_at.sql
\i triggers/update_med_dose_events_updated_at.sql
\i triggers/update_notification_routing_updated_at.sql
\i triggers/update_money_accounts_updated_at.sql
\i triggers/update_money_cards_updated_at.sql
\i triggers/enforce_money_categories_invariants.sql
\i triggers/prevent_money_categories_delete.sql
\i triggers/update_money_categories_updated_at.sql
\i triggers/update_money_transaction_brands_updated_at.sql
\i triggers/update_money_transaction_brand_aliases_updated_at.sql
\i triggers/update_money_import_batch_brand_resolutions_updated_at.sql
\i triggers/update_money_import_grants_updated_at.sql
\i triggers/update_money_transactions_updated_at.sql
\i triggers/update_money_line_items_updated_at.sql
\i triggers/update_money_budget_targets_updated_at.sql
\i triggers/enforce_money_budget_targets_invariants.sql
\i triggers/update_money_transfer_self_aliases_updated_at.sql
\i triggers/set_money_transfer_self_aliases_normalized_alias.sql
\i triggers/update_money_fx_rates_updated_at.sql
\i triggers/audit_money_transactions_edits.sql
\i triggers/audit_money_line_items_edits.sql
\i triggers/update_money_category_rules_updated_at.sql

-- ============================================================================
-- Checkup triggers
-- ============================================================================
\i triggers/checkup_item_set_next_due_insert.sql
\i triggers/checkup_completion_after_insert_trigger.sql
\i triggers/checkup_completion_after_update_trigger.sql
\i triggers/checkup_completion_after_delete_trigger.sql
\i triggers/checkup_item_after_update_trigger.sql

COMMIT;

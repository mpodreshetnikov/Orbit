-- Phase 1: Types and Functions
-- Run inside a transaction for atomicity

BEGIN;

\echo '=== Phase 1: Types ==='

-- Custom ENUMs
\i types/record_type.sql
\i types/record_status.sql
\i types/checkup_category.sql
\i types/checkup_item_status.sql
\i types/medication_status.sql
\i types/medication_unit.sql
\i types/med_dose_event_status.sql
\i types/med_inventory_transaction_type.sql
\i types/med_intake_advice_type.sql
\i types/money_category_kind.sql
\i types/money_rule_kind.sql
\i types/money_transaction_type.sql
\i types/money_transaction_status.sql
\i types/money_line_status.sql
\i types/money_assignment_method.sql

\echo '=== Phase 1: Functions ==='

-- Helper functions (must come first as others depend on them)
\i functions/_is_allowed_user.sql
\i functions/_is_owner_of_person.sql
\i functions/update_updated_at_column.sql
\i functions/link_allowed_user.sql

-- Medical records functions
\i functions/search_medical_records.sql

-- Observation catalog functions
\i functions/find_observation_by_synonym.sql
\i functions/convert_to_canonical_unit.sql
\i functions/get_record_observations.sql

-- Finding catalog functions
\i functions/find_finding_type_by_text.sql
\i functions/find_body_site_by_text.sql
\i functions/get_record_findings.sql

-- Conditions functions
\i functions/get_record_conditions.sql
\i functions/claim_medical_record.sql
\i functions/get_person_conditions_with_history.sql

-- Notification routing functions
\i functions/get_routed_persons_for_recipient.sql

-- Checkup scheduling functions
\i functions/checkup_compute_next_due.sql
\i functions/checkup_item_set_next_due_on_insert.sql
\i functions/checkup_completion_after_insert.sql
\i functions/checkup_recompute_next_due_for_item.sql
\i functions/checkup_completion_after_update.sql
\i functions/checkup_completion_after_delete.sql
\i functions/checkup_item_after_update.sql
\i functions/get_checkups_for_condition.sql

-- Checkup notification functions
\i functions/get_checkup_notification_payload_for_person.sql

-- Medication dose event generation functions
\i functions/generate_med_dose_events_for_person_ids.sql
\i functions/generate_med_dose_events_for_horizon.sql
\i functions/generate_med_dose_events_for_horizon_for_person.sql
\i functions/clear_future_med_dose_events.sql
\i functions/clear_future_med_dose_events_for_person.sql

-- Medication notification functions
\i functions/get_medication_dose_reminder_payload_for_person.sql
\i functions/create_medication_reminder_digests.sql
\i functions/create_medication_refill_digests.sql
\i functions/get_medication_refill_snooze.sql
\i functions/set_medication_refill_snooze.sql

-- Medication action functions
\i functions/mark_dose_taken.sql
\i functions/mark_dose_skipped.sql
\i functions/snooze_dose.sql
\i functions/undo_dose_intake.sql
\i functions/update_dose_event_resolution_details.sql
\i functions/update_regimen_inventory.sql

-- Money functions
\i functions/money_seed_canonical_categories.sql
\i functions/money_seed_category_rule_mappings.sql
\i functions/money_categories_enforce_invariants.sql
\i functions/money_categories_prevent_delete.sql
\i functions/money_get_category_rule_context.sql
\i functions/money_evaluate_category_rule_filter.sql
\i functions/money_run_category_rule_pipeline_internal.sql
\i functions/money_preview_category_rule_pipeline.sql
\i functions/money_apply_category_rule_pipeline.sql
\i functions/money_apply_category_rule_pipeline_for_transaction.sql
\i functions/money_apply_category_rule_pipeline_for_date_range.sql
\i functions/money_get_category_rule_debug.sql
\i functions/get_money_merchant_default_categories.sql
\i functions/money_list_transactions_feed.sql
\i functions/money_transaction_feed_summary.sql
\i functions/money_write_transaction_edit_audit.sql
\i functions/money_upsert_transactions_batch.sql
\i functions/money_reassign_card_account.sql
\i functions/money_normalize_transfer_text.sql
\i functions/money_person_self_transfer_variants.sql
\i functions/money_transfer_self_aliases_set_normalized_alias.sql
\i functions/money_budget_targets_enforce_invariants.sql
\i functions/money_resolve_fx_rate.sql
\i functions/money_get_budget_report.sql

-- Cron entry point functions
\i functions/run_med_event_generation_for_all_users.sql
\i functions/run_money_fx_sync_http.sql
\i functions/run_notifications_cron_http.sql

\echo '=== Phase 1 Complete: 9 types, 41 functions ==='

COMMIT;

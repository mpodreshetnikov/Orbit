-- Function: money_run_category_rule_pipeline_internal(...)
-- Internal deterministic money category rule engine with debug step output.

CREATE OR REPLACE FUNCTION public.money_run_category_rule_pipeline_internal(
  p_line_item_id uuid,
  p_person_id uuid DEFAULT NULL,
  p_rule_ids uuid[] DEFAULT NULL,
  p_save boolean DEFAULT false,
  p_force_overwrite_locked boolean DEFAULT false,
  p_trigger_source text DEFAULT 'manual_replay'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_context jsonb;
  v_line_item jsonb;
  v_transaction jsonb;
  v_starting_category_id uuid;
  v_current_category_id uuid;
  v_current_category_kind public.money_category_kind;
  v_current_canonical_category_id uuid;
  v_current_canonical_system_key text;
  v_person_id uuid;
  v_transaction_id uuid;
  v_locked boolean;
  v_run_id uuid;
  v_steps jsonb := '[]'::jsonb;
  v_step_id uuid;
  v_rule record;
  v_filter jsonb;
  v_filters jsonb;
  v_filter_result boolean;
  v_scope_passes boolean;
  v_rule_matched boolean;
  v_changed boolean;
  v_reason text;
  v_previous_category_id uuid;
  v_next_category_id uuid;
  v_target_category_id uuid;
  v_saved boolean := false;
  v_step_debug jsonb;
  v_last_changed_rule_id uuid := NULL;
  v_last_assignment_method public.money_assignment_method := NULL;
  v_changed_count int;
  v_total_filters int;
BEGIN
  v_context := public.money_get_category_rule_context(p_line_item_id, p_person_id);
  IF v_context IS NULL THEN
    RAISE EXCEPTION 'Line item % was not found for category pipeline', p_line_item_id;
  END IF;

  v_line_item := v_context->'line_item';
  v_transaction := v_context->'transaction';
  v_transaction_id := (v_transaction->>'id')::uuid;
  v_person_id := COALESCE(p_person_id, (v_transaction->>'payer_person_id')::uuid);
  v_starting_category_id := NULLIF(v_line_item->>'category_id', '')::uuid;
  v_current_category_id := v_starting_category_id;
  v_current_category_kind := NULLIF(v_context #>> '{current_category,kind}', '')::public.money_category_kind;
  v_current_canonical_category_id := NULLIF(v_context #>> '{current_category,canonical_category_id}', '')::uuid;
  v_current_canonical_system_key := NULLIF(v_context #>> '{current_category,canonical_system_key}', '');
  v_locked := COALESCE((v_line_item->>'category_locked_by_user')::boolean, false);

  IF p_save THEN
    INSERT INTO public.money_category_rule_runs (
      person_id,
      triggered_by_user_id,
      trigger_source,
      line_item_id,
      transaction_id,
      starting_category_id,
      final_category_id,
      saved
    )
    VALUES (
      v_person_id,
      auth.uid(),
      p_trigger_source,
      p_line_item_id,
      v_transaction_id,
      v_starting_category_id,
      v_starting_category_id,
      false
    )
    RETURNING id INTO v_run_id;
  END IF;

  IF v_locked AND NOT p_force_overwrite_locked THEN
    IF p_save THEN
      UPDATE public.money_category_rule_runs
      SET final_category_id = v_current_category_id
      WHERE id = v_run_id;
    END IF;

    RETURN jsonb_build_object(
      'run_id', v_run_id,
      'line_item_id', p_line_item_id,
      'line_item_title', NULLIF(v_line_item->>'title', ''),
      'transaction_id', v_transaction_id,
      'merchant_name', NULLIF(v_transaction->>'merchant_name', ''),
      'person_id', v_person_id,
      'trigger_source', p_trigger_source,
      'starting_category_id', v_starting_category_id,
      'final_category_id', v_current_category_id,
      'saved', false,
      'decision_reason', 'Line item is locked by a manual category assignment',
      'steps', v_steps
    );
  END IF;

  FOR v_rule IN
    SELECT *
    FROM public.money_category_rules
    WHERE person_id = v_person_id
      AND enabled = true
      AND (p_rule_ids IS NULL OR id = ANY (p_rule_ids))
    ORDER BY sort_order ASC, created_at ASC, id ASC
  LOOP
    v_rule_matched := false;
    v_changed := false;
    v_reason := 'Rule skipped';
    v_previous_category_id := v_current_category_id;
    v_next_category_id := v_current_category_id;
    v_target_category_id := NULL;

    v_scope_passes := CASE v_rule.scope_filter
      WHEN 'all_line_items' THEN true
      WHEN 'uncategorized_only' THEN v_current_category_id IS NULL
      WHEN 'custom_only' THEN v_current_category_kind = 'custom'
      WHEN 'canonical_only' THEN v_current_category_kind = 'canonical'
      WHEN 'manual_unlocked_only' THEN NOT v_locked
      ELSE true
    END;

    IF NOT v_scope_passes THEN
      v_reason := format('Scope filter %s skipped the line item', v_rule.scope_filter);
    ELSE
      v_filters := COALESCE(v_rule.filters, '[]'::jsonb);
      v_changed_count := 0;
      v_total_filters := COALESCE(jsonb_array_length(v_filters), 0);

      FOR v_filter IN SELECT value FROM jsonb_array_elements(v_filters) LOOP
        v_filter_result := public.money_evaluate_category_rule_filter(
          v_context,
          v_current_category_id,
          v_current_canonical_system_key,
          v_filter
        );

        IF v_filter_result THEN
          v_changed_count := v_changed_count + 1;
        END IF;

        IF v_rule.match_mode = 'any' AND v_filter_result THEN
          v_rule_matched := true;
        ELSIF v_rule.match_mode = 'all' AND NOT v_filter_result THEN
          v_rule_matched := false;
          EXIT;
        ELSIF v_rule.match_mode = 'all' THEN
          v_rule_matched := true;
        END IF;
      END LOOP;

      IF v_total_filters = 0 THEN
        v_rule_matched := true;
      ELSIF v_rule.match_mode = 'any' THEN
        v_rule_matched := v_changed_count > 0;
      END IF;

      IF NOT v_rule_matched THEN
        v_reason := 'Rule filters did not match';
      ELSE
        CASE v_rule.rule_kind
          WHEN 'direct' THEN
            v_target_category_id := v_rule.target_category_id;
            IF v_target_category_id IS NULL THEN
              v_reason := 'Direct rule has no target category';
            ELSIF v_target_category_id = v_current_category_id THEN
              v_reason := 'Rule matched but category was already assigned';
            ELSE
              v_next_category_id := v_target_category_id;
              v_changed := true;
              v_reason := 'Direct rule assigned the configured target category';
            END IF;

          WHEN 'mcc_map' THEN
            SELECT canonical_category_id
            INTO v_target_category_id
            FROM public.money_mcc_canonical_category_map
            WHERE mcc = NULLIF(v_context #>> '{transaction,mcc}', '');

            IF v_target_category_id IS NULL THEN
              v_reason := 'No MCC mapping exists for this transaction';
            ELSIF v_target_category_id = v_current_category_id THEN
              v_reason := 'MCC mapping matched but category was already assigned';
            ELSE
              v_next_category_id := v_target_category_id;
              v_changed := true;
              v_reason := 'Applied built-in MCC mapping';
            END IF;

          WHEN 'llm_categorization' THEN
            v_reason := 'LLM categorization requires the money-categorize Edge Function';

          WHEN 'fallback_uncategorized' THEN
            IF v_current_category_id IS NOT NULL THEN
              v_reason := 'Fallback only runs when no category is assigned';
            ELSE
              SELECT id
              INTO v_target_category_id
              FROM public.money_categories
              WHERE system_key = COALESCE(NULLIF(v_rule.config->>'target_system_key', ''), 'uncategorized')
                AND category_kind = 'canonical'
              LIMIT 1;

              IF v_target_category_id IS NULL THEN
                v_reason := 'Fallback target canonical category could not be resolved';
              ELSE
                v_next_category_id := v_target_category_id;
                v_changed := true;
                v_reason := 'Applied fallback canonical category';
              END IF;
            END IF;

          ELSE
            -- Without this branch, adding a value to money_rule_kind and forgetting this
            -- function raises CASE_NOT_FOUND, which aborts the whole run rather than
            -- skipping the one rule nobody taught it about.
            v_reason := format('Unsupported rule kind %s', v_rule.rule_kind);
        END CASE;
      END IF;
    END IF;

    IF v_changed THEN
      v_current_category_id := v_next_category_id;
      v_last_changed_rule_id := v_rule.id;
      v_last_assignment_method := (
        CASE
          WHEN v_rule.rule_kind = 'llm_categorization' THEN 'llm'
          ELSE 'rule'
        END
      )::public.money_assignment_method;

      IF v_current_category_id IS NULL THEN
        v_current_category_kind := NULL;
        v_current_canonical_category_id := NULL;
        v_current_canonical_system_key := NULL;
      ELSE
        SELECT
          category.category_kind,
          category.canonical_category_id,
          canonical.system_key
        INTO
          v_current_category_kind,
          v_current_canonical_category_id,
          v_current_canonical_system_key
        FROM public.money_categories AS category
        LEFT JOIN public.money_categories AS canonical
          ON canonical.id = category.canonical_category_id
        WHERE category.id = v_current_category_id;
      END IF;
    END IF;

    v_step_debug := jsonb_build_object(
      'rule_kind', v_rule.rule_kind,
      'scope_filter', v_rule.scope_filter,
      'filters', COALESCE(v_rule.filters, '[]'::jsonb),
      'config', COALESCE(v_rule.config, '{}'::jsonb),
      'current_category_id', v_current_category_id,
      'current_canonical_category_id', v_current_canonical_category_id,
      'current_canonical_system_key', v_current_canonical_system_key,
      'target_category_id', v_target_category_id,
      'matched_filter_count', v_changed_count,
      'total_filter_count', v_total_filters,
      'force_overwrite_locked', p_force_overwrite_locked
    );

    IF p_save THEN
      INSERT INTO public.money_category_rule_run_steps (
        rule_run_id,
        rule_id,
        rule_name,
        rule_kind,
        sort_order,
        matched,
        changed_category,
        previous_category_id,
        next_category_id,
        decision_reason,
        debug_payload
      )
      VALUES (
        v_run_id,
        v_rule.id,
        v_rule.name,
        v_rule.rule_kind,
        v_rule.sort_order,
        v_rule_matched,
        v_changed,
        v_previous_category_id,
        v_next_category_id,
        v_reason,
        v_step_debug
      )
      RETURNING id INTO v_step_id;
    ELSE
      v_step_id := NULL;
    END IF;

    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_id', v_step_id,
      'rule_id', v_rule.id,
      'rule_name', v_rule.name,
      'rule_kind', v_rule.rule_kind,
      'sort_order', v_rule.sort_order,
      'matched', v_rule_matched,
      'changed_category', v_changed,
      'previous_category_id', v_previous_category_id,
      'next_category_id', v_next_category_id,
      'decision_reason', v_reason,
      'debug_payload', v_step_debug
    ));

    IF v_changed AND v_rule.stop_processing THEN
      EXIT;
    END IF;
  END LOOP;

  IF p_save THEN
    IF v_current_category_id IS DISTINCT FROM v_starting_category_id THEN
      UPDATE public.money_line_items
      SET
        category_id = v_current_category_id,
        assignment_method = COALESCE(v_last_assignment_method, 'rule'),
        assignment_rule_id = v_last_changed_rule_id,
        last_category_rule_id = v_last_changed_rule_id,
        category_assigned_at = now()
      WHERE id = p_line_item_id;
      v_saved := true;
    END IF;

    UPDATE public.money_category_rule_runs
    SET
      final_category_id = v_current_category_id,
      saved = v_saved
    WHERE id = v_run_id;

    IF v_saved THEN
      UPDATE public.money_line_items
      SET last_category_rule_run_id = v_run_id
      WHERE id = p_line_item_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'line_item_id', p_line_item_id,
    'line_item_title', NULLIF(v_line_item->>'title', ''),
    'transaction_id', v_transaction_id,
    'merchant_name', NULLIF(v_transaction->>'merchant_name', ''),
    'person_id', v_person_id,
    'trigger_source', p_trigger_source,
    'starting_category_id', v_starting_category_id,
    'final_category_id', v_current_category_id,
    'saved', v_saved,
    'steps', v_steps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.money_run_category_rule_pipeline_internal(uuid, uuid, uuid[], boolean, boolean, text) FROM PUBLIC;

COMMENT ON FUNCTION public.money_run_category_rule_pipeline_internal(uuid, uuid, uuid[], boolean, boolean, text) IS
  'Internal deterministic engine for the money category rule pipeline. Preview/apply wrappers call this for one line item at a time.';

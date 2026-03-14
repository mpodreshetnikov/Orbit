-- Function: money_apply_category_rule_pipeline(uuid[], uuid, boolean, text)
-- Apply the deterministic money category rule pipeline to one or more line items.

CREATE OR REPLACE FUNCTION public.money_apply_category_rule_pipeline(
  p_line_item_ids uuid[],
  p_person_id uuid DEFAULT NULL,
  p_force_overwrite_locked boolean DEFAULT false,
  p_trigger_source text DEFAULT 'manual_replay'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_item_id uuid;
  v_runs jsonb := '[]'::jsonb;
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'authenticated'
    AND NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(array_length(p_line_item_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('runs', '[]'::jsonb, 'count', 0);
  END IF;

  FOREACH v_line_item_id IN ARRAY p_line_item_ids LOOP
    v_runs := v_runs || jsonb_build_array(
      public.money_run_category_rule_pipeline_internal(
        v_line_item_id,
        p_person_id,
        NULL,
        true,
        p_force_overwrite_locked,
        p_trigger_source
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'runs', v_runs,
    'count', jsonb_array_length(v_runs)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.money_apply_category_rule_pipeline(uuid[], uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_apply_category_rule_pipeline(uuid[], uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.money_apply_category_rule_pipeline(uuid[], uuid, boolean, text) IS
  'Applies the deterministic money category rule pipeline to a list of line items and persists run history.';

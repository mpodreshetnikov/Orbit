-- Function: money_apply_category_rule_pipeline_for_transaction(uuid, uuid, boolean)
-- Apply the deterministic money category rule pipeline to all line items in a transaction.

CREATE OR REPLACE FUNCTION public.money_apply_category_rule_pipeline_for_transaction(
  p_transaction_id uuid,
  p_person_id uuid DEFAULT NULL,
  p_force_overwrite_locked boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_item_ids uuid[];
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'authenticated'
    AND NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY created_at, id), ARRAY[]::uuid[])
  INTO v_line_item_ids
  FROM public.money_line_items
  WHERE transaction_id = p_transaction_id;

  RETURN public.money_apply_category_rule_pipeline(
    v_line_item_ids,
    p_person_id,
    p_force_overwrite_locked,
    'single_transaction_replay'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.money_apply_category_rule_pipeline_for_transaction(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_apply_category_rule_pipeline_for_transaction(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.money_apply_category_rule_pipeline_for_transaction(uuid, uuid, boolean) IS
  'Applies the deterministic money category rule pipeline to all line items of a transaction.';

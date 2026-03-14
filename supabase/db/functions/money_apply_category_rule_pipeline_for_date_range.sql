-- Function: money_apply_category_rule_pipeline_for_date_range(uuid, date, date, boolean)
-- Apply the deterministic money category rule pipeline to all line items for a person in a posted_at date range.

CREATE OR REPLACE FUNCTION public.money_apply_category_rule_pipeline_for_date_range(
  p_person_id uuid,
  p_from date,
  p_to date,
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

  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'p_person_id is required for date-range replay';
  END IF;

  SELECT COALESCE(array_agg(li.id ORDER BY t.posted_at, li.created_at, li.id), ARRAY[]::uuid[])
  INTO v_line_item_ids
  FROM public.money_line_items AS li
  JOIN public.money_transactions AS t
    ON t.id = li.transaction_id
  WHERE t.payer_person_id = p_person_id
    AND t.posted_at::date >= p_from
    AND t.posted_at::date <= p_to;

  RETURN public.money_apply_category_rule_pipeline(
    v_line_item_ids,
    p_person_id,
    p_force_overwrite_locked,
    'date_range_replay'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.money_apply_category_rule_pipeline_for_date_range(uuid, date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_apply_category_rule_pipeline_for_date_range(uuid, date, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.money_apply_category_rule_pipeline_for_date_range(uuid, date, date, boolean) IS
  'Applies the deterministic money category rule pipeline to all line items for one person in a date range.';

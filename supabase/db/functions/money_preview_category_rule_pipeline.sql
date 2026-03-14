-- Function: money_preview_category_rule_pipeline(uuid, uuid, uuid[])
-- Preview the deterministic money category rule pipeline for a single line item.

CREATE OR REPLACE FUNCTION public.money_preview_category_rule_pipeline(
  p_line_item_id uuid,
  p_person_id uuid DEFAULT NULL,
  p_rule_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'authenticated'
    AND NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN public.money_run_category_rule_pipeline_internal(
    p_line_item_id,
    p_person_id,
    p_rule_ids,
    false,
    false,
    'single_preview'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.money_preview_category_rule_pipeline(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_preview_category_rule_pipeline(uuid, uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.money_preview_category_rule_pipeline(uuid, uuid, uuid[]) IS
  'Previews the deterministic money category rule pipeline for one line item without saving category changes or debug history.';

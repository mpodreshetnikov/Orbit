-- Function: money_get_category_rule_debug(uuid, int)
-- Return persisted category rule runs and steps for a line item.

CREATE OR REPLACE FUNCTION public.money_get_category_rule_debug(
  p_line_item_id uuid,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'authenticated'
    AND NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', run.id,
          'triggered_by_user_id', run.triggered_by_user_id,
          'person_id', run.person_id,
          'trigger_source', run.trigger_source,
          'line_item_id', run.line_item_id,
          'transaction_id', run.transaction_id,
          'starting_category_id', run.starting_category_id,
          'final_category_id', run.final_category_id,
          'saved', run.saved,
          'llm_tokens_prompt', run.llm_tokens_prompt,
          'llm_tokens_completion', run.llm_tokens_completion,
          'created_at', run.created_at,
          'steps', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', step.id,
                'rule_id', step.rule_id,
                'sort_order', step.sort_order,
                'matched', step.matched,
                'changed_category', step.changed_category,
                'previous_category_id', step.previous_category_id,
                'next_category_id', step.next_category_id,
                'decision_reason', step.decision_reason,
                'debug_payload', step.debug_payload,
                'created_at', step.created_at,
                'rule_name', step.rule_name,
                'rule_kind', step.rule_kind
              )
              ORDER BY step.sort_order, step.created_at, step.id
            )
            FROM public.money_category_rule_run_steps AS step
            WHERE step.rule_run_id = run.id
          ), '[]'::jsonb)
        )
        ORDER BY run.created_at DESC, run.id DESC
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT *
      FROM public.money_category_rule_runs
      WHERE line_item_id = p_line_item_id
      ORDER BY created_at DESC, id DESC
      LIMIT GREATEST(COALESCE(p_limit, 20), 1)
    ) AS run
  );
END;
$$;

REVOKE ALL ON FUNCTION public.money_get_category_rule_debug(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_get_category_rule_debug(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.money_get_category_rule_debug(uuid, int) IS
  'Returns recent persisted category rule runs, with nested debug steps, for one money line item.';

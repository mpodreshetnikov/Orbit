-- Function: money_evaluate_category_rule_filter(jsonb, uuid, text, jsonb)
-- Evaluate one JSON filter object for the money category rule pipeline.

CREATE OR REPLACE FUNCTION public.money_evaluate_category_rule_filter(
  p_context jsonb,
  p_current_category_id uuid,
  p_current_canonical_system_key text,
  p_filter jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_field text := COALESCE(p_filter->>'field', '');
  v_operator text := COALESCE(p_filter->>'operator', 'equals');
  v_raw_value text;
  v_text_value text;
  v_filter_value text := NULLIF(regexp_replace(lower(COALESCE(p_filter->>'value', '')), '\s+', ' ', 'g'), '');
  v_number_value numeric;
  v_boolean_value boolean;
  v_set_values text[];
BEGIN
  v_raw_value := CASE v_field
    WHEN 'line_item_title' THEN COALESCE(p_context #>> '{line_item,title}', '')
    WHEN 'merchant_name' THEN COALESCE(p_context #>> '{transaction,merchant_name}', '')
    WHEN 'transaction_comment' THEN COALESCE(p_context #>> '{transaction,comment}', '')
    WHEN 'source_comment' THEN COALESCE(p_context #>> '{transaction,source_comment}', '')
    WHEN 'source' THEN COALESCE(p_context #>> '{transaction,source}', '')
    WHEN 'source_category_id' THEN COALESCE(p_context #>> '{transaction,source_category_id}', '')
    WHEN 'source_category_name' THEN COALESCE(p_context #>> '{transaction,source_category_name}', '')
    WHEN 'mcc' THEN COALESCE(p_context #>> '{transaction,mcc}', '')
    WHEN 'transaction_type' THEN COALESCE(p_context #>> '{transaction,transaction_type}', '')
    WHEN 'account_source' THEN COALESCE(p_context #>> '{account,source}', '')
    WHEN 'account_kind' THEN COALESCE(p_context #>> '{account,account_kind}', '')
    WHEN 'payer_person_id' THEN COALESCE(p_context #>> '{transaction,payer_person_id}', '')
    WHEN 'current_category_id' THEN COALESCE(p_current_category_id::text, '')
    WHEN 'canonical_branch_system_key' THEN COALESCE(p_current_canonical_system_key, '')
    WHEN 'is_transfer' THEN COALESCE(p_context #>> '{transaction,is_transfer}', '')
    WHEN 'line_item_amount' THEN COALESCE(p_context #>> '{line_item,amount}', '')
    WHEN 'transaction_amount' THEN COALESCE(p_context #>> '{transaction,amount}', '')
    ELSE ''
  END;

  v_text_value := NULLIF(regexp_replace(lower(COALESCE(v_raw_value, '')), '\s+', ' ', 'g'), '');
  v_number_value := CASE
    WHEN v_field IN ('line_item_amount', 'transaction_amount') AND v_raw_value <> '' THEN v_raw_value::numeric
    ELSE NULL
  END;
  v_boolean_value := CASE
    WHEN v_field = 'is_transfer' AND v_raw_value <> '' THEN v_raw_value::boolean
    ELSE NULL
  END;
  v_set_values := ARRAY(
    SELECT NULLIF(regexp_replace(lower(value), '\s+', ' ', 'g'), '')
    FROM jsonb_array_elements_text(COALESCE(p_filter->'values', '[]'::jsonb)) AS value
  );

  RETURN CASE v_operator
    WHEN 'contains' THEN v_text_value IS NOT NULL AND v_filter_value IS NOT NULL
      AND POSITION(v_filter_value IN v_text_value) > 0
    WHEN 'not_contains' THEN v_text_value IS NULL OR v_filter_value IS NULL
      OR POSITION(v_filter_value IN v_text_value) = 0
    WHEN 'equals' THEN
      CASE
        WHEN v_field IN ('line_item_amount', 'transaction_amount') THEN
          v_number_value = NULLIF(p_filter->>'value', '')::numeric
        WHEN v_field = 'is_transfer' THEN
          v_boolean_value = (p_filter->>'value')::boolean
        ELSE
          v_text_value = v_filter_value
      END
    WHEN 'starts_with' THEN v_text_value IS NOT NULL AND v_filter_value IS NOT NULL
      AND v_text_value LIKE CONCAT(v_filter_value, '%')
    WHEN 'regex' THEN COALESCE(v_raw_value, '') ~ COALESCE(p_filter->>'value', '')
    WHEN 'contains_any_in_set' THEN
      EXISTS (
        SELECT 1
        FROM unnest(v_set_values) AS candidate(value)
        WHERE v_text_value IS NOT NULL
          AND candidate.value IS NOT NULL
          AND POSITION(candidate.value IN v_text_value) > 0
      )
    WHEN 'equals_any_in_set' THEN
      CASE
        WHEN v_field IN ('line_item_amount', 'transaction_amount') THEN
          to_char(v_number_value, 'FM999999999999999.################') = ANY(v_set_values)
        WHEN v_field = 'is_transfer' THEN
          COALESCE(v_boolean_value::text, '') = ANY(v_set_values)
        ELSE
          v_text_value = ANY(v_set_values)
      END
    WHEN 'in_set' THEN
      CASE
        WHEN v_field IN ('line_item_amount', 'transaction_amount') THEN
          to_char(v_number_value, 'FM999999999999999.################') = ANY(v_set_values)
        WHEN v_field = 'is_transfer' THEN
          COALESCE(v_boolean_value::text, '') = ANY(v_set_values)
        ELSE
          v_text_value = ANY(v_set_values)
      END
    WHEN 'range' THEN v_number_value IS NOT NULL
      AND (COALESCE((p_filter->>'min')::numeric, v_number_value) <= v_number_value)
      AND (COALESCE((p_filter->>'max')::numeric, v_number_value) >= v_number_value)
    WHEN 'is_empty' THEN v_text_value IS NULL
    WHEN 'is_not_empty' THEN v_text_value IS NOT NULL
    ELSE false
  END;
END;
$$;

COMMENT ON FUNCTION public.money_evaluate_category_rule_filter(jsonb, uuid, text, jsonb) IS
  'Evaluates a single JSON filter for the money category rule pipeline.';

-- Function: money_list_line_item_discrepancies(uuid, numeric)
-- Lists transactions whose non-cancelled line item sums diverge from the transaction amount.

DROP FUNCTION IF EXISTS public.money_list_line_item_discrepancies(uuid, numeric);

CREATE OR REPLACE FUNCTION public.money_list_line_item_discrepancies(
  p_person_id uuid,
  p_min_delta numeric DEFAULT 0.01
)
RETURNS TABLE (
  transaction_id uuid,
  posted_at timestamptz,
  merchant_name text,
  amount numeric,
  line_items_sum numeric,
  delta numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    tx.id AS transaction_id,
    tx.posted_at,
    tx.merchant_name,
    tx.amount::numeric AS amount,
    COALESCE(sums.line_items_sum, 0)::numeric AS line_items_sum,
    (tx.amount - COALESCE(sums.line_items_sum, 0))::numeric AS delta
  FROM public.money_transactions AS tx
  LEFT JOIN LATERAL (
    SELECT sum(line_item.amount)::numeric AS line_items_sum
    FROM public.money_line_items AS line_item
    WHERE line_item.transaction_id = tx.id
      AND line_item.line_status <> 'cancelled'
  ) AS sums ON true
  WHERE tx.payer_person_id = p_person_id
    AND abs(tx.amount - COALESCE(sums.line_items_sum, 0)) >= COALESCE(p_min_delta, 0.01)
  ORDER BY abs(tx.amount - COALESCE(sums.line_items_sum, 0)) DESC, tx.posted_at DESC;
$$;

REVOKE ALL ON FUNCTION public.money_list_line_item_discrepancies(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_list_line_item_discrepancies(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.money_list_line_item_discrepancies(uuid, numeric) TO service_role;

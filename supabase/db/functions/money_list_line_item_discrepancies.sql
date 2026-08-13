-- Function: money_list_line_item_discrepancies(uuid, numeric)
-- Lists transactions whose line items do not sum to the transaction amount.
--
-- The import keeps the invariant "line items sum to the transaction amount" by adding a balancing
-- line item when a receipt legitimately differs from the operation. Anything this function returns
-- is therefore either damage predating that invariant or a transaction whose manually edited line
-- items blocked the automatic repair. It is the diagnostic used to size that damage.
--
-- Cancelled line items are excluded, matching how money_get_budget_report counts them.

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
    transaction.id AS transaction_id,
    transaction.posted_at,
    transaction.merchant_name,
    transaction.amount::numeric AS amount,
    COALESCE(line_items.total, 0)::numeric AS line_items_sum,
    (transaction.amount - COALESCE(line_items.total, 0))::numeric AS delta
  FROM public.money_transactions AS transaction
  LEFT JOIN LATERAL (
    SELECT SUM(line_item.amount) AS total
    FROM public.money_line_items AS line_item
    WHERE line_item.transaction_id = transaction.id
      AND line_item.line_status <> 'cancelled'
  ) AS line_items ON true
  WHERE transaction.payer_person_id = p_person_id
    AND EXISTS (
      SELECT 1
      FROM public.money_line_items AS line_item
      WHERE line_item.transaction_id = transaction.id
        AND line_item.line_status <> 'cancelled'
    )
    AND abs(transaction.amount - COALESCE(line_items.total, 0)) >= COALESCE(p_min_delta, 0.01)
  ORDER BY abs(transaction.amount - COALESCE(line_items.total, 0)) DESC;
$$;

COMMENT ON FUNCTION public.money_list_line_item_discrepancies(uuid, numeric) IS
  'Transactions whose non-cancelled line items do not sum to the transaction amount, worst first.';

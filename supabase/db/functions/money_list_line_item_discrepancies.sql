-- Function: money_list_line_item_discrepancies(uuid, numeric)
-- Lists transactions whose line items no longer add up to the transaction amount.
--
-- A receipt may legitimately differ from the operation (tips, bonus spend, partial refund,
-- delivery fee); those gaps are closed by a balancing line item at import time. Anything
-- left over is a real defect: a placeholder that survived next to a real receipt, a
-- manually edited composition the import path refused to touch, or a receipt that belongs
-- to a different operation.

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
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    transaction.id AS transaction_id,
    transaction.posted_at,
    transaction.merchant_name,
    transaction.amount,
    COALESCE(line_items.total, 0) AS line_items_sum,
    round(transaction.amount - COALESCE(line_items.total, 0), 2) AS delta
  FROM public.money_transactions AS transaction
  LEFT JOIN LATERAL (
    -- Cancelled lines are excluded here for the same reason the budget report excludes
    -- them: they are not part of what the operation actually paid for.
    SELECT sum(line_item.amount) AS total
    FROM public.money_line_items AS line_item
    WHERE line_item.transaction_id = transaction.id
      AND line_item.line_status <> 'cancelled'
  ) AS line_items ON true
  WHERE transaction.payer_person_id = p_person_id
    AND abs(transaction.amount - COALESCE(line_items.total, 0)) >= COALESCE(p_min_delta, 0.01)
  ORDER BY abs(transaction.amount - COALESCE(line_items.total, 0)) DESC;
$$;

COMMENT ON FUNCTION public.money_list_line_item_discrepancies(uuid, numeric) IS
  'Transactions whose line item sum differs from the transaction amount by at least p_min_delta, worst first.';

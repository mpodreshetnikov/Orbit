-- Function: money_transaction_feed_summary(...)
-- Returns filtered transaction aggregates for the ledger UI.

DROP FUNCTION IF EXISTS public.money_transaction_feed_summary(
  uuid,
  text,
  uuid[],
  public.money_transaction_type[],
  public.money_transaction_status[],
  uuid[],
  text,
  text,
  timestamptz,
  timestamptz
);

CREATE OR REPLACE FUNCTION public.money_transaction_feed_summary(
  p_payer_person_id uuid,
  p_search text DEFAULT NULL,
  p_account_ids uuid[] DEFAULT NULL,
  p_transaction_types public.money_transaction_type[] DEFAULT NULL,
  p_statuses public.money_transaction_status[] DEFAULT NULL,
  p_category_ids uuid[] DEFAULT NULL,
  p_transfer_filter text DEFAULT 'all',
  p_amount_sign text DEFAULT 'all',
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total_count bigint,
  total_positive_amount numeric,
  total_negative_amount numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transfer_filter text := lower(COALESCE(p_transfer_filter, 'all'));
  v_amount_sign_filter text := lower(COALESCE(p_amount_sign, 'all'));
  v_search text := NULLIF(btrim(p_search), '');
BEGIN
  IF p_payer_person_id IS NULL THEN
    RAISE EXCEPTION 'p_payer_person_id is required';
  END IF;

  IF v_transfer_filter NOT IN ('all', 'only', 'exclude') THEN
    RAISE EXCEPTION 'p_transfer_filter must be one of: all, only, exclude';
  END IF;

  IF v_amount_sign_filter NOT IN ('all', 'income', 'expense') THEN
    RAISE EXCEPTION 'p_amount_sign_filter must be one of: all, income, expense';
  END IF;

  RETURN QUERY
  WITH filtered_transactions AS (
    SELECT t.amount
    FROM public.money_transactions AS t
    WHERE t.payer_person_id = p_payer_person_id
      AND (
        v_search IS NULL
        OR COALESCE(t.merchant_name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(t.comment, '') ILIKE '%' || v_search || '%'
        OR COALESCE(t.source_comment, '') ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1
          FROM public.money_line_items AS li_search
          WHERE li_search.transaction_id = t.id
            AND li_search.title ILIKE '%' || v_search || '%'
        )
      )
      AND (
        p_account_ids IS NULL
        OR cardinality(p_account_ids) = 0
        OR t.account_id = ANY (p_account_ids)
      )
      AND (
        p_transaction_types IS NULL
        OR cardinality(p_transaction_types) = 0
        OR t.transaction_type = ANY (p_transaction_types)
      )
      AND (
        p_statuses IS NULL
        OR cardinality(p_statuses) = 0
        OR t.status = ANY (p_statuses)
      )
      AND (
        p_category_ids IS NULL
        OR cardinality(p_category_ids) = 0
        OR EXISTS (
          SELECT 1
          FROM public.money_line_items AS li_category
          WHERE li_category.transaction_id = t.id
            AND li_category.category_id = ANY (p_category_ids)
        )
      )
      AND (
        v_transfer_filter = 'all'
        OR (v_transfer_filter = 'only' AND t.is_transfer)
        OR (v_transfer_filter = 'exclude' AND NOT t.is_transfer)
      )
      AND (
        v_amount_sign_filter = 'all'
        OR (v_amount_sign_filter = 'income' AND t.amount > 0)
        OR (v_amount_sign_filter = 'expense' AND t.amount < 0)
      )
      AND (p_from IS NULL OR t.posted_at >= p_from)
      AND (p_to IS NULL OR t.posted_at <= p_to)
  )
  SELECT
    count(*)::bigint AS total_count,
    COALESCE(sum(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_positive_amount,
    COALESCE(sum(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS total_negative_amount
  FROM filtered_transactions;
END;
$$;

COMMENT ON FUNCTION public.money_transaction_feed_summary(
  uuid,
  text,
  uuid[],
  public.money_transaction_type[],
  public.money_transaction_status[],
  uuid[],
  text,
  text,
  timestamptz,
  timestamptz
) IS
  'Returns filtered transaction counts plus positive and negative amount totals for the ledger UI.';

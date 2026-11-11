-- Function: money_search_line_items(...)
-- Title-only receipt search for MCP: count and page transactions that have at
-- least one line whose title ILIKE the query, returning only matching lines.
-- SECURITY INVOKER so RLS on money_transactions / money_line_items applies.

CREATE OR REPLACE FUNCTION public.money_search_line_items(
  p_payer_person_id uuid,
  p_query text,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  posted_at timestamptz,
  created_at timestamptz,
  amount numeric,
  currency char(3),
  merchant_name text,
  account_id uuid,
  account_label text,
  account_kind text,
  matching_line_items jsonb,
  line_item_count integer,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query text := NULLIF(btrim(p_query), '');
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  IF p_payer_person_id IS NULL THEN
    RAISE EXCEPTION 'p_payer_person_id is required';
  END IF;

  IF v_query IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH matched_transactions AS (
    SELECT
      t.id,
      t.posted_at,
      t.created_at,
      t.amount,
      t.currency,
      t.merchant_name,
      t.account_id,
      count(*) OVER () AS total_count
    FROM public.money_transactions AS t
    WHERE t.payer_person_id = p_payer_person_id
      AND (p_from IS NULL OR t.posted_at >= p_from)
      AND (p_to IS NULL OR t.posted_at <= p_to)
      AND EXISTS (
        SELECT 1
        FROM public.money_line_items AS li_match
        WHERE li_match.transaction_id = t.id
          AND li_match.title ILIKE '%' || v_query || '%'
      )
  ),
  paged AS (
    SELECT *
    FROM matched_transactions
    ORDER BY posted_at DESC, created_at DESC, id DESC
    OFFSET v_offset
    LIMIT v_limit
  )
  SELECT
    p.id,
    p.posted_at,
    p.created_at,
    p.amount,
    p.currency,
    p.merchant_name,
    p.account_id,
    accounts.account_label,
    accounts.account_kind,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', li.id,
            'title', li.title,
            'amount', li.amount,
            'quantity', li.quantity,
            'unit', li.unit,
            'line_status', li.line_status,
            'category_id', li.category_id,
            'assignment_method', li.assignment_method
          )
          ORDER BY li.created_at, li.id
        )
        FROM public.money_line_items AS li
        WHERE li.transaction_id = p.id
          AND li.title ILIKE '%' || v_query || '%'
      ),
      '[]'::jsonb
    ) AS matching_line_items,
    (
      SELECT count(*)::integer
      FROM public.money_line_items AS li_all
      WHERE li_all.transaction_id = p.id
    ) AS line_item_count,
    p.total_count
  FROM paged AS p
  JOIN public.money_accounts AS accounts
    ON accounts.id = p.account_id
  ORDER BY p.posted_at DESC, p.created_at DESC, p.id DESC;
END;
$$;

COMMENT ON FUNCTION public.money_search_line_items(
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) IS
  'MCP line-title search: pages transactions with a matching receipt line title (ILIKE), returning only matching lines. Counts/paginates after the title predicate.';

GRANT EXECUTE ON FUNCTION public.money_search_line_items(
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) TO authenticated;

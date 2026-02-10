-- Function: get_money_merchant_default_categories()
-- For a payer, returns the most-used category_id per merchant (from past transactions line items).
DROP FUNCTION IF EXISTS public.get_money_merchant_default_categories(uuid);

CREATE OR REPLACE FUNCTION public.get_money_merchant_default_categories(p_payer_person_id uuid)
RETURNS TABLE (merchant_name text, category_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
SECURITY INVOKER
AS $$
  WITH counts AS (
    SELECT
      TRIM(t.merchant_name) AS merchant_name,
      li.category_id,
      COUNT(*) AS cnt
    FROM public.money_transactions t
    JOIN public.money_line_items li ON li.transaction_id = t.id
    WHERE t.payer_person_id = p_payer_person_id
      AND t.merchant_name IS NOT NULL
      AND TRIM(t.merchant_name) <> ''
      AND li.category_id IS NOT NULL
    GROUP BY TRIM(t.merchant_name), li.category_id
  ),
  ranked AS (
    SELECT
      merchant_name,
      category_id,
      ROW_NUMBER() OVER (PARTITION BY merchant_name ORDER BY cnt DESC) AS rn
    FROM counts
  )
  SELECT ranked.merchant_name, ranked.category_id
  FROM ranked
  WHERE rn = 1;
$$;

COMMENT ON FUNCTION public.get_money_merchant_default_categories(uuid) IS
  'For a payer, returns the most-used category_id per merchant (from past transactions line items). Used to default line item category when selecting a merchant.';

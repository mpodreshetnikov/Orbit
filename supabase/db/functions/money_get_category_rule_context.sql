-- Function: money_get_category_rule_context(uuid, uuid)
-- Returns the line-item/transaction/account/card/brand/category/sibling payload
-- used by the category rule pipeline and LLM categorize providers.

CREATE OR REPLACE FUNCTION public.money_get_category_rule_context(
  p_line_item_id uuid,
  p_person_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH context_row AS (
    SELECT
      li.id AS line_item_id,
      li.transaction_id,
      li.title AS line_item_title,
      li.amount AS line_item_amount,
      li.quantity,
      li.unit,
      li.line_status,
      li.category_id,
      li.assignment_method,
      li.assignment_rule_id,
      li.assignment_confidence,
      li.raw_payload AS line_item_raw_payload,
      li.category_locked_by_user,
      li.last_category_rule_id,
      li.last_category_rule_run_id,
      li.category_assigned_at,
      t.payer_person_id,
      t.account_id,
      t.card_id,
      t.source,
      t.posted_at,
      t.amount AS transaction_amount,
      t.currency,
      t.transaction_type,
      t.status AS transaction_status,
      t.merchant_name,
      t.mcc,
      t.comment,
      t.source_comment,
      t.source_category_id,
      t.source_category_name,
      t.cashback_amount,
      t.brand_id,
      t.is_transfer,
      t.raw_payload AS transaction_raw_payload,
      account.id AS account_row_id,
      account.source AS account_source,
      account.account_kind,
      account.account_label,
      card.id AS card_row_id,
      card.last4 AS card_last4,
      card.card_label,
      brand.id AS brand_row_id,
      brand.name AS brand_name,
      brand.slug AS brand_slug,
      current_category.category_kind AS current_category_kind,
      current_category.name_en AS current_category_name_en,
      current_category.name_ru AS current_category_name_ru,
      current_category.system_key AS current_category_system_key,
      current_category.canonical_category_id AS current_canonical_category_id,
      current_canonical.system_key AS current_canonical_system_key
    FROM public.money_line_items AS li
    JOIN public.money_transactions AS t
      ON t.id = li.transaction_id
    LEFT JOIN public.money_accounts AS account
      ON account.id = t.account_id
    LEFT JOIN public.money_cards AS card
      ON card.id = t.card_id
    LEFT JOIN public.money_transaction_brands AS brand
      ON brand.id = t.brand_id
    LEFT JOIN public.money_categories AS current_category
      ON current_category.id = li.category_id
    LEFT JOIN public.money_categories AS current_canonical
      ON current_canonical.id = current_category.canonical_category_id
    WHERE li.id = p_line_item_id
      AND (p_person_id IS NULL OR t.payer_person_id = p_person_id)
  ),
  sibling_items AS (
    SELECT
      context_row.line_item_id,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', sib.id,
              'title', sib.title,
              'amount', sib.amount,
              'quantity', sib.quantity,
              'unit', sib.unit,
              'line_status', sib.line_status,
              'category_id', sib.category_id,
              'assignment_method', sib.assignment_method
            )
            ORDER BY sib.created_at ASC, sib.id ASC
          )
          FROM (
            SELECT
              sibling.id,
              sibling.title,
              sibling.amount,
              sibling.quantity,
              sibling.unit,
              sibling.line_status,
              sibling.category_id,
              sibling.assignment_method,
              sibling.created_at
            FROM public.money_line_items AS sibling
            WHERE sibling.transaction_id = context_row.transaction_id
              AND sibling.id <> context_row.line_item_id
            ORDER BY sibling.created_at ASC, sibling.id ASC
            LIMIT 40
          ) AS sib
        ),
        '[]'::jsonb
      ) AS receipt_sibling_items
    FROM context_row
  )
  SELECT jsonb_build_object(
    'line_item', jsonb_build_object(
      'id', context_row.line_item_id,
      'transaction_id', context_row.transaction_id,
      'title', context_row.line_item_title,
      'amount', context_row.line_item_amount,
      'quantity', context_row.quantity,
      'unit', context_row.unit,
      'line_status', context_row.line_status,
      'category_id', context_row.category_id,
      'assignment_method', context_row.assignment_method,
      'assignment_rule_id', context_row.assignment_rule_id,
      'assignment_confidence', context_row.assignment_confidence,
      'raw_payload', COALESCE(context_row.line_item_raw_payload, '{}'::jsonb),
      'category_locked_by_user', context_row.category_locked_by_user,
      'last_category_rule_id', context_row.last_category_rule_id,
      'last_category_rule_run_id', context_row.last_category_rule_run_id,
      'category_assigned_at', context_row.category_assigned_at
    ),
    'transaction', jsonb_build_object(
      'id', context_row.transaction_id,
      'payer_person_id', context_row.payer_person_id,
      'account_id', context_row.account_id,
      'card_id', context_row.card_id,
      'source', context_row.source,
      'posted_at', context_row.posted_at,
      'amount', context_row.transaction_amount,
      'currency', context_row.currency,
      'transaction_type', context_row.transaction_type,
      'status', context_row.transaction_status,
      'merchant_name', context_row.merchant_name,
      'mcc', context_row.mcc,
      'comment', context_row.comment,
      'source_comment', context_row.source_comment,
      'source_category_id', context_row.source_category_id,
      'source_category_name', context_row.source_category_name,
      'cashback_amount', context_row.cashback_amount,
      'brand_id', context_row.brand_id,
      'is_transfer', context_row.is_transfer,
      'raw_payload', COALESCE(context_row.transaction_raw_payload, '{}'::jsonb)
    ),
    'account', jsonb_build_object(
      'id', context_row.account_row_id,
      'source', context_row.account_source,
      'account_kind', context_row.account_kind,
      'account_label', context_row.account_label
    ),
    'card', jsonb_build_object(
      'id', context_row.card_row_id,
      'last4', context_row.card_last4,
      'card_label', context_row.card_label
    ),
    'brand', jsonb_build_object(
      'id', context_row.brand_row_id,
      'name', context_row.brand_name,
      'slug', context_row.brand_slug
    ),
    'current_category', jsonb_build_object(
      'id', context_row.category_id,
      'kind', context_row.current_category_kind,
      'name_en', context_row.current_category_name_en,
      'name_ru', context_row.current_category_name_ru,
      'system_key', context_row.current_category_system_key,
      'canonical_category_id', context_row.current_canonical_category_id,
      'canonical_system_key', context_row.current_canonical_system_key
    ),
    'receipt_sibling_items', sibling_items.receipt_sibling_items,
    'derived', jsonb_build_object(
      'normalized_line_item_title', NULLIF(regexp_replace(lower(COALESCE(context_row.line_item_title, '')), '\s+', ' ', 'g'), ''),
      'normalized_merchant_name', NULLIF(regexp_replace(lower(COALESCE(context_row.merchant_name, '')), '\s+', ' ', 'g'), ''),
      'absolute_line_item_amount', ABS(COALESCE(context_row.line_item_amount, 0)),
      'unit_price', CASE
        WHEN context_row.quantity IS NOT NULL AND context_row.quantity <> 0
          THEN ABS(COALESCE(context_row.line_item_amount, 0) / context_row.quantity)
        ELSE NULL
      END,
      'posted_day_of_week', EXTRACT(ISODOW FROM context_row.posted_at),
      'posted_month', EXTRACT(MONTH FROM context_row.posted_at),
      'current_category_kind', context_row.current_category_kind,
      'current_canonical_system_key', context_row.current_canonical_system_key,
      'has_receipt_metadata', (
        COALESCE(jsonb_typeof(context_row.line_item_raw_payload), 'null') <> 'null'
        OR COALESCE(context_row.source_category_id, '') <> ''
        OR COALESCE(context_row.source_category_name, '') <> ''
      )
    )
  )
  FROM context_row
  JOIN sibling_items
    ON sibling_items.line_item_id = context_row.line_item_id;
$$;

COMMENT ON FUNCTION public.money_get_category_rule_context(uuid, uuid) IS
  'Builds the joined line-item/transaction/account/card/brand/category/sibling context JSON consumed by the money category rule pipeline and LLM categorize providers.';

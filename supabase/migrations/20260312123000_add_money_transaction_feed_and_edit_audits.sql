CREATE TABLE public.money_transaction_edit_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.money_transactions(id) ON DELETE CASCADE,
  entity_kind text NOT NULL CHECK (entity_kind IN ('transaction', 'line_item')),
  entity_id uuid NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  edited_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_transaction_edit_audits_transaction_created_at
  ON public.money_transaction_edit_audits(transaction_id, created_at DESC);

CREATE INDEX idx_money_transaction_edit_audits_entity
  ON public.money_transaction_edit_audits(entity_kind, entity_id, created_at DESC);

CREATE INDEX idx_money_transactions_payer_feed_order
  ON public.money_transactions(payer_person_id, posted_at DESC, created_at DESC, id DESC);

ALTER TABLE public.money_transaction_edit_audits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.money_list_transactions_feed(
  p_payer_person_id uuid,
  p_search text DEFAULT NULL,
  p_account_ids uuid[] DEFAULT NULL,
  p_transaction_types public.money_transaction_type[] DEFAULT NULL,
  p_statuses public.money_transaction_status[] DEFAULT NULL,
  p_category_ids uuid[] DEFAULT NULL,
  p_transfer_filter text DEFAULT 'all',
  p_amount_sign text DEFAULT 'all',
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  payer_person_id uuid,
  account_id uuid,
  account_label text,
  account_kind text,
  card_id uuid,
  card_last4 text,
  card_label text,
  money_cards jsonb,
  source text,
  external_id text,
  posted_at timestamptz,
  created_at timestamptz,
  amount numeric,
  currency char(3),
  transaction_type public.money_transaction_type,
  status public.money_transaction_status,
  merchant_name text,
  comment text,
  source_comment text,
  is_transfer boolean,
  transfer_group_id uuid,
  brand_id uuid,
  operation_icon_url text,
  cashback_amount numeric,
  cashback_currency text,
  source_category_id text,
  source_category_name text,
  receipt_enrichment_status text,
  receipt_request_key text,
  raw_payload jsonb,
  line_items jsonb,
  line_item_titles text[],
  line_item_count integer,
  category_ids uuid[],
  total_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transfer_filter text := lower(COALESCE(p_transfer_filter, 'all'));
  v_amount_sign_filter text := lower(COALESCE(p_amount_sign, 'all'));
  v_search text := NULLIF(btrim(p_search), '');
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
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
    SELECT t.*
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
  ),
  counted_transactions AS (
    SELECT
      ft.*,
      count(*) OVER () AS total_count
    FROM filtered_transactions AS ft
  ),
  paged_transactions AS (
    SELECT *
    FROM counted_transactions
    ORDER BY posted_at DESC, created_at DESC, id DESC
    OFFSET v_offset
    LIMIT v_limit
  )
  SELECT
    pt.id,
    pt.payer_person_id,
    pt.account_id,
    accounts.account_label,
    accounts.account_kind,
    pt.card_id,
    cards.last4 AS card_last4,
    cards.card_label,
    CASE
      WHEN cards.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', cards.id,
        'last4', cards.last4,
        'card_label', cards.card_label
      )
    END AS money_cards,
    pt.source,
    pt.external_id,
    pt.posted_at,
    pt.created_at,
    pt.amount,
    pt.currency,
    pt.transaction_type,
    pt.status,
    pt.merchant_name,
    pt.comment,
    pt.source_comment,
    pt.is_transfer,
    pt.transfer_group_id,
    pt.brand_id,
    pt.operation_icon_url,
    pt.cashback_amount,
    pt.cashback_currency,
    pt.source_category_id,
    pt.source_category_name,
    pt.receipt_enrichment_status,
    pt.receipt_request_key,
    pt.raw_payload,
    COALESCE(line_item_data.line_items, '[]'::jsonb) AS line_items,
    COALESCE(line_item_data.line_item_titles, '{}'::text[]) AS line_item_titles,
    COALESCE(line_item_data.line_item_count, 0) AS line_item_count,
    COALESCE(line_item_data.category_ids, '{}'::uuid[]) AS category_ids,
    pt.total_count
  FROM paged_transactions AS pt
  JOIN public.money_accounts AS accounts
    ON accounts.id = pt.account_id
  LEFT JOIN public.money_cards AS cards
    ON cards.id = pt.card_id
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(to_jsonb(li) ORDER BY li.created_at, li.id) AS line_items,
      array_remove(array_agg(li.title ORDER BY li.created_at, li.id), NULL) AS line_item_titles,
      count(*)::integer AS line_item_count,
      array_remove(array_agg(DISTINCT li.category_id), NULL) AS category_ids
    FROM public.money_line_items AS li
    WHERE li.transaction_id = pt.id
  ) AS line_item_data ON true
  ORDER BY pt.posted_at DESC, pt.created_at DESC, pt.id DESC;
END;
$$;

COMMENT ON FUNCTION public.money_list_transactions_feed(
  uuid,
  text,
  uuid[],
  public.money_transaction_type[],
  public.money_transaction_status[],
  uuid[],
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) IS
  'Returns a paged money transaction feed with server-side search, filters, stable ordering, and aggregated line items.';

CREATE OR REPLACE FUNCTION public.money_write_transaction_edit_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_before_snapshot jsonb := to_jsonb(OLD);
  v_after_snapshot jsonb := to_jsonb(NEW);
  v_entity_kind text;
  v_transaction_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (v_before_snapshot - 'updated_at') = (v_after_snapshot - 'updated_at') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'money_transactions' THEN
    v_entity_kind := 'transaction';
    v_transaction_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'money_line_items' THEN
    v_entity_kind := 'line_item';
    v_transaction_id := NEW.transaction_id;
  ELSE
    RAISE EXCEPTION 'money_write_transaction_edit_audit does not support table %', TG_TABLE_NAME;
  END IF;

  INSERT INTO public.money_transaction_edit_audits (
    transaction_id,
    entity_kind,
    entity_id,
    before_snapshot,
    after_snapshot,
    edited_by_auth_user_id
  )
  VALUES (
    v_transaction_id,
    v_entity_kind,
    NEW.id,
    v_before_snapshot,
    v_after_snapshot,
    auth.uid()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.money_write_transaction_edit_audit() IS
  'Trigger helper that records money transaction and line item edits into money_transaction_edit_audits.';

DROP TRIGGER IF EXISTS audit_money_transactions_edits ON public.money_transactions;
CREATE TRIGGER audit_money_transactions_edits
  AFTER UPDATE ON public.money_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.money_write_transaction_edit_audit();

DROP TRIGGER IF EXISTS audit_money_line_items_edits ON public.money_line_items;
CREATE TRIGGER audit_money_line_items_edits
  AFTER UPDATE ON public.money_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.money_write_transaction_edit_audit();

CREATE POLICY "money_transaction_edit_audits_select" ON public.money_transaction_edit_audits
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

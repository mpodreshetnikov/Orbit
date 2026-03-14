-- Function: money_get_budget_report(uuid, date, char(3))
-- Returns monthly budget reporting data for the selected payer person and report currency.

DROP FUNCTION IF EXISTS public.money_get_budget_report(uuid, date, char(3));

CREATE OR REPLACE FUNCTION public.money_get_budget_report(
  p_person_id uuid,
  p_month_start date DEFAULT NULL,
  p_report_currency char(3) DEFAULT 'RUB'
)
RETURNS TABLE (
  report_month_start date,
  report_month_end date,
  report_currency char(3),
  actual_income numeric,
  actual_expense numeric,
  actual_net numeric,
  target_income numeric,
  target_expense numeric,
  target_net numeric,
  net_variance numeric,
  category_rows jsonb,
  root_category_rows jsonb,
  trend_points jsonb,
  fx_status jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc('month', COALESCE(p_month_start, current_date))::date;
  v_month_end date := (date_trunc('month', COALESCE(p_month_start, current_date)) + interval '1 month - 1 day')::date;
  v_report_currency char(3) := upper(COALESCE(NULLIF(btrim(p_report_currency::text), ''), 'RUB'));
  v_month_start_utc timestamptz := ((date_trunc('month', COALESCE(p_month_start, current_date))::date)::text || ' 00:00:00+00')::timestamptz;
  v_next_month_start_utc timestamptz := (((date_trunc('month', COALESCE(p_month_start, current_date)) + interval '1 month')::date)::text || ' 00:00:00+00')::timestamptz;
  v_uncategorized_category_id uuid;
BEGIN
  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'p_person_id is required';
  END IF;

  SELECT category.id
  INTO v_uncategorized_category_id
  FROM public.money_categories AS category
  WHERE category.category_kind = 'canonical'
    AND category.system_key = 'uncategorized'
  LIMIT 1;

  IF v_uncategorized_category_id IS NULL THEN
    RAISE EXCEPTION 'Canonical uncategorized category is required for budget reporting';
  END IF;

  RETURN QUERY
  WITH RECURSIVE category_graph AS (
    SELECT
      category.id,
      category.parent_id,
      category.canonical_category_id,
      category.category_kind,
      category.system_key,
      category.sort_order,
      category.depth,
      category.name_en,
      category.name_ru,
      category.slug,
      category.archived_at,
      CASE
        WHEN category.parent_id IS NOT NULL THEN category.parent_id
        WHEN category.category_kind = 'custom' AND category.canonical_category_id <> category.id
          THEN category.canonical_category_id
        ELSE NULL
      END AS display_parent_id
    FROM public.money_categories AS category
  ),
  person_aliases AS (
    SELECT alias.normalized_alias
    FROM public.money_transfer_self_aliases AS alias
    WHERE alias.person_id = p_person_id

    UNION

    SELECT variant.normalized_alias
    FROM public.money_person_self_transfer_variants(p_person_id) AS variant
  ),
  transaction_scope AS (
    SELECT
      tx.id,
      tx.posted_at::date AS posted_date,
      tx.amount,
      tx.currency,
      tx.is_transfer,
      public.money_normalize_transfer_text(
        COALESCE(
          NULLIF(tx.source_comment, ''),
          NULLIF(tx.merchant_name, ''),
          NULLIF(tx.comment, '')
        )
      ) AS normalized_counterparty
    FROM public.money_transactions AS tx
    WHERE tx.payer_person_id = p_person_id
      AND tx.posted_at >= v_month_start_utc
      AND tx.posted_at < v_next_month_start_utc
      AND tx.status IN ('posted', 'pending')
  ),
  filtered_transactions AS (
    SELECT scoped.*
    FROM transaction_scope AS scoped
    WHERE NOT (
      scoped.is_transfer
      AND scoped.normalized_counterparty IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM person_aliases AS alias
        WHERE alias.normalized_alias = scoped.normalized_counterparty
      )
    )
  ),
  effective_line_items AS (
    SELECT
      tx.id AS transaction_id,
      tx.posted_date,
      tx.currency AS source_currency,
      COALESCE(line_item.category_id, v_uncategorized_category_id) AS category_id,
      line_item.amount::numeric AS amount
    FROM filtered_transactions AS tx
    JOIN public.money_line_items AS line_item
      ON line_item.transaction_id = tx.id
     AND line_item.line_status <> 'cancelled'

    UNION ALL

    SELECT
      tx.id AS transaction_id,
      tx.posted_date,
      tx.currency AS source_currency,
      v_uncategorized_category_id AS category_id,
      tx.amount::numeric AS amount
    FROM filtered_transactions AS tx
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.money_line_items AS line_item
      WHERE line_item.transaction_id = tx.id
        AND line_item.line_status <> 'cancelled'
    )
  ),
  direct_targets AS (
    SELECT
      target.category_id,
      target.target_amount::numeric AS target_amount,
      target.currency AS source_currency
    FROM public.money_budget_targets AS target
    WHERE target.person_id = p_person_id
      AND target.month_start = v_month_start
  ),
  required_fx AS (
    SELECT DISTINCT
      line_item.posted_date AS conversion_date,
      upper(line_item.source_currency)::char(3) AS source_currency
    FROM effective_line_items AS line_item
    WHERE upper(line_item.source_currency)::char(3) <> v_report_currency

    UNION

    SELECT DISTINCT
      v_month_start AS conversion_date,
      upper(target.source_currency)::char(3) AS source_currency
    FROM direct_targets AS target
    WHERE upper(target.source_currency)::char(3) <> v_report_currency
  ),
  resolved_fx AS (
    SELECT
      required.conversion_date,
      required.source_currency,
      resolved.rate,
      resolved.effective_rate_date,
      resolved.is_exact
    FROM required_fx AS required
    LEFT JOIN LATERAL public.money_resolve_fx_rate(
      required.conversion_date,
      required.source_currency,
      v_report_currency
    ) AS resolved
      ON true
  ),
  fx_status_rollup AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM resolved_fx AS fx WHERE fx.rate IS NULL) THEN 'error'
        WHEN EXISTS (SELECT 1 FROM resolved_fx AS fx WHERE fx.rate IS NOT NULL AND NOT fx.is_exact)
          THEN 'approximated'
        ELSE 'ok'
      END AS status,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'conversion_date', fx.conversion_date,
              'source_currency', fx.source_currency
            )
            ORDER BY fx.conversion_date, fx.source_currency
          )
          FROM resolved_fx AS fx
          WHERE fx.rate IS NULL
        ),
        '[]'::jsonb
      ) AS missing_conversions,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'conversion_date', fx.conversion_date,
              'source_currency', fx.source_currency,
              'effective_rate_date', fx.effective_rate_date
            )
            ORDER BY fx.conversion_date, fx.source_currency
          )
          FROM resolved_fx AS fx
          WHERE fx.rate IS NOT NULL
            AND NOT fx.is_exact
        ),
        '[]'::jsonb
      ) AS approximated_conversions
  ),
  converted_line_items AS (
    SELECT
      line_item.transaction_id,
      line_item.posted_date,
      line_item.category_id,
      CASE
        WHEN upper(line_item.source_currency)::char(3) = v_report_currency THEN line_item.amount
        ELSE line_item.amount * fx.rate
      END AS report_amount
    FROM effective_line_items AS line_item
    LEFT JOIN resolved_fx AS fx
      ON fx.conversion_date = line_item.posted_date
     AND fx.source_currency = upper(line_item.source_currency)::char(3)
  ),
  converted_targets AS (
    SELECT
      target.category_id,
      target.target_amount AS direct_target_amount,
      CASE
        WHEN upper(target.source_currency)::char(3) = v_report_currency THEN target.target_amount
        ELSE target.target_amount * fx.rate
      END AS report_target_amount
    FROM direct_targets AS target
    LEFT JOIN resolved_fx AS fx
      ON fx.conversion_date = v_month_start
     AND fx.source_currency = upper(target.source_currency)::char(3)
  ),
  direct_actuals AS (
    SELECT
      line_item.category_id,
      COALESCE(sum(CASE WHEN line_item.report_amount > 0 THEN line_item.report_amount ELSE 0 END), 0) AS actual_income,
      COALESCE(sum(CASE WHEN line_item.report_amount < 0 THEN line_item.report_amount ELSE 0 END), 0) AS actual_expense,
      COALESCE(sum(line_item.report_amount), 0) AS actual_net
    FROM converted_line_items AS line_item
    GROUP BY line_item.category_id
  ),
  base_node_metrics AS (
    SELECT
      graph.id AS category_id,
      COALESCE(actuals.actual_income, 0) AS actual_income,
      COALESCE(actuals.actual_expense, 0) AS actual_expense,
      COALESCE(actuals.actual_net, 0) AS actual_net,
      COALESCE(targets.report_target_amount, 0) AS direct_target_amount
    FROM category_graph AS graph
    LEFT JOIN direct_actuals AS actuals
      ON actuals.category_id = graph.id
    LEFT JOIN converted_targets AS targets
      ON targets.category_id = graph.id
  ),
  metric_rollup AS (
    SELECT
      metric.category_id AS node_id,
      metric.actual_income,
      metric.actual_expense,
      metric.actual_net,
      metric.direct_target_amount
    FROM base_node_metrics AS metric

    UNION ALL

    SELECT
      parent.id AS node_id,
      rollup.actual_income,
      rollup.actual_expense,
      rollup.actual_net,
      rollup.direct_target_amount
    FROM metric_rollup AS rollup
    JOIN category_graph AS child
      ON child.id = rollup.node_id
    JOIN category_graph AS parent
      ON parent.id = child.display_parent_id
  ),
  category_totals AS (
    SELECT
      rollup.node_id AS category_id,
      COALESCE(sum(rollup.actual_income), 0) AS actual_income,
      COALESCE(sum(rollup.actual_expense), 0) AS actual_expense,
      COALESCE(sum(rollup.actual_net), 0) AS actual_net,
      COALESCE(sum(rollup.direct_target_amount), 0) AS target_amount
    FROM metric_rollup AS rollup
    GROUP BY rollup.node_id
  ),
  category_enriched AS (
    SELECT
      graph.id,
      graph.parent_id,
      graph.canonical_category_id,
      graph.category_kind,
      graph.system_key,
      graph.sort_order,
      graph.depth,
      graph.name_en,
      graph.name_ru,
      graph.slug,
      graph.archived_at,
      graph.display_parent_id,
      totals.actual_income,
      totals.actual_expense,
      totals.actual_net,
      metric.direct_target_amount,
      totals.target_amount,
      totals.actual_net - totals.target_amount AS variance_amount
    FROM category_graph AS graph
    JOIN base_node_metrics AS metric
      ON metric.category_id = graph.id
    JOIN category_totals AS totals
      ON totals.category_id = graph.id
  ),
  visible_seeds AS (
    SELECT category.id
    FROM category_enriched AS category
    WHERE category.archived_at IS NULL
       OR category.actual_net <> 0
       OR category.target_amount <> 0
       OR category.direct_target_amount <> 0
  ),
  visibility_propagation AS (
    SELECT seed.id AS category_id
    FROM visible_seeds AS seed

    UNION

    SELECT parent.id
    FROM visibility_propagation AS propagation
    JOIN category_graph AS child
      ON child.id = propagation.category_id
    JOIN category_graph AS parent
      ON parent.id = child.display_parent_id
  ),
  visible_categories AS (
    SELECT DISTINCT
      category.*,
      EXISTS (
        SELECT 1
        FROM category_graph AS child
        JOIN visibility_propagation AS visible_child
          ON visible_child.category_id = child.id
        WHERE child.display_parent_id = category.id
      ) AS has_children
    FROM category_enriched AS category
    JOIN visibility_propagation AS visible
      ON visible.category_id = category.id
  ),
  sort_paths AS (
    SELECT
      root.id,
      lpad(root.sort_order::text, 4, '0') || ':' || lower(root.name_en) AS sort_path
    FROM category_graph AS root
    WHERE root.display_parent_id IS NULL

    UNION ALL

    SELECT
      child.id,
      sort_paths.sort_path || '/' || lpad(child.sort_order::text, 4, '0') || ':' || lower(child.name_en)
    FROM sort_paths
    JOIN category_graph AS child
      ON child.display_parent_id = sort_paths.id
  ),
  category_rows_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', category.id,
          'parent_id', category.display_parent_id,
          'canonical_category_id', category.canonical_category_id,
          'category_kind', category.category_kind,
          'system_key', category.system_key,
          'sort_order', category.sort_order,
          'depth', category.depth,
          'name_en', category.name_en,
          'name_ru', category.name_ru,
          'slug', category.slug,
          'archived_at', category.archived_at,
          'has_children', category.has_children,
          'actual_income', category.actual_income,
          'actual_expense', category.actual_expense,
          'actual_net', category.actual_net,
          'direct_target_amount', category.direct_target_amount,
          'target_amount', category.target_amount,
          'variance_amount', category.variance_amount
        )
        ORDER BY sort_paths.sort_path
      ),
      '[]'::jsonb
    ) AS payload
    FROM visible_categories AS category
    JOIN sort_paths
      ON sort_paths.id = category.id
  ),
  root_rows_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', category.id,
          'name_en', category.name_en,
          'name_ru', category.name_ru,
          'slug', category.slug,
          'actual_income', category.actual_income,
          'actual_expense', category.actual_expense,
          'actual_net', category.actual_net,
          'target_amount', category.target_amount,
          'variance_amount', category.variance_amount
        )
        ORDER BY sort_paths.sort_path
      ),
      '[]'::jsonb
    ) AS payload
    FROM visible_categories AS category
    JOIN sort_paths
      ON sort_paths.id = category.id
    WHERE category.display_parent_id IS NULL
  ),
  trend_rows AS (
    SELECT
      day_series.day::date AS bucket_date,
      COALESCE(sum(CASE WHEN line_item.report_amount > 0 THEN line_item.report_amount ELSE 0 END), 0) AS actual_income,
      COALESCE(sum(CASE WHEN line_item.report_amount < 0 THEN line_item.report_amount ELSE 0 END), 0) AS actual_expense,
      COALESCE(sum(line_item.report_amount), 0) AS actual_net
    FROM generate_series(v_month_start, v_month_end, interval '1 day') AS day_series(day)
    LEFT JOIN converted_line_items AS line_item
      ON line_item.posted_date = day_series.day::date
    GROUP BY day_series.day
    ORDER BY day_series.day
  ),
  trend_points_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', trend.bucket_date,
          'actual_income', trend.actual_income,
          'actual_expense', trend.actual_expense,
          'actual_net', trend.actual_net
        )
        ORDER BY trend.bucket_date
      ),
      '[]'::jsonb
    ) AS payload
    FROM trend_rows AS trend
  ),
  summary_actuals AS (
    SELECT
      COALESCE(sum(CASE WHEN line_item.report_amount > 0 THEN line_item.report_amount ELSE 0 END), 0) AS actual_income,
      COALESCE(sum(CASE WHEN line_item.report_amount < 0 THEN line_item.report_amount ELSE 0 END), 0) AS actual_expense,
      COALESCE(sum(line_item.report_amount), 0) AS actual_net
    FROM converted_line_items AS line_item
  ),
  summary_targets AS (
    SELECT
      COALESCE(sum(CASE WHEN target.report_target_amount > 0 THEN target.report_target_amount ELSE 0 END), 0) AS target_income,
      COALESCE(sum(CASE WHEN target.report_target_amount < 0 THEN target.report_target_amount ELSE 0 END), 0) AS target_expense,
      COALESCE(sum(target.report_target_amount), 0) AS target_net
    FROM converted_targets AS target
  )
  SELECT
    v_month_start AS report_month_start,
    v_month_end AS report_month_end,
    v_report_currency AS report_currency,
    CASE WHEN fx.status = 'error' THEN NULL ELSE summary_actuals.actual_income END AS actual_income,
    CASE WHEN fx.status = 'error' THEN NULL ELSE summary_actuals.actual_expense END AS actual_expense,
    CASE WHEN fx.status = 'error' THEN NULL ELSE summary_actuals.actual_net END AS actual_net,
    CASE WHEN fx.status = 'error' THEN NULL ELSE summary_targets.target_income END AS target_income,
    CASE WHEN fx.status = 'error' THEN NULL ELSE summary_targets.target_expense END AS target_expense,
    CASE WHEN fx.status = 'error' THEN NULL ELSE summary_targets.target_net END AS target_net,
    CASE
      WHEN fx.status = 'error' THEN NULL
      ELSE summary_actuals.actual_net - summary_targets.target_net
    END AS net_variance,
    CASE WHEN fx.status = 'error' THEN '[]'::jsonb ELSE category_rows_json.payload END AS category_rows,
    CASE WHEN fx.status = 'error' THEN '[]'::jsonb ELSE root_rows_json.payload END AS root_category_rows,
    CASE WHEN fx.status = 'error' THEN '[]'::jsonb ELSE trend_points_json.payload END AS trend_points,
    jsonb_build_object(
      'status', fx.status,
      'report_currency', v_report_currency,
      'missing_conversions', fx.missing_conversions,
      'approximated_conversions', fx.approximated_conversions
    ) AS fx_status
  FROM fx_status_rollup AS fx
  CROSS JOIN summary_actuals
  CROSS JOIN summary_targets
  CROSS JOIN category_rows_json
  CROSS JOIN root_rows_json
  CROSS JOIN trend_points_json;
END;
$$;

COMMENT ON FUNCTION public.money_get_budget_report(uuid, date, char(3)) IS
  'Returns monthly money budget reporting data with category rows, root chart rows, trend points, and FX status for the selected payer person.';

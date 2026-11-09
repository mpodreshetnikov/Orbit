-- The money report for any period (T-261028-yhm); see supabase/db/functions/money_get_spending_report.sql.

-- Function: money_get_spending_report(uuid, date, date, char(3), uuid[], uuid, date)
-- The money report (T-261028-yhm): where the money of a period went, for any period, narrowed to
-- some accounts and to one category's branch, against the period just before it and against last
-- year's average, with twelve months of history per category, the days, the top merchants, and a
-- forecast of the period's spending while the period is still running.
--
-- Counting follows money_get_budget_report: the payer's posted and pending transactions, transfers
-- to oneself left out by alias, line items carry the category, a transaction without live line
-- items counts whole as uncategorized, every amount converted into the report currency by
-- money_resolve_fx_rate on the day it was posted.
--
-- Expenses come back as positive amounts spent, income as positive amounts received, net as their
-- signed difference. "Last year" is the calendar year before the period starts; its average is the
-- year's total scaled to the period's length in days, so a month compares with an average month.
-- The forecast covers spending only: the period's spending so far plus, for every day still to
-- come, what that weekday cost on average over the twelve weeks before today. Income arrives in a
-- few large payments that a weekday average would smear across the month, so it is not forecast.

DROP FUNCTION IF EXISTS public.money_get_spending_report(uuid, date, date, char(3), uuid[], uuid, date);

CREATE OR REPLACE FUNCTION public.money_get_spending_report(
  p_person_id uuid,
  p_start date,
  p_end date,
  p_report_currency char(3) DEFAULT 'RUB',
  p_account_ids uuid[] DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_today date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_currency char(3) := upper(COALESCE(NULLIF(btrim(p_report_currency::text), ''), 'RUB'));
  v_today date := COALESCE(p_today, current_date);
  v_days integer;
  v_previous_start date;
  v_previous_end date;
  v_last_year integer;
  v_last_year_start date;
  v_last_year_end date;
  v_last_year_days integer;
  v_months_start date;
  v_forecast_from date;
  v_forecast_history_start date;
  v_window_start date;
  v_uncategorized_category_id uuid;
  v_result jsonb;
BEGIN
  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'p_person_id is required';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'p_start and p_end are required and p_end may not be before p_start';
  END IF;
  IF p_end - p_start > 366 THEN
    RAISE EXCEPTION 'a report covers at most 367 days';
  END IF;

  v_days := p_end - p_start + 1;
  v_previous_end := p_start - 1;
  v_previous_start := p_start - v_days;
  v_last_year := extract(year FROM p_start)::integer - 1;
  v_last_year_start := make_date(v_last_year, 1, 1);
  v_last_year_end := make_date(v_last_year, 12, 31);
  v_last_year_days := v_last_year_end - v_last_year_start + 1;
  v_months_start := (date_trunc('month', p_end) - interval '11 months')::date;
  v_forecast_from := GREATEST(v_today + 1, p_start);
  v_forecast_history_start := v_today - 84;
  v_window_start := LEAST(v_previous_start, v_last_year_start, v_months_start, v_forecast_history_start);

  SELECT category.id
  INTO v_uncategorized_category_id
  FROM public.money_categories AS category
  WHERE category.category_kind = 'canonical'
    AND category.system_key = 'uncategorized'
  LIMIT 1;

  IF v_uncategorized_category_id IS NULL THEN
    RAISE EXCEPTION 'Canonical uncategorized category is required for the money report';
  END IF;

  WITH RECURSIVE category_graph AS (
    SELECT
      category.id,
      category.system_key,
      category.sort_order,
      category.name_en,
      category.name_ru,
      category.slug,
      CASE
        WHEN category.parent_id IS NOT NULL THEN category.parent_id
        WHEN category.category_kind = 'custom' AND category.canonical_category_id <> category.id
          THEN category.canonical_category_id
        ELSE NULL
      END AS display_parent_id
    FROM public.money_categories AS category
  ),
  category_ancestors AS (
    SELECT graph.id AS category_id, graph.id AS ancestor_id
    FROM category_graph AS graph

    UNION ALL

    SELECT ancestors.category_id, graph.display_parent_id
    FROM category_ancestors AS ancestors
    JOIN category_graph AS graph
      ON graph.id = ancestors.ancestor_id
    WHERE graph.display_parent_id IS NOT NULL
  ),
  person_aliases AS (
    SELECT alias.normalized_alias
    FROM public.money_transfer_self_aliases AS alias
    WHERE alias.person_id = p_person_id

    UNION

    SELECT variant.normalized_alias
    FROM public.money_person_self_transfer_variants(p_person_id) AS variant
  ),
  scoped_transactions AS (
    SELECT
      tx.id,
      tx.posted_at::date AS posted_date,
      tx.currency,
      tx.amount,
      tx.brand_id,
      NULLIF(btrim(tx.merchant_name), '') AS merchant_name
    FROM public.money_transactions AS tx
    WHERE tx.payer_person_id = p_person_id
      AND tx.posted_at >= (v_window_start::text || ' 00:00:00+00')::timestamptz
      AND tx.posted_at < ((p_end + 1)::text || ' 00:00:00+00')::timestamptz
      AND tx.status IN ('posted', 'pending')
      AND (p_account_ids IS NULL OR tx.account_id = ANY (p_account_ids))
      AND NOT (
        tx.is_transfer
        AND EXISTS (
          SELECT 1
          FROM person_aliases AS alias
          WHERE alias.normalized_alias = public.money_normalize_transfer_text(
            COALESCE(NULLIF(tx.source_comment, ''), NULLIF(tx.merchant_name, ''), NULLIF(tx.comment, ''))
          )
        )
      )
  ),
  effective_lines AS (
    SELECT
      tx.id AS transaction_id,
      tx.posted_date,
      upper(tx.currency)::char(3) AS source_currency,
      tx.brand_id,
      tx.merchant_name,
      COALESCE(line_item.category_id, v_uncategorized_category_id) AS category_id,
      line_item.amount::numeric AS amount
    FROM scoped_transactions AS tx
    JOIN public.money_line_items AS line_item
      ON line_item.transaction_id = tx.id
     AND line_item.line_status <> 'cancelled'

    UNION ALL

    SELECT
      tx.id,
      tx.posted_date,
      upper(tx.currency)::char(3),
      tx.brand_id,
      tx.merchant_name,
      v_uncategorized_category_id,
      tx.amount::numeric
    FROM scoped_transactions AS tx
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.money_line_items AS line_item
      WHERE line_item.transaction_id = tx.id
        AND line_item.line_status <> 'cancelled'
    )
  ),
  filtered_lines AS (
    SELECT line.*
    FROM effective_lines AS line
    WHERE p_category_id IS NULL
       OR EXISTS (
         SELECT 1
         FROM category_ancestors AS ancestors
         WHERE ancestors.category_id = line.category_id
           AND ancestors.ancestor_id = p_category_id
       )
  ),
  required_fx AS (
    SELECT DISTINCT line.posted_date, line.source_currency
    FROM filtered_lines AS line
    WHERE line.source_currency <> v_currency
  ),
  resolved_fx AS (
    SELECT required.posted_date, required.source_currency, resolved.rate, resolved.is_exact
    FROM required_fx AS required
    LEFT JOIN LATERAL public.money_resolve_fx_rate(required.posted_date, required.source_currency, v_currency) AS resolved
      ON true
  ),
  converted AS (
    SELECT
      line.transaction_id,
      line.posted_date,
      line.category_id,
      line.brand_id,
      line.merchant_name,
      CASE WHEN line.source_currency = v_currency THEN line.amount ELSE line.amount * fx.rate END AS amount
    FROM filtered_lines AS line
    LEFT JOIN resolved_fx AS fx
      ON fx.posted_date = line.posted_date
     AND fx.source_currency = line.source_currency
  ),
  measured AS (
    SELECT
      converted.*,
      GREATEST(converted.amount, 0) AS income,
      GREATEST(-converted.amount, 0) AS expense,
      converted.posted_date BETWEEN p_start AND p_end AS in_period,
      converted.posted_date BETWEEN v_previous_start AND v_previous_end AS in_previous,
      converted.posted_date BETWEEN v_last_year_start AND v_last_year_end AS in_last_year
    FROM converted
    WHERE converted.amount IS NOT NULL
  ),
  totals AS (
    SELECT
      COALESCE(sum(income) FILTER (WHERE in_period), 0) AS income,
      COALESCE(sum(expense) FILTER (WHERE in_period), 0) AS expense,
      COALESCE(sum(income) FILTER (WHERE in_previous), 0) AS previous_income,
      COALESCE(sum(expense) FILTER (WHERE in_previous), 0) AS previous_expense,
      COALESCE(sum(income) FILTER (WHERE in_last_year), 0) * v_days / v_last_year_days AS last_year_income,
      COALESCE(sum(expense) FILTER (WHERE in_last_year), 0) * v_days / v_last_year_days AS last_year_expense,
      COALESCE(sum(expense) FILTER (WHERE posted_date BETWEEN p_start AND LEAST(v_today, p_end)), 0)
        AS expense_to_date
    FROM measured
  ),
  weekday_history AS (
    SELECT
      extract(isodow FROM day_series.day)::integer AS weekday,
      COALESCE(sum(measured.expense), 0) AS expense
    FROM generate_series(v_forecast_history_start, v_today - 1, interval '1 day') AS day_series(day)
    LEFT JOIN measured
      ON measured.posted_date = day_series.day::date
    GROUP BY day_series.day
  ),
  weekday_average AS (
    SELECT weekday, avg(expense) AS expense
    FROM weekday_history
    GROUP BY weekday
  ),
  forecast AS (
    SELECT COALESCE(sum(average.expense), 0) AS remaining_expense
    FROM generate_series(v_forecast_from, p_end, interval '1 day') AS day_series(day)
    JOIN weekday_average AS average
      ON average.weekday = extract(isodow FROM day_series.day)::integer
  ),
  category_rollup AS (
    SELECT
      ancestors.ancestor_id AS category_id,
      COALESCE(sum(measured.income) FILTER (WHERE measured.in_period), 0) AS income,
      COALESCE(sum(measured.expense) FILTER (WHERE measured.in_period), 0) AS expense,
      COALESCE(sum(measured.income) FILTER (WHERE measured.in_previous), 0) AS previous_income,
      COALESCE(sum(measured.expense) FILTER (WHERE measured.in_previous), 0) AS previous_expense,
      COALESCE(sum(measured.income) FILTER (WHERE measured.in_last_year), 0) * v_days / v_last_year_days
        AS last_year_income,
      COALESCE(sum(measured.expense) FILTER (WHERE measured.in_last_year), 0) * v_days / v_last_year_days
        AS last_year_expense
    FROM measured
    JOIN category_ancestors AS ancestors
      ON ancestors.category_id = measured.category_id
    GROUP BY ancestors.ancestor_id
  ),
  month_series AS (
    SELECT (v_months_start + make_interval(months => offs))::date AS month_start
    FROM generate_series(0, 11) AS offs
  ),
  category_months AS (
    SELECT
      ancestors.ancestor_id AS category_id,
      date_trunc('month', measured.posted_date)::date AS month_start,
      sum(measured.income) AS income,
      sum(measured.expense) AS expense
    FROM measured
    JOIN category_ancestors AS ancestors
      ON ancestors.category_id = measured.category_id
    WHERE measured.posted_date >= v_months_start
    GROUP BY ancestors.ancestor_id, date_trunc('month', measured.posted_date)
  ),
  visible_categories AS (
    SELECT graph.*, rollup.*
    FROM category_rollup AS rollup
    JOIN category_graph AS graph
      ON graph.id = rollup.category_id
    WHERE rollup.income <> 0
       OR rollup.expense <> 0
       OR rollup.previous_income <> 0
       OR rollup.previous_expense <> 0
       OR rollup.last_year_income <> 0
       OR rollup.last_year_expense <> 0
       OR EXISTS (SELECT 1 FROM category_months AS months WHERE months.category_id = rollup.category_id)
  ),
  categories_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', category.id,
          'parent_id', category.display_parent_id,
          'system_key', category.system_key,
          'name_en', category.name_en,
          'name_ru', category.name_ru,
          'slug', category.slug,
          'has_children', EXISTS (
            SELECT 1 FROM visible_categories AS child WHERE child.display_parent_id = category.id
          ),
          'income', category.income,
          'expense', category.expense,
          'previous_income', category.previous_income,
          'previous_expense', category.previous_expense,
          'last_year_income', category.last_year_income,
          'last_year_expense', category.last_year_expense,
          'months', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'month_start', series.month_start,
                'income', COALESCE(months.income, 0),
                'expense', COALESCE(months.expense, 0)
              )
              ORDER BY series.month_start
            )
            FROM month_series AS series
            LEFT JOIN category_months AS months
              ON months.category_id = category.id
             AND months.month_start = series.month_start
          )
        )
        ORDER BY category.expense DESC, category.income DESC, category.sort_order, category.name_en
      ),
      '[]'::jsonb
    ) AS payload
    FROM visible_categories AS category
  ),
  days_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', day_series.day::date,
          'income', COALESCE(day_totals.income, 0),
          'expense', COALESCE(day_totals.expense, 0)
        )
        ORDER BY day_series.day
      ),
      '[]'::jsonb
    ) AS payload
    FROM generate_series(p_start, p_end, interval '1 day') AS day_series(day)
    LEFT JOIN (
      SELECT posted_date, sum(income) AS income, sum(expense) AS expense
      FROM measured
      WHERE in_period
      GROUP BY posted_date
    ) AS day_totals
      ON day_totals.posted_date = day_series.day::date
  ),
  merchant_totals AS (
    SELECT
      measured.brand_id,
      CASE WHEN measured.brand_id IS NULL THEN lower(measured.merchant_name) END AS merchant_key,
      min(measured.merchant_name) AS merchant_name,
      sum(measured.expense) AS expense,
      count(DISTINCT measured.transaction_id) AS transaction_count
    FROM measured
    WHERE measured.in_period
      AND measured.expense > 0
      AND (measured.brand_id IS NOT NULL OR measured.merchant_name IS NOT NULL)
    GROUP BY measured.brand_id, CASE WHEN measured.brand_id IS NULL THEN lower(measured.merchant_name) END
  ),
  merchants_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'brand_id', top.brand_id,
          'name', COALESCE(brand.name, top.merchant_name),
          'logo_url', brand.logo_url,
          'base_color', brand.base_color,
          'expense', top.expense,
          'transaction_count', top.transaction_count
        )
        ORDER BY top.expense DESC, COALESCE(brand.name, top.merchant_name)
      ),
      '[]'::jsonb
    ) AS payload
    FROM (
      SELECT *
      FROM merchant_totals
      ORDER BY expense DESC, merchant_name
      LIMIT 10
    ) AS top
    LEFT JOIN public.money_transaction_brands AS brand
      ON brand.id = top.brand_id
  ),
  fx_json AS (
    SELECT jsonb_build_object(
      'status',
      CASE
        WHEN EXISTS (SELECT 1 FROM resolved_fx WHERE rate IS NULL) THEN 'error'
        WHEN EXISTS (SELECT 1 FROM resolved_fx WHERE rate IS NOT NULL AND NOT is_exact) THEN 'approximated'
        ELSE 'ok'
      END,
      'missing_conversions',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('conversion_date', fx.posted_date, 'source_currency', fx.source_currency)
            ORDER BY fx.posted_date, fx.source_currency
          )
          FROM resolved_fx AS fx
          WHERE fx.rate IS NULL
        ),
        '[]'::jsonb
      )
    ) AS payload
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'days', v_days,
      'previous_start', v_previous_start,
      'previous_end', v_previous_end,
      'last_year', v_last_year
    ),
    'currency', v_currency,
    'totals', jsonb_build_object(
      'income', totals.income,
      'expense', totals.expense,
      'net', totals.income - totals.expense,
      'previous_income', totals.previous_income,
      'previous_expense', totals.previous_expense,
      'previous_net', totals.previous_income - totals.previous_expense,
      'last_year_income', totals.last_year_income,
      'last_year_expense', totals.last_year_expense,
      'last_year_net', totals.last_year_income - totals.last_year_expense
    ),
    'forecast', CASE
      WHEN v_today >= p_start AND v_today < p_end THEN jsonb_build_object(
        'expense', totals.expense_to_date + forecast.remaining_expense,
        'days_left', p_end - v_today
      )
      ELSE NULL
    END,
    'categories', categories_json.payload,
    'days', days_json.payload,
    'merchants', merchants_json.payload,
    'fx_status', fx_json.payload
  )
  INTO v_result
  FROM totals
  CROSS JOIN forecast
  CROSS JOIN categories_json
  CROSS JOIN days_json
  CROSS JOIN merchants_json
  CROSS JOIN fx_json;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.money_get_spending_report(uuid, date, date, char(3), uuid[], uuid, date) IS
  'The money report for any period: totals against the previous period and last year''s average, a spending forecast, categories with twelve months of history, days, top merchants, and FX status.';

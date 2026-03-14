BEGIN;
SELECT plan(6);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.money_fx_rates
    WHERE rate_date BETWEEN DATE '2025-01-01' AND DATE '2026-03-13'
      AND base_currency = 'USD'
      AND quote_currency = 'RUB'
  ),
  437::bigint,
  'baseline FX history provides a USD/RUB row for every calendar day from 2025-01-01 through 2026-03-13'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.money_fx_rates
    WHERE rate_date BETWEEN DATE '2025-01-01' AND DATE '2026-03-13'
      AND base_currency = 'RUB'
      AND quote_currency = 'USD'
  ),
  437::bigint,
  'baseline FX history provides a RUB/USD row for every calendar day from 2025-01-01 through 2026-03-13'
);

SELECT is(
  (
    SELECT rate
    FROM public.money_fx_rates
    WHERE rate_date = DATE '2025-01-01'
      AND base_currency = 'USD'
      AND quote_currency = 'RUB'
  ),
  101.6797::numeric,
  'baseline FX history backfills 2025-01-01 USD/RUB with the latest published official rate'
);

SELECT is(
  (
    SELECT round(rate, 12)
    FROM public.money_fx_rates
    WHERE rate_date = DATE '2025-01-01'
      AND base_currency = 'RUB'
      AND quote_currency = 'USD'
  ),
  round((1 / 101.6797::numeric), 12),
  'baseline FX history backfills 2025-01-01 RUB/USD as the reciprocal of the official USD/RUB rate'
);

SELECT is(
  (
    SELECT rate
    FROM public.money_fx_rates
    WHERE rate_date = DATE '2026-03-13'
      AND base_currency = 'USD'
      AND quote_currency = 'RUB'
  ),
  79.0671::numeric,
  'baseline FX history includes the latest USD/RUB rate for 2026-03-13'
);

SELECT is(
  (
    SELECT count(DISTINCT rate_date)::bigint
    FROM public.money_fx_rates
    WHERE rate_date BETWEEN DATE '2025-01-01' AND DATE '2026-03-13'
      AND (
        (base_currency = 'USD' AND quote_currency = 'RUB')
        OR (base_currency = 'RUB' AND quote_currency = 'USD')
      )
  ),
  437::bigint,
  'baseline FX history has no missing dates in the requested range'
);

SELECT * FROM finish();
ROLLBACK;

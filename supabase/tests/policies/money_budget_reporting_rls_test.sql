BEGIN;
SELECT plan(21);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_budget_targets'
      AND policyname = 'money_budget_targets_select'
  ),
  'money_budget_targets_select policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_budget_targets'
      AND policyname = 'money_budget_targets_insert'
  ),
  'money_budget_targets_insert policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_budget_targets'
      AND policyname = 'money_budget_targets_update'
  ),
  'money_budget_targets_update policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_budget_targets'
      AND policyname = 'money_budget_targets_delete'
  ),
  'money_budget_targets_delete policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transfer_self_aliases'
      AND policyname = 'money_transfer_self_aliases_select'
  ),
  'money_transfer_self_aliases_select policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transfer_self_aliases'
      AND policyname = 'money_transfer_self_aliases_insert'
  ),
  'money_transfer_self_aliases_insert policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transfer_self_aliases'
      AND policyname = 'money_transfer_self_aliases_update'
  ),
  'money_transfer_self_aliases_update policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transfer_self_aliases'
      AND policyname = 'money_transfer_self_aliases_delete'
  ),
  'money_transfer_self_aliases_delete policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_fx_rates'
      AND policyname = 'money_fx_rates_select'
  ),
  'money_fx_rates_select policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_fx_rates'
      AND policyname = 'money_fx_rates_insert'
  ),
  'money_fx_rates_insert policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_fx_rates'
      AND policyname = 'money_fx_rates_update'
  ),
  'money_fx_rates_update policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_fx_rates'
      AND policyname = 'money_fx_rates_delete'
  ),
  'money_fx_rates_delete policy exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('7a000000-0000-0000-0000-000000000001', 'money-budget-rls@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('7a000000-0000-0000-0000-000000000001', 'money-budget-rls@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('7a000000-0000-0000-0000-000000000010', 'Money Budget RLS Person', 'human');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-budget-rls@example.com', true);
SELECT set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000001', true);

SELECT lives_ok(
  $$
    INSERT INTO public.money_budget_targets (
      id,
      person_id,
      category_id,
      month_start,
      target_amount,
      currency
    )
    VALUES (
      '7a000000-0000-0000-0000-000000000101',
      '7a000000-0000-0000-0000-000000000010',
      (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1),
      '2026-03-01',
      -1500,
      'RUB'
    )
  $$,
  'authenticated allowlisted users can insert money budget targets'
);

SELECT lives_ok(
  $$
    INSERT INTO public.money_transfer_self_aliases (
      id,
      person_id,
      alias,
      normalized_alias
    )
    VALUES (
      '7a000000-0000-0000-0000-000000000102',
      '7a000000-0000-0000-0000-000000000010',
      'Подрешетников М',
      'placeholder'
    )
  $$,
  'authenticated allowlisted users can insert self-transfer aliases'
);

SELECT lives_ok(
  $$
    INSERT INTO public.money_fx_rates (
      rate_date,
      base_currency,
      quote_currency,
      rate
    ) VALUES (
      '2026-03-20',
      'USD',
      'RUB',
      91
    )
  $$,
  'authenticated allowlisted users can insert fx rates'
);

SELECT lives_ok(
  $$
    UPDATE public.money_budget_targets
    SET target_amount = -1600
    WHERE id = '7a000000-0000-0000-0000-000000000101'
  $$,
  'authenticated allowlisted users can update money budget targets'
);

SELECT lives_ok(
  $$
    UPDATE public.money_transfer_self_aliases
    SET alias = 'Подрешетников М.'
    WHERE id = '7a000000-0000-0000-0000-000000000102'
  $$,
  'authenticated allowlisted users can update self-transfer aliases'
);

SELECT lives_ok(
  $$
    UPDATE public.money_fx_rates
    SET rate = 92
    WHERE rate_date = '2026-03-01'
      AND base_currency = 'USD'
      AND quote_currency = 'RUB'
  $$,
  'authenticated allowlisted users can update fx rates'
);

SELECT lives_ok(
  $$
    DELETE FROM public.money_budget_targets
    WHERE id = '7a000000-0000-0000-0000-000000000101'
  $$,
  'authenticated allowlisted users can delete money budget targets'
);

SELECT lives_ok(
  $$
    DELETE FROM public.money_transfer_self_aliases
    WHERE id = '7a000000-0000-0000-0000-000000000102'
  $$,
  'authenticated allowlisted users can delete self-transfer aliases'
);

SELECT lives_ok(
  $$
    DELETE FROM public.money_fx_rates
    WHERE rate_date = '2026-03-01'
      AND base_currency = 'USD'
      AND quote_currency = 'RUB'
  $$,
  'authenticated allowlisted users can delete fx rates'
);

SELECT * FROM finish();
ROLLBACK;

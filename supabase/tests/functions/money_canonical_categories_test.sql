BEGIN;
SELECT plan(15);

SELECT has_function('public', 'money_seed_canonical_categories', ARRAY[]::text[]);

SELECT function_returns(
  'public',
  'money_seed_canonical_categories',
  ARRAY[]::text[],
  'void'
);

SELECT is(
  (SELECT count(*) FROM public.money_categories WHERE category_kind = 'canonical'),
  21::bigint,
  'canonical category seed creates the full built-in taxonomy'
);

SELECT is(
  (
    SELECT string_agg(system_key, ',' ORDER BY sort_order)
    FROM public.money_categories
    WHERE category_kind = 'canonical'
  ),
  'income,transfers,housing,utilities,food,transport,shopping,health,education,entertainment,travel,family,pets,services_fees,gifts_donations,taxes,savings_investments,business,other,uncategorized,needs_review',
  'canonical category system keys are stable and ordered'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_categories
    WHERE category_kind = 'canonical'
      AND canonical_category_id = id
      AND parent_id IS NULL
      AND system_key IS NOT NULL
  ),
  21::bigint,
  'canonical category rows self-reference their canonical branch and have no parent'
);

SELECT lives_ok(
  $$SELECT public.money_seed_canonical_categories()$$,
  'canonical category repair function is idempotent'
);

SELECT is(
  (SELECT count(*) FROM public.money_categories WHERE category_kind = 'canonical'),
  21::bigint,
  'rerunning canonical category repair does not duplicate rows'
);

SELECT throws_ok(
  $$DELETE FROM public.money_categories WHERE system_key = 'food'$$,
  'Canonical categories cannot be deleted',
  'canonical categories are undeletable'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_categories (
      depth,
      name_ru,
      name_en,
      slug,
      category_kind
    ) VALUES (
      1,
      'Bad branch',
      'Bad branch',
      'bad-branch',
      'custom'
    )
  $$,
  'Custom categories must reference a canonical category',
  'custom categories require a canonical branch reference'
);

SELECT lives_ok(
  $$
    INSERT INTO public.money_categories (
      id,
      parent_id,
      canonical_category_id,
      category_kind,
      depth,
      name_ru,
      name_en,
      slug
    )
    SELECT
      '55000000-0000-4000-8000-000000000001',
      canonical.id,
      canonical.id,
      'custom',
      2,
      'Чай',
      'Tea',
      'tea'
    FROM public.money_categories AS canonical
    WHERE canonical.system_key = 'food'
  $$,
  'custom categories can be created directly beneath canonical branches'
);

SELECT is(
  (SELECT depth FROM public.money_categories WHERE id = '55000000-0000-4000-8000-000000000001'),
  2,
  'custom categories under canonical parents are stored at depth 2'
);

INSERT INTO public.money_categories (
  id,
  parent_id,
  canonical_category_id,
  category_kind,
  depth,
  name_ru,
  name_en,
  slug
)
SELECT
  '55000000-0000-4000-8000-000000000010',
  NULL,
  canonical.id,
  'custom',
  1,
  'Продукты',
  'Groceries',
  'groceries-branch-switch-test'
FROM public.money_categories AS canonical
WHERE canonical.system_key = 'food';

INSERT INTO public.money_categories (
  id,
  parent_id,
  canonical_category_id,
  category_kind,
  depth,
  name_ru,
  name_en,
  slug
)
VALUES (
  '55000000-0000-4000-8000-000000000011',
  '55000000-0000-4000-8000-000000000010',
  (SELECT canonical_category_id FROM public.money_categories WHERE id = '55000000-0000-4000-8000-000000000010'),
  'custom',
  2,
  'Фрукты',
  'Fruit',
  'fruit'
);

SELECT throws_ok(
  $$
    UPDATE public.money_categories
    SET canonical_category_id = (SELECT id FROM public.money_categories WHERE system_key = 'transport')
    WHERE id = '55000000-0000-4000-8000-000000000010'
  $$,
  'Cannot move a custom category with descendants to another canonical branch',
  'custom categories with descendants cannot switch canonical branches'
);

SELECT throws_ok(
  $$
    UPDATE public.money_categories
    SET
      category_kind = 'canonical',
      system_key = 'rogue_canonical',
      canonical_category_id = id
    WHERE id = '55000000-0000-4000-8000-000000000010'
  $$,
  'Custom categories cannot be promoted to canonical',
  'custom categories cannot be promoted into the canonical taxonomy'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_categories (
      id,
      parent_id,
      canonical_category_id,
      category_kind,
      system_key,
      sort_order,
      depth,
      name_ru,
      name_en,
      slug
    ) VALUES (
      '55000000-0000-4000-8000-000000000020',
      NULL,
      '55000000-0000-4000-8000-000000000020',
      'canonical',
      'rogue_canonical',
      999,
      1,
      'Лишнее',
      'Rogue',
      'rogue-canonical'
    )
  $$,
  'Canonical categories must use a shipped system_key',
  'canonical categories are restricted to the shipped taxonomy keys'
);

INSERT INTO public.persons (id, name, kind)
VALUES ('55000000-0000-4000-8000-000000000100', 'Category User', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '55000000-0000-4000-8000-000000000101',
  '55000000-0000-4000-8000-000000000100',
  'manual',
  'debit',
  'Category Account',
  'RUB'
);

INSERT INTO public.money_transactions (
  id,
  payer_person_id,
  account_id,
  source,
  posted_at,
  amount,
  currency,
  transaction_type,
  status,
  merchant_name
)
VALUES (
  '55000000-0000-4000-8000-000000000102',
  '55000000-0000-4000-8000-000000000100',
  '55000000-0000-4000-8000-000000000101',
  'manual',
  now(),
  100,
  'RUB',
  'expense',
  'posted',
  'Category Merchant'
);

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  category_id
)
VALUES (
  '55000000-0000-4000-8000-000000000103',
  '55000000-0000-4000-8000-000000000102',
  'Referenced category',
  100,
  '55000000-0000-4000-8000-000000000010'
);

SELECT throws_ok(
  $$DELETE FROM public.money_categories WHERE id = '55000000-0000-4000-8000-000000000010'$$,
  'Cannot delete a money category that is still in use',
  'referenced custom categories cannot be deleted'
);

SELECT * FROM finish();
ROLLBACK;

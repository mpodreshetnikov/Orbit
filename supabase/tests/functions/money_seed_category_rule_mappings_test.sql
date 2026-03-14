BEGIN;
SELECT plan(33);

SELECT has_function('public', 'money_seed_category_rule_mappings', ARRAY[]::text[]);

SELECT function_returns(
  'public',
  'money_seed_category_rule_mappings',
  ARRAY[]::text[],
  'void'
);

SELECT lives_ok(
  $$SELECT public.money_seed_category_rule_mappings()$$,
  'money_seed_category_rule_mappings seeds the conservative built-in catalog'
);

SELECT is(
  (SELECT count(*) FROM public.money_mcc_canonical_category_map),
  79::bigint,
  'MCC seed covers the expanded built-in catalog'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '0001'
  ),
  'transfers',
  '0001 maps to transfers'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '0004'
  ),
  'utilities',
  '0004 maps to utilities'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '0014'
  ),
  'utilities',
  '0014 maps to utilities'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '3991'
  ),
  'food',
  '3991 maps to food'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '4215'
  ),
  'services_fees',
  '4215 maps to services and fees'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5193'
  ),
  'gifts_donations',
  '5193 maps to gifts and donations'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5818'
  ),
  'entertainment',
  '5818 maps to entertainment'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '8299'
  ),
  'education',
  '8299 maps to education'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5411'
  ),
  'food',
  '5411 maps to food'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5542'
  ),
  'transport',
  '5542 maps to transport'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '6513'
  ),
  'housing',
  '6513 maps to housing'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5912'
  ),
  'health',
  '5912 maps to health'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '8211'
  ),
  'education',
  '8211 maps to education'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '7832'
  ),
  'entertainment',
  '7832 maps to entertainment'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '7011'
  ),
  'travel',
  '7011 maps to travel'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5311'
  ),
  'shopping',
  '5311 maps to shopping'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '0742'
  ),
  'pets',
  '0742 maps to pets'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '8351'
  ),
  'family',
  '8351 maps to family'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '8398'
  ),
  'gifts_donations',
  '8398 maps to gifts and donations'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '4829'
  ),
  'transfers',
  '4829 maps to transfers'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '6211'
  ),
  'savings_investments',
  '6211 maps to savings and investments'
);

SELECT is(
  (
    SELECT canonical_system_key
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '9311'
  ),
  'taxes',
  '9311 maps to taxes'
);

UPDATE public.money_mcc_canonical_category_map
SET canonical_category_id = NULL
WHERE mcc IN ('5411', '5542', '6513', '5912');

SELECT lives_ok(
  $$SELECT public.money_seed_category_rule_mappings()$$,
  'money_seed_category_rule_mappings reruns cleanly'
);

SELECT is(
  (
    SELECT canonical_category_id
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5411'
  ),
  (SELECT id FROM public.money_categories WHERE system_key = 'food'),
  '5411 canonical_category_id is repaired to food'
);

SELECT is(
  (
    SELECT canonical_category_id
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5542'
  ),
  (SELECT id FROM public.money_categories WHERE system_key = 'transport'),
  '5542 canonical_category_id is repaired to transport'
);

SELECT is(
  (
    SELECT canonical_category_id
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '6513'
  ),
  (SELECT id FROM public.money_categories WHERE system_key = 'housing'),
  '6513 canonical_category_id is repaired to housing'
);

SELECT is(
  (
    SELECT canonical_category_id
    FROM public.money_mcc_canonical_category_map
    WHERE mcc = '5912'
  ),
  (SELECT id FROM public.money_categories WHERE system_key = 'health'),
  '5912 canonical_category_id is repaired to health'
);

SELECT is(
  (SELECT count(*) FROM public.money_mcc_canonical_category_map),
  79::bigint,
  'rerunning the seed does not duplicate MCC rows'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.money_mcc_canonical_category_map
    WHERE mcc IN ('0000', '5999', '6012', '6051', '6300', '7298', '7997')
  ),
  'ambiguous catch-all MCCs remain intentionally unmapped'
);

SELECT * FROM finish();
ROLLBACK;

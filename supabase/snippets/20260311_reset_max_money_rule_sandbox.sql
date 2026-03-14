-- Reset Max's money transactions and rebuild a compact fixture set for
-- manual category rule testing without re-running a full import.
--
-- Intended usage:
-- 1. Run locally in Supabase Studio SQL editor or psql against the local DB.
-- 2. Open /money/rules and use the printed transaction/line_item IDs.
--
-- What this script does:
-- - deletes all existing money transactions for person "Max"
-- - recreates two stable sandbox accounts (tbank debit + cash)
-- - seeds a few MCC/source-category canonical mappings
-- - inserts a deterministic transaction set that covers common rule cases
--
-- Covered scenarios:
-- - direct merchant/title rules
-- - MCC map rules
-- - source category map rules
-- - merchant history rules
-- - line item history rules
-- - manual lock / manual assignment edge cases
-- - pending, refund, transfer, fee, cash-account flows

BEGIN;

DO $$
DECLARE
  v_main_person_id uuid;

  v_food uuid;
  v_transport uuid;
  v_health uuid;
  v_utilities uuid;
  v_shopping uuid;
  v_entertainment uuid;
  v_income uuid;

  v_groceries uuid;
  v_restaurants uuid;
  v_taxi uuid;
  v_salary uuid;
  v_pharmacy uuid;

  v_acc_tbank uuid := '51000000-0000-4000-8000-000000000001';
  v_acc_cash uuid := '51000000-0000-4000-8000-000000000002';
  v_card_tbank uuid := '52000000-0000-4000-8000-000000000001';
BEGIN
  SELECT id
  INTO v_main_person_id
  FROM public.persons
  WHERE name = 'Max'
  LIMIT 1;

  IF v_main_person_id IS NULL THEN
    RAISE EXCEPTION 'Person "Max" was not found. Seed the local DB first.';
  END IF;

  SELECT id INTO v_food FROM public.money_categories WHERE system_key = 'food';
  SELECT id INTO v_transport FROM public.money_categories WHERE system_key = 'transport';
  SELECT id INTO v_health FROM public.money_categories WHERE system_key = 'health';
  SELECT id INTO v_utilities FROM public.money_categories WHERE system_key = 'utilities';
  SELECT id INTO v_shopping FROM public.money_categories WHERE system_key = 'shopping';
  SELECT id INTO v_entertainment FROM public.money_categories WHERE system_key = 'entertainment';
  SELECT id INTO v_income FROM public.money_categories WHERE system_key = 'income';

  IF v_food IS NULL
    OR v_transport IS NULL
    OR v_health IS NULL
    OR v_utilities IS NULL
    OR v_shopping IS NULL
    OR v_entertainment IS NULL
    OR v_income IS NULL THEN
    RAISE EXCEPTION 'One or more canonical money categories are missing.';
  END IF;

  SELECT COALESCE(
    (SELECT id FROM public.money_categories WHERE slug = 'groceries' LIMIT 1),
    v_food
  ) INTO v_groceries;

  SELECT COALESCE(
    (SELECT id FROM public.money_categories WHERE slug = 'restaurants' LIMIT 1),
    v_food
  ) INTO v_restaurants;

  SELECT COALESCE(
    (SELECT id FROM public.money_categories WHERE slug = 'taxi' LIMIT 1),
    v_transport
  ) INTO v_taxi;

  SELECT COALESCE(
    (SELECT id FROM public.money_categories WHERE slug = 'salary' LIMIT 1),
    v_income
  ) INTO v_salary;

  SELECT COALESCE(
    (SELECT id FROM public.money_categories WHERE slug = 'pharmacy' LIMIT 1),
    v_health
  ) INTO v_pharmacy;

  -- Delete Max's transaction history only. Cascades handle line items and rule runs.
  DELETE FROM public.money_transactions
  WHERE payer_person_id = v_main_person_id;

  -- Ensure stable sandbox accounts exist.
  INSERT INTO public.money_accounts (
    id,
    owner_person_id,
    source,
    account_kind,
    account_label,
    currency,
    external_account_id,
    is_active
  )
  VALUES
    (v_acc_tbank, v_main_person_id, 'tbank', 'debit', 'Rule Sandbox Tbank', 'RUB', 'sandbox-tbank-main', true),
    (v_acc_cash, v_main_person_id, 'manual', 'cash', 'Rule Sandbox Cash', 'RUB', 'sandbox-cash-main', true)
  ON CONFLICT (id) DO UPDATE
  SET
    owner_person_id = EXCLUDED.owner_person_id,
    source = EXCLUDED.source,
    account_kind = EXCLUDED.account_kind,
    account_label = EXCLUDED.account_label,
    currency = EXCLUDED.currency,
    external_account_id = EXCLUDED.external_account_id,
    is_active = EXCLUDED.is_active;

  INSERT INTO public.money_cards (
    id,
    account_id,
    last4,
    card_label
  )
  VALUES (
    v_card_tbank,
    v_acc_tbank,
    '4242',
    'Rule Sandbox Card'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    account_id = EXCLUDED.account_id,
    last4 = EXCLUDED.last4,
    card_label = EXCLUDED.card_label;

  -- Reset only the mappings used by this fixture.
  DELETE FROM public.money_mcc_canonical_category_map
  WHERE mcc IN ('4121', '4900', '5411', '5812', '5912');

  INSERT INTO public.money_mcc_canonical_category_map (
    mcc,
    canonical_system_key,
    canonical_category_id,
    description
  )
  VALUES
    ('4121', 'transport', v_transport, 'Taxi / ride-hailing'),
    ('4900', 'utilities', v_utilities, 'Utilities'),
    ('5411', 'food', v_food, 'Groceries / supermarkets'),
    ('5812', 'food', v_food, 'Restaurants / cafes'),
    ('5912', 'health', v_health, 'Pharmacy')
  ON CONFLICT (mcc) DO UPDATE
  SET
    canonical_system_key = EXCLUDED.canonical_system_key,
    canonical_category_id = EXCLUDED.canonical_category_id,
    description = EXCLUDED.description;

  IF to_regclass('public.money_source_category_canonical_map') IS NOT NULL THEN
    DELETE FROM public.money_source_category_canonical_map
    WHERE source = 'tbank'
      AND source_category_id IN (
        'bank-cafes',
        'bank-groceries',
        'bank-health',
        'bank-market',
        'bank-utilities'
      );

    INSERT INTO public.money_source_category_canonical_map (
      id,
      source,
      source_category_id,
      source_category_name,
      source_category_name_normalized,
      canonical_system_key,
      canonical_category_id
    )
    VALUES
      (
        '53000000-0000-4000-8000-000000000001',
        'tbank',
        'bank-cafes',
        'Restaurants and cafes',
        'restaurants and cafes',
        'food',
        v_food
      ),
      (
        '53000000-0000-4000-8000-000000000002',
        'tbank',
        'bank-groceries',
        'Groceries and supermarkets',
        'groceries and supermarkets',
        'food',
        v_food
      ),
      (
        '53000000-0000-4000-8000-000000000003',
        'tbank',
        'bank-health',
        'Pharmacies',
        'pharmacies',
        'health',
        v_health
      ),
      (
        '53000000-0000-4000-8000-000000000004',
        'tbank',
        'bank-market',
        'Marketplaces',
        'marketplaces',
        'shopping',
        v_shopping
      ),
      (
        '53000000-0000-4000-8000-000000000005',
        'tbank',
        'bank-utilities',
        'Utilities',
        'utilities',
        'utilities',
        v_utilities
      )
    ON CONFLICT (id) DO UPDATE
    SET
      source = EXCLUDED.source,
      source_category_id = EXCLUDED.source_category_id,
      source_category_name = EXCLUDED.source_category_name,
      source_category_name_normalized = EXCLUDED.source_category_name_normalized,
      canonical_system_key = EXCLUDED.canonical_system_key,
      canonical_category_id = EXCLUDED.canonical_category_id;
  ELSE
    RAISE NOTICE
      'Skipping source-category sandbox seed because public.money_source_category_canonical_map does not exist in this database.';
  END IF;

  INSERT INTO public.money_transactions (
    id,
    payer_person_id,
    account_id,
    card_id,
    source,
    external_id,
    posted_at,
    amount,
    currency,
    transaction_type,
    status,
    merchant_name,
    mcc,
    comment,
    source_comment,
    source_category_id,
    source_category_name,
    is_transfer,
    transfer_group_id,
    raw_payload
  )
  VALUES
    (
      '54000000-0000-4000-8000-000000000001',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-salary-001',
      '2026-03-01T09:00:00+07',
      185000,
      'RUB',
      'income',
      'posted',
      'Employer LLC',
      NULL,
      'Salary payment',
      NULL,
      NULL,
      NULL,
      false,
      NULL,
      '{"scenario":"salary_anchor"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000002',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-grocery-anchor-001',
      '2026-03-02T18:05:00+07',
      -790,
      'RUB',
      'expense',
      'posted',
      'Perekrestok',
      '5411',
      'Groceries anchor',
      'Receipt parsed normally',
      'bank-groceries',
      'Groceries and supermarkets',
      false,
      NULL,
      '{"scenario":"merchant_and_line_history_anchor"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000003',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-coffee-anchor-001',
      '2026-03-03T08:40:00+07',
      -340,
      'RUB',
      'expense',
      'posted',
      'Skuratov Coffee',
      '5812',
      'Coffee anchor',
      'Morning coffee',
      'bank-cafes',
      'Restaurants and cafes',
      false,
      NULL,
      '{"scenario":"merchant_history_anchor"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000004',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-taxi-001',
      '2026-03-03T22:10:00+07',
      -610,
      'RUB',
      'expense',
      'posted',
      'Yandex Go',
      '4121',
      'Late ride home',
      'Taxi from center',
      NULL,
      NULL,
      false,
      NULL,
      '{"scenario":"mcc_map_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000005',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-grocery-candidate-001',
      '2026-03-04T19:20:00+07',
      -860,
      'RUB',
      'expense',
      'posted',
      'VkusVill',
      '5411',
      'Direct groceries candidate',
      'Evening groceries',
      'bank-groceries',
      'Groceries and supermarkets',
      false,
      NULL,
      '{"scenario":"source_category_map_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000006',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-coffee-candidate-001',
      '2026-03-05T09:05:00+07',
      -360,
      'RUB',
      'expense',
      'posted',
      'Skuratov Coffee',
      '5812',
      'Merchant/title history candidate',
      'Morning coffee repeat',
      'bank-cafes',
      'Restaurants and cafes',
      false,
      NULL,
      '{"scenario":"merchant_title_history_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000007',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-pharmacy-001',
      '2026-03-05T20:15:00+07',
      -1180,
      'RUB',
      'expense',
      'posted',
      'Apteka.ru',
      '5912',
      'Pharmacy purchase',
      'Ibuprofen and vitamins',
      'bank-health',
      'Pharmacies',
      false,
      NULL,
      '{"scenario":"health_rule_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000008',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-utilities-001',
      '2026-03-06T11:30:00+07',
      -4200,
      'RUB',
      'expense',
      'posted',
      'Mosenergosbyt',
      '4900',
      'Apartment utilities for March',
      'Utilities autopay',
      'bank-utilities',
      'Utilities',
      false,
      NULL,
      '{"scenario":"comment_source_comment_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000009',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-marketplace-001',
      '2026-03-07T13:50:00+07',
      -1490,
      'RUB',
      'expense',
      'posted',
      'Wildberries',
      NULL,
      'Marketplace purchase',
      'Household order',
      'bank-market',
      'Marketplaces',
      false,
      NULL,
      '{"scenario":"shopping_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000010',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-steam-pending-001',
      '2026-03-07T23:10:00+07',
      -1999,
      'RUB',
      'expense',
      'pending',
      'Steam',
      '5816',
      'Pending game purchase',
      'Pending authorization',
      NULL,
      NULL,
      false,
      NULL,
      '{"scenario":"pending_entertainment"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000011',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-transfer-001',
      '2026-03-08T10:00:00+07',
      -5000,
      'RUB',
      'transfer',
      'posted',
      NULL,
      NULL,
      'Transfer to cash wallet',
      'Internal transfer',
      NULL,
      NULL,
      true,
      '55000000-0000-4000-8000-000000000001',
      '{"scenario":"transfer_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000012',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-refund-001',
      '2026-03-08T16:20:00+07',
      1290,
      'RUB',
      'refund',
      'posted',
      'Ozon',
      NULL,
      'Refund for cancelled order',
      'Refund completed',
      'bank-market',
      'Marketplaces',
      false,
      NULL,
      '{"scenario":"refund_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000013',
      v_main_person_id,
      v_acc_cash,
      NULL,
      'manual',
      'sandbox-cash-coffee-001',
      '2026-03-09T08:15:00+07',
      -250,
      'RUB',
      'expense',
      'posted',
      'Coffee Point',
      NULL,
      'Cash coffee',
      NULL,
      NULL,
      NULL,
      false,
      NULL,
      '{"scenario":"cash_account_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000014',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-split-receipt-001',
      '2026-03-09T19:05:00+07',
      -1190,
      'RUB',
      'expense',
      'posted',
      'Perekrestok',
      '5411',
      'Split grocery receipt',
      'Mixed grocery basket',
      'bank-groceries',
      'Groceries and supermarkets',
      false,
      NULL,
      '{"scenario":"split_line_items_candidate"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000015',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-locked-taxi-001',
      '2026-03-10T21:40:00+07',
      -720,
      'RUB',
      'expense',
      'posted',
      'Citymobil',
      '4121',
      'Locked manual taxi category',
      'Do not overwrite unless forced',
      NULL,
      NULL,
      false,
      NULL,
      '{"scenario":"locked_manual_category"}'::jsonb
    ),
    (
      '54000000-0000-4000-8000-000000000016',
      v_main_person_id,
      v_acc_tbank,
      v_card_tbank,
      'tbank',
      'sandbox-fallback-001',
      '2026-03-10T22:05:00+07',
      -99,
      'RUB',
      'fee',
      'posted',
      NULL,
      NULL,
      'Service charge',
      NULL,
      NULL,
      NULL,
      false,
      NULL,
      '{"scenario":"fallback_candidate"}'::jsonb
    );

  INSERT INTO public.money_line_items (
    id,
    transaction_id,
    title,
    amount,
    line_status,
    category_id,
    beneficiary_person_id,
    assignment_method,
    category_locked_by_user,
    category_assigned_at,
    raw_payload
  )
  VALUES
    (
      '56000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001',
      'Salary March 2026',
      185000,
      'final',
      v_salary,
      v_main_person_id,
      'manual',
      false,
      '2026-03-01T09:00:00+07',
      '{"scenario":"salary_anchor"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000002',
      '54000000-0000-4000-8000-000000000002',
      'Bananas',
      790,
      'final',
      v_groceries,
      v_main_person_id,
      'manual',
      false,
      '2026-03-02T18:05:00+07',
      '{"scenario":"line_history_anchor"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000003',
      '54000000-0000-4000-8000-000000000003',
      'Latte 300ml',
      340,
      'final',
      v_restaurants,
      v_main_person_id,
      'manual',
      false,
      '2026-03-03T08:40:00+07',
      '{"scenario":"merchant_history_anchor"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000004',
      '54000000-0000-4000-8000-000000000004',
      'Airport taxi',
      610,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"mcc_map_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000005',
      '54000000-0000-4000-8000-000000000005',
      'Greek yogurt',
      860,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"source_category_map_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000006',
      '54000000-0000-4000-8000-000000000006',
      'Latte 300ml',
      360,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"merchant_title_history_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000007',
      '54000000-0000-4000-8000-000000000007',
      'Ibuprofen',
      1180,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"health_rule_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000008',
      '54000000-0000-4000-8000-000000000008',
      'Utilities March',
      4200,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"comment_source_comment_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000009',
      '54000000-0000-4000-8000-000000000009',
      'Phone case',
      1490,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"shopping_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000010',
      '54000000-0000-4000-8000-000000000010',
      'Game purchase',
      1999,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"pending_entertainment"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000011',
      '54000000-0000-4000-8000-000000000011',
      'Transfer to cash',
      5000,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"transfer_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000012',
      '54000000-0000-4000-8000-000000000012',
      'Refund for cancelled order',
      1290,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"refund_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000013',
      '54000000-0000-4000-8000-000000000013',
      'Americano',
      250,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"cash_account_candidate"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000014',
      '54000000-0000-4000-8000-000000000014',
      'Bananas',
      320,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"split_line_bananas"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000015',
      '54000000-0000-4000-8000-000000000014',
      'Sparkling water',
      210,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"split_line_water"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000016',
      '54000000-0000-4000-8000-000000000014',
      'Dish soap',
      660,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"split_line_household"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000017',
      '54000000-0000-4000-8000-000000000015',
      'Evening taxi',
      720,
      'final',
      v_taxi,
      v_main_person_id,
      'manual',
      true,
      '2026-03-10T21:40:00+07',
      '{"scenario":"locked_manual_category"}'::jsonb
    ),
    (
      '56000000-0000-4000-8000-000000000018',
      '54000000-0000-4000-8000-000000000016',
      'Service charge',
      99,
      'final',
      NULL,
      v_main_person_id,
      'import',
      false,
      NULL,
      '{"scenario":"fallback_candidate"}'::jsonb
    );
END $$;

COMMIT;

SELECT
  tx.posted_at,
  tx.id AS transaction_id,
  li.id AS line_item_id,
  COALESCE(tx.merchant_name, '(no merchant)') AS merchant,
  li.title,
  tx.transaction_type,
  tx.status,
  tx.mcc,
  tx.source_category_name,
  li.assignment_method,
  li.category_locked_by_user,
  cat.name_en AS current_category
FROM public.money_transactions AS tx
JOIN public.money_line_items AS li
  ON li.transaction_id = tx.id
LEFT JOIN public.money_categories AS cat
  ON cat.id = li.category_id
WHERE tx.external_id LIKE 'sandbox-%'
ORDER BY tx.posted_at, li.created_at, li.id;

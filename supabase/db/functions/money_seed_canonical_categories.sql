-- Function: money_seed_canonical_categories()
-- Ensures the built-in canonical money category taxonomy exists and stays repaired.
CREATE OR REPLACE FUNCTION public.money_seed_canonical_categories()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.money_categories (
    id,
    parent_id,
    depth,
    name_ru,
    name_en,
    slug,
    category_kind,
    system_key,
    canonical_category_id,
    sort_order,
    created_by,
    archived_at
  )
  VALUES
    ('44000001-0000-4000-8000-000000000001', NULL, 1, 'Доход', 'Income', 'canonical-income', 'canonical', 'income', '44000001-0000-4000-8000-000000000001', 1, NULL, NULL),
    ('44000001-0000-4000-8000-000000000002', NULL, 1, 'Переводы', 'Transfers', 'canonical-transfers', 'canonical', 'transfers', '44000001-0000-4000-8000-000000000002', 2, NULL, NULL),
    ('44000001-0000-4000-8000-000000000003', NULL, 1, 'Жилье', 'Housing', 'canonical-housing', 'canonical', 'housing', '44000001-0000-4000-8000-000000000003', 3, NULL, NULL),
    ('44000001-0000-4000-8000-000000000004', NULL, 1, 'Коммунальные услуги', 'Utilities', 'canonical-utilities', 'canonical', 'utilities', '44000001-0000-4000-8000-000000000004', 4, NULL, NULL),
    ('44000001-0000-4000-8000-000000000005', NULL, 1, 'Еда', 'Food', 'canonical-food', 'canonical', 'food', '44000001-0000-4000-8000-000000000005', 5, NULL, NULL),
    ('44000001-0000-4000-8000-000000000006', NULL, 1, 'Транспорт', 'Transport', 'canonical-transport', 'canonical', 'transport', '44000001-0000-4000-8000-000000000006', 6, NULL, NULL),
    ('44000001-0000-4000-8000-000000000007', NULL, 1, 'Покупки', 'Shopping', 'canonical-shopping', 'canonical', 'shopping', '44000001-0000-4000-8000-000000000007', 7, NULL, NULL),
    ('44000001-0000-4000-8000-000000000008', NULL, 1, 'Здоровье', 'Health', 'canonical-health', 'canonical', 'health', '44000001-0000-4000-8000-000000000008', 8, NULL, NULL),
    ('44000001-0000-4000-8000-000000000009', NULL, 1, 'Образование', 'Education', 'canonical-education', 'canonical', 'education', '44000001-0000-4000-8000-000000000009', 9, NULL, NULL),
    ('44000001-0000-4000-8000-00000000000a', NULL, 1, 'Развлечения', 'Entertainment', 'canonical-entertainment', 'canonical', 'entertainment', '44000001-0000-4000-8000-00000000000a', 10, NULL, NULL),
    ('44000001-0000-4000-8000-00000000000b', NULL, 1, 'Путешествия', 'Travel', 'canonical-travel', 'canonical', 'travel', '44000001-0000-4000-8000-00000000000b', 11, NULL, NULL),
    ('44000001-0000-4000-8000-00000000000c', NULL, 1, 'Семья', 'Family', 'canonical-family', 'canonical', 'family', '44000001-0000-4000-8000-00000000000c', 12, NULL, NULL),
    ('44000001-0000-4000-8000-00000000000d', NULL, 1, 'Питомцы', 'Pets', 'canonical-pets', 'canonical', 'pets', '44000001-0000-4000-8000-00000000000d', 13, NULL, NULL),
    ('44000001-0000-4000-8000-00000000000e', NULL, 1, 'Сервисы и комиссии', 'Services & Fees', 'canonical-services-fees', 'canonical', 'services_fees', '44000001-0000-4000-8000-00000000000e', 14, NULL, NULL),
    ('44000001-0000-4000-8000-00000000000f', NULL, 1, 'Подарки и пожертвования', 'Gifts & Donations', 'canonical-gifts-donations', 'canonical', 'gifts_donations', '44000001-0000-4000-8000-00000000000f', 15, NULL, NULL),
    ('44000001-0000-4000-8000-000000000010', NULL, 1, 'Налоги', 'Taxes', 'canonical-taxes', 'canonical', 'taxes', '44000001-0000-4000-8000-000000000010', 16, NULL, NULL),
    ('44000001-0000-4000-8000-000000000011', NULL, 1, 'Сбережения и инвестиции', 'Savings & Investments', 'canonical-savings-investments', 'canonical', 'savings_investments', '44000001-0000-4000-8000-000000000011', 17, NULL, NULL),
    ('44000001-0000-4000-8000-000000000012', NULL, 1, 'Бизнес', 'Business', 'canonical-business', 'canonical', 'business', '44000001-0000-4000-8000-000000000012', 18, NULL, NULL),
    ('44000001-0000-4000-8000-000000000013', NULL, 1, 'Другое', 'Other', 'canonical-other', 'canonical', 'other', '44000001-0000-4000-8000-000000000013', 19, NULL, NULL),
    ('44000001-0000-4000-8000-000000000014', NULL, 1, 'Без категории', 'Uncategorized', 'canonical-uncategorized', 'canonical', 'uncategorized', '44000001-0000-4000-8000-000000000014', 20, NULL, NULL),
    ('44000001-0000-4000-8000-000000000015', NULL, 1, 'Нужна проверка', 'Needs Review', 'canonical-needs-review', 'canonical', 'needs_review', '44000001-0000-4000-8000-000000000015', 21, NULL, NULL)
  ON CONFLICT (id) DO UPDATE
  SET
    parent_id = NULL,
    depth = 1,
    name_ru = EXCLUDED.name_ru,
    name_en = EXCLUDED.name_en,
    slug = EXCLUDED.slug,
    category_kind = 'canonical',
    system_key = EXCLUDED.system_key,
    canonical_category_id = EXCLUDED.canonical_category_id,
    sort_order = EXCLUDED.sort_order,
    archived_at = NULL,
    created_by = NULL;

  UPDATE public.money_categories
  SET
    canonical_category_id = id,
    parent_id = NULL,
    depth = 1,
    archived_at = NULL,
    created_by = NULL
  WHERE category_kind = 'canonical'
    AND (
      canonical_category_id IS DISTINCT FROM id
      OR parent_id IS NOT NULL
      OR depth <> 1
      OR archived_at IS NOT NULL
      OR created_by IS NOT NULL
    );
END;
$$;

COMMENT ON FUNCTION public.money_seed_canonical_categories() IS
  'Ensures the built-in flat canonical money category taxonomy exists and repairs drift by stable canonical ids.';

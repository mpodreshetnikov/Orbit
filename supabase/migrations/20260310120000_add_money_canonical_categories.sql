-- ============================================================================
-- Money canonical categories foundation
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_category_kind') THEN
    CREATE TYPE public.money_category_kind AS ENUM (
      'canonical',
      'custom'
    );
  END IF;
END $$;

ALTER TABLE public.money_categories
  ADD COLUMN IF NOT EXISTS category_kind public.money_category_kind,
  ADD COLUMN IF NOT EXISTS system_key text,
  ADD COLUMN IF NOT EXISTS canonical_category_id uuid,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.money_categories
SET
  category_kind = 'custom'::public.money_category_kind,
  system_key = NULL,
  sort_order = 0
WHERE category_kind IS NULL;

INSERT INTO public.money_categories (
  id,
  parent_id,
  depth,
  name_ru,
  name_en,
  slug,
  archived_at,
  category_kind,
  system_key,
  canonical_category_id,
  sort_order,
  created_by
)
VALUES
  ('44000001-0000-4000-8000-000000000001', NULL, 1, 'Доход', 'Income', 'canonical-income', NULL, 'canonical', 'income', '44000001-0000-4000-8000-000000000001', 1, NULL),
  ('44000001-0000-4000-8000-000000000002', NULL, 1, 'Переводы', 'Transfers', 'canonical-transfers', NULL, 'canonical', 'transfers', '44000001-0000-4000-8000-000000000002', 2, NULL),
  ('44000001-0000-4000-8000-000000000003', NULL, 1, 'Жилье', 'Housing', 'canonical-housing', NULL, 'canonical', 'housing', '44000001-0000-4000-8000-000000000003', 3, NULL),
  ('44000001-0000-4000-8000-000000000004', NULL, 1, 'Коммунальные услуги', 'Utilities', 'canonical-utilities', NULL, 'canonical', 'utilities', '44000001-0000-4000-8000-000000000004', 4, NULL),
  ('44000001-0000-4000-8000-000000000005', NULL, 1, 'Еда', 'Food', 'canonical-food', NULL, 'canonical', 'food', '44000001-0000-4000-8000-000000000005', 5, NULL),
  ('44000001-0000-4000-8000-000000000006', NULL, 1, 'Транспорт', 'Transport', 'canonical-transport', NULL, 'canonical', 'transport', '44000001-0000-4000-8000-000000000006', 6, NULL),
  ('44000001-0000-4000-8000-000000000007', NULL, 1, 'Покупки', 'Shopping', 'canonical-shopping', NULL, 'canonical', 'shopping', '44000001-0000-4000-8000-000000000007', 7, NULL),
  ('44000001-0000-4000-8000-000000000008', NULL, 1, 'Здоровье', 'Health', 'canonical-health', NULL, 'canonical', 'health', '44000001-0000-4000-8000-000000000008', 8, NULL),
  ('44000001-0000-4000-8000-000000000009', NULL, 1, 'Образование', 'Education', 'canonical-education', NULL, 'canonical', 'education', '44000001-0000-4000-8000-000000000009', 9, NULL),
  ('44000001-0000-4000-8000-00000000000a', NULL, 1, 'Развлечения', 'Entertainment', 'canonical-entertainment', NULL, 'canonical', 'entertainment', '44000001-0000-4000-8000-00000000000a', 10, NULL),
  ('44000001-0000-4000-8000-00000000000b', NULL, 1, 'Путешествия', 'Travel', 'canonical-travel', NULL, 'canonical', 'travel', '44000001-0000-4000-8000-00000000000b', 11, NULL),
  ('44000001-0000-4000-8000-00000000000c', NULL, 1, 'Семья', 'Family', 'canonical-family', NULL, 'canonical', 'family', '44000001-0000-4000-8000-00000000000c', 12, NULL),
  ('44000001-0000-4000-8000-00000000000d', NULL, 1, 'Питомцы', 'Pets', 'canonical-pets', NULL, 'canonical', 'pets', '44000001-0000-4000-8000-00000000000d', 13, NULL),
  ('44000001-0000-4000-8000-00000000000e', NULL, 1, 'Сервисы и комиссии', 'Services & Fees', 'canonical-services-fees', NULL, 'canonical', 'services_fees', '44000001-0000-4000-8000-00000000000e', 14, NULL),
  ('44000001-0000-4000-8000-00000000000f', NULL, 1, 'Подарки и пожертвования', 'Gifts & Donations', 'canonical-gifts-donations', NULL, 'canonical', 'gifts_donations', '44000001-0000-4000-8000-00000000000f', 15, NULL),
  ('44000001-0000-4000-8000-000000000010', NULL, 1, 'Налоги', 'Taxes', 'canonical-taxes', NULL, 'canonical', 'taxes', '44000001-0000-4000-8000-000000000010', 16, NULL),
  ('44000001-0000-4000-8000-000000000011', NULL, 1, 'Сбережения и инвестиции', 'Savings & Investments', 'canonical-savings-investments', NULL, 'canonical', 'savings_investments', '44000001-0000-4000-8000-000000000011', 17, NULL),
  ('44000001-0000-4000-8000-000000000012', NULL, 1, 'Бизнес', 'Business', 'canonical-business', NULL, 'canonical', 'business', '44000001-0000-4000-8000-000000000012', 18, NULL),
  ('44000001-0000-4000-8000-000000000013', NULL, 1, 'Другое', 'Other', 'canonical-other', NULL, 'canonical', 'other', '44000001-0000-4000-8000-000000000013', 19, NULL),
  ('44000001-0000-4000-8000-000000000014', NULL, 1, 'Без категории', 'Uncategorized', 'canonical-uncategorized', NULL, 'canonical', 'uncategorized', '44000001-0000-4000-8000-000000000014', 20, NULL),
  ('44000001-0000-4000-8000-000000000015', NULL, 1, 'Нужна проверка', 'Needs Review', 'canonical-needs-review', NULL, 'canonical', 'needs_review', '44000001-0000-4000-8000-000000000015', 21, NULL)
ON CONFLICT (id) DO NOTHING;

WITH RECURSIVE custom_roots AS (
  SELECT
    category.id,
    category.parent_id,
    category.slug AS root_slug,
    LOWER(category.name_en) AS root_name_en
  FROM public.money_categories AS category
  WHERE category.parent_id IS NULL
    AND category.category_kind = 'custom'

  UNION ALL

  SELECT
    child.id,
    child.parent_id,
    custom_roots.root_slug,
    custom_roots.root_name_en
  FROM public.money_categories AS child
  JOIN custom_roots
    ON child.parent_id = custom_roots.id
  WHERE child.category_kind = 'custom'
),
mapped_branches AS (
  SELECT
    custom_roots.id,
    CASE
      WHEN custom_roots.root_slug = 'food-dining' OR custom_roots.root_name_en LIKE 'food%' THEN 'food'
      WHEN custom_roots.root_slug = 'transport' THEN 'transport'
      WHEN custom_roots.root_slug = 'shopping' THEN 'shopping'
      WHEN custom_roots.root_slug = 'entertainment' THEN 'entertainment'
      WHEN custom_roots.root_slug = 'housing' THEN 'housing'
      WHEN custom_roots.root_slug = 'income' THEN 'income'
      WHEN custom_roots.root_slug = 'health' THEN 'health'
      ELSE 'other'
    END AS canonical_system_key
  FROM custom_roots
)
UPDATE public.money_categories AS category
SET canonical_category_id = canonical.id
FROM mapped_branches
JOIN public.money_categories AS canonical
  ON canonical.system_key = mapped_branches.canonical_system_key
WHERE category.id = mapped_branches.id
  AND category.category_kind = 'custom'
  AND category.canonical_category_id IS NULL;

UPDATE public.money_categories
SET canonical_category_id = id
WHERE category_kind = 'canonical'
  AND canonical_category_id IS NULL;

ALTER TABLE public.money_categories
  ALTER COLUMN category_kind SET NOT NULL,
  ALTER COLUMN category_kind SET DEFAULT 'custom'::public.money_category_kind,
  ALTER COLUMN canonical_category_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'money_categories_canonical_category_id_fkey'
  ) THEN
    ALTER TABLE public.money_categories
      ADD CONSTRAINT money_categories_canonical_category_id_fkey
      FOREIGN KEY (canonical_category_id)
      REFERENCES public.money_categories(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_money_categories_system_key_unique
  ON public.money_categories(system_key)
  WHERE system_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_money_categories_canonical_category_id
  ON public.money_categories(canonical_category_id);

CREATE INDEX IF NOT EXISTS idx_money_categories_kind_sort_order
  ON public.money_categories(category_kind, sort_order, name_en);

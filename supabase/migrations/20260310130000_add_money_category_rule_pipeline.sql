-- ============================================================================
-- Money category rule pipeline foundation
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_rule_kind') THEN
    CREATE TYPE public.money_rule_kind AS ENUM (
      'direct',
      'mcc_map',
      'llm_categorization',
      'fallback_uncategorized'
    );
  END IF;
END $$;

ALTER TABLE public.money_line_items
  ADD COLUMN IF NOT EXISTS category_locked_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_category_rule_id uuid,
  ADD COLUMN IF NOT EXISTS last_category_rule_run_id uuid,
  ADD COLUMN IF NOT EXISTS category_assigned_at timestamptz;

CREATE TABLE IF NOT EXISTS public.money_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL,
  rule_kind public.money_rule_kind NOT NULL,
  target_category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  match_mode text NOT NULL DEFAULT 'all' CHECK (match_mode IN ('all', 'any')),
  scope_filter text NOT NULL DEFAULT 'all_line_items'
    CHECK (scope_filter IN ('all_line_items', 'uncategorized_only', 'custom_only', 'canonical_only', 'manual_unlocked_only')),
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  stop_processing boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_money_category_rules_person_sort_order
  ON public.money_category_rules(person_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_money_category_rules_person_enabled
  ON public.money_category_rules(person_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS public.money_category_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  trigger_source text NOT NULL,
  line_item_id uuid NOT NULL REFERENCES public.money_line_items(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.money_transactions(id) ON DELETE CASCADE,
  starting_category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  final_category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  saved boolean NOT NULL DEFAULT false,
  llm_tokens_prompt int,
  llm_tokens_completion int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_money_category_rule_runs_line_item_created_at
  ON public.money_category_rule_runs(line_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_money_category_rule_runs_person_created_at
  ON public.money_category_rule_runs(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.money_category_rule_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_run_id uuid NOT NULL REFERENCES public.money_category_rule_runs(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.money_category_rules(id) ON DELETE SET NULL,
  rule_name text,
  rule_kind public.money_rule_kind,
  sort_order int NOT NULL,
  matched boolean NOT NULL DEFAULT false,
  changed_category boolean NOT NULL DEFAULT false,
  previous_category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  next_category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  decision_reason text NOT NULL,
  debug_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_money_category_rule_run_steps_run_sort_order
  ON public.money_category_rule_run_steps(rule_run_id, sort_order, created_at, id);

ALTER TABLE public.money_category_rule_run_steps
  ALTER COLUMN rule_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS rule_name text,
  ADD COLUMN IF NOT EXISTS rule_kind public.money_rule_kind;

UPDATE public.money_category_rule_run_steps AS step
SET
  rule_name = COALESCE(step.rule_name, rule.name),
  rule_kind = COALESCE(step.rule_kind, rule.rule_kind)
FROM public.money_category_rules AS rule
WHERE rule.id = step.rule_id
  AND (
    step.rule_name IS NULL
    OR step.rule_kind IS NULL
  );

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'money_category_rule_run_steps_rule_id_fkey'
  ) THEN
    ALTER TABLE public.money_category_rule_run_steps
      DROP CONSTRAINT money_category_rule_run_steps_rule_id_fkey;
  END IF;

  ALTER TABLE public.money_category_rule_run_steps
    ADD CONSTRAINT money_category_rule_run_steps_rule_id_fkey
    FOREIGN KEY (rule_id)
    REFERENCES public.money_category_rules(id)
    ON DELETE SET NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.money_mcc_canonical_category_map (
  mcc text PRIMARY KEY,
  canonical_system_key text NOT NULL,
  canonical_category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'money_line_items_last_category_rule_id_fkey'
  ) THEN
    ALTER TABLE public.money_line_items
      ADD CONSTRAINT money_line_items_last_category_rule_id_fkey
      FOREIGN KEY (last_category_rule_id)
      REFERENCES public.money_category_rules(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'money_line_items_last_category_rule_run_id_fkey'
  ) THEN
    ALTER TABLE public.money_line_items
      ADD CONSTRAINT money_line_items_last_category_rule_run_id_fkey
      FOREIGN KEY (last_category_rule_run_id)
      REFERENCES public.money_category_rule_runs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.money_category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_category_rule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_category_rule_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_mcc_canonical_category_map ENABLE ROW LEVEL SECURITY;

INSERT INTO public.money_mcc_canonical_category_map (
  mcc,
  canonical_system_key,
  description
)
VALUES
  -- transport
  ('4111', 'transport', 'Local and suburban commuter transportation'),
  ('4112', 'transport', 'Passenger railways'),
  ('4121', 'transport', 'Taxicabs and limousines'),
  ('4131', 'transport', 'Bus lines'),
  ('4784', 'transport', 'Tolls and bridge fees'),
  ('5541', 'transport', 'Service stations'),
  ('5542', 'transport', 'Automated fuel dispensers'),
  ('7523', 'transport', 'Parking lots and garages'),
  -- utilities
  ('4900', 'utilities', 'Utilities'),
  ('4814', 'utilities', 'Telecommunication services'),
  ('4899', 'utilities', 'Cable, satellite, and pay television services'),
  -- food
  ('5411', 'food', 'Grocery stores and supermarkets'),
  ('5499', 'food', 'Miscellaneous food stores'),
  ('5462', 'food', 'Bakeries'),
  ('5812', 'food', 'Restaurants and eating places'),
  ('5813', 'food', 'Bars and lounges'),
  ('5814', 'food', 'Fast food restaurants'),
  ('5921', 'food', 'Beer, wine, and liquor stores'),
  -- housing
  ('6513', 'housing', 'Real estate agents and managers; rentals'),
  -- health
  ('5912', 'health', 'Drug stores and pharmacies'),
  ('8011', 'health', 'Doctors and physicians'),
  ('8021', 'health', 'Dentists and orthodontists'),
  ('8041', 'health', 'Chiropractors'),
  ('8042', 'health', 'Optometrists and ophthalmologists'),
  ('8043', 'health', 'Opticians and eyeglasses'),
  ('8062', 'health', 'Hospitals'),
  ('8071', 'health', 'Medical and dental laboratories'),
  ('8099', 'health', 'Medical services and health practitioners'),
  ('5975', 'health', 'Hearing aids and supplies'),
  ('5976', 'health', 'Orthopedic goods and prosthetic devices'),
  -- education
  ('8211', 'education', 'Elementary and secondary schools'),
  ('8220', 'education', 'Colleges, universities, and professional schools'),
  ('8241', 'education', 'Correspondence schools'),
  -- entertainment
  ('7832', 'entertainment', 'Motion picture theaters'),
  ('7922', 'entertainment', 'Theatrical producers and ticket agencies'),
  ('7994', 'entertainment', 'Video game arcades'),
  ('7996', 'entertainment', 'Amusement parks, carnivals, and circuses'),
  ('7998', 'entertainment', 'Aquariums, dolphinariums, zoos, and seaquariums'),
  ('7999', 'entertainment', 'Recreation services not elsewhere classified'),
  ('5815', 'entertainment', 'Digital goods: audiobooks, music, and movies'),
  ('5816', 'entertainment', 'Digital goods: games'),
  -- travel
  ('4411', 'travel', 'Cruise lines'),
  ('4511', 'travel', 'Airlines and air carriers'),
  ('4582', 'travel', 'Airports and airport terminals'),
  ('4722', 'travel', 'Travel agencies and tour operators'),
  ('4723', 'travel', 'Package tour operators'),
  ('7011', 'travel', 'Hotels, motels, resorts, and lodging'),
  ('7033', 'travel', 'Campgrounds and trailer parks'),
  ('7512', 'travel', 'Automobile rental agencies'),
  -- shopping
  ('5311', 'shopping', 'Department stores'),
  ('5331', 'shopping', 'Variety stores'),
  ('5399', 'shopping', 'Miscellaneous general merchandise stores'),
  ('5651', 'shopping', 'Family clothing stores'),
  ('5661', 'shopping', 'Shoe stores'),
  ('5732', 'shopping', 'Electronics stores'),
  ('5734', 'shopping', 'Computer software stores'),
  ('5931', 'shopping', 'Used merchandise and secondhand stores'),
  ('5941', 'shopping', 'Sporting goods stores'),
  ('5942', 'shopping', 'Book stores'),
  ('5977', 'shopping', 'Cosmetic stores'),
  ('5094', 'shopping', 'Jewelry, watches, clocks, and silverware stores'),
  -- pets
  ('0742', 'pets', 'Veterinary services'),
  ('5995', 'pets', 'Pet shops, pet food, and supplies'),
  -- family
  ('5641', 'family', 'Children and infants wear stores'),
  ('5945', 'family', 'Toy and hobby stores'),
  ('8351', 'family', 'Child care services'),
  -- gifts and donations
  ('8398', 'gifts_donations', 'Charitable and social service organizations'),
  ('8661', 'gifts_donations', 'Religious organizations'),
  -- transfers
  ('4829', 'transfers', 'Money transfer'),
  -- savings and investments
  ('6211', 'savings_investments', 'Security brokers and dealers'),
  -- taxes
  ('9311', 'taxes', 'Tax payments')
ON CONFLICT (mcc) DO UPDATE
SET
  canonical_system_key = EXCLUDED.canonical_system_key,
  description = EXCLUDED.description,
  canonical_category_id = NULL;

UPDATE public.money_mcc_canonical_category_map AS mapping
SET canonical_category_id = canonical.id
FROM public.money_categories AS canonical
WHERE canonical.system_key = mapping.canonical_system_key
  AND canonical.category_kind = 'canonical';

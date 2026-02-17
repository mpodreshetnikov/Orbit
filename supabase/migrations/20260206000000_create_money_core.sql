-- ============================================================================
-- Money Module (Phase 1 Core): enums + tables + RLS
-- ============================================================================

-- Enums
CREATE TYPE public.money_transaction_type AS ENUM (
  'expense',
  'income',
  'transfer',
  'refund',
  'fee',
  'adjustment'
);

CREATE TYPE public.money_transaction_status AS ENUM (
  'posted',
  'pending',
  'cancelled'
);

CREATE TYPE public.money_line_status AS ENUM (
  'final',
  'returned',
  'cancelled'
);

CREATE TYPE public.money_assignment_method AS ENUM (
  'import',
  'rule',
  'llm',
  'manual'
);

-- ============================================================================
-- money_accounts
-- ============================================================================
CREATE TABLE public.money_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  account_kind text NOT NULL CHECK (account_kind IN ('card', 'debit', 'credit', 'cash')),
  account_label text NOT NULL,
  currency char(3) NOT NULL,
  external_account_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_accounts_owner_person_id ON public.money_accounts(owner_person_id);
CREATE INDEX idx_money_accounts_is_active ON public.money_accounts(is_active);

-- ============================================================================
-- money_categories
-- ============================================================================
CREATE TABLE public.money_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  depth int NOT NULL CHECK (depth >= 1 AND depth <= 4),
  name_ru text NOT NULL,
  name_en text NOT NULL,
  slug text NOT NULL UNIQUE,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_categories_parent_id ON public.money_categories(parent_id);
CREATE INDEX idx_money_categories_depth ON public.money_categories(depth);

-- ============================================================================
-- money_transactions
-- ============================================================================
CREATE TABLE public.money_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.money_accounts(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  posted_at timestamptz NOT NULL,
  amount numeric NOT NULL,
  currency char(3) NOT NULL,
  transaction_type public.money_transaction_type NOT NULL,
  status public.money_transaction_status NOT NULL DEFAULT 'posted',
  merchant_name text,
  mcc text,
  comment text,
  is_transfer boolean NOT NULL DEFAULT false,
  transfer_group_id uuid,
  raw_payload jsonb,
  dedupe_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_money_transactions_source_external_id
  ON public.money_transactions(source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX idx_money_transactions_dedupe_hash
  ON public.money_transactions(dedupe_hash);

CREATE INDEX idx_money_transactions_posted_at
  ON public.money_transactions(posted_at);

CREATE INDEX idx_money_transactions_payer_posted_at
  ON public.money_transactions(payer_person_id, posted_at);

CREATE INDEX idx_money_transactions_account_posted_at
  ON public.money_transactions(account_id, posted_at);

-- ============================================================================
-- money_line_items
-- ============================================================================
CREATE TABLE public.money_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.money_transactions(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric NOT NULL,
  quantity numeric,
  unit text,
  line_status public.money_line_status NOT NULL DEFAULT 'final',
  related_line_item_id uuid REFERENCES public.money_line_items(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  beneficiary_person_id uuid REFERENCES public.persons(id) ON DELETE SET NULL,
  assignment_method public.money_assignment_method NOT NULL DEFAULT 'manual',
  assignment_rule_id uuid,
  assignment_confidence numeric,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_line_items_transaction_id ON public.money_line_items(transaction_id);
CREATE INDEX idx_money_line_items_category_id ON public.money_line_items(category_id);
CREATE INDEX idx_money_line_items_beneficiary_person_id ON public.money_line_items(beneficiary_person_id);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.money_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_line_items ENABLE ROW LEVEL SECURITY;

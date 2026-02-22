# Money Module (Budget + Investments) — Technical Specification (Cursor)

Owner: Max
Language: English
Stack: React (shadcn/ui) + Supabase (Postgres/RLS/Storage/Edge Functions) + Vercel + OpenRouter (LLM)

Scope: Phase 1 = Budget. Phase 2 = Investments & Savings.

---

## 0) Goals

### Phase 1 (Budget) goals

- Import **bank transactions** (T-Bank, Alfa, Bakai) and normalize into a canonical schema.
- Import **purchase compositions (line items)** from store apps/websites (Wildberries, Ozon, Пятёрочка, Самокат, Командор) with confirmation/edit.
- Support **multi-currency in MVP** (minimum: RUB + USD).
- Compute **monthly budget** with category breakdowns, person breakdowns (including pets).
- Implement **dog expenses calculator**: auto-calc dog expenses from transactions; add spouse expenses; compute **settlement** (50/50 split) per month.
- Categorize transactions/line items using: import hints → rule engine → manual → optional LLM.
- Treat **transfers automatically** and exclude them from expense reports.
- Allow **manual editing** of transaction line items and **assignment of line items to persons/pets** (manual + rules + LLM) for reports.

### Phase 2 (Investments & Savings) goals (high-level)

- Track accounts, instruments, positions, cashflows.
- Import broker statements later.
- Net worth and allocation views.

Non-goals (Phase 1)

- Banking APIs / open banking.
- Screenshot OCR of app UIs as primary ingestion.
- Complex permissions (keep allowlist, shared-by-default).

---

## 1) Phase 1 — Domain Model (Supabase)

### 1.1 Persons

Use existing `persons` table for humans + pets (Dog).

### 1.2 Core tables

#### `money_accounts`

- `id uuid pk`
- `owner_person_id uuid` (Max/Wife)
- `source text` (`tbank`|`alfa`|`bakai`|`cash`)
- `account_kind text` (card|debit|credit|cash)
- `account_label text`
- `currency char(3)` (RUB/USD)
- `external_account_id text null` (last4/iban if available)
- `is_active boolean`
- `created_at, updated_at`

#### `money_transactions`

- `id uuid pk`
- `payer_person_id uuid` (who paid; derived from account owner)
- `account_id uuid fk money_accounts`
- `source text`
- `external_id text null`
- `posted_at timestamptz`
- `amount numeric` (signed: +income, -expense)
- `currency char(3)`
- `transaction_type money_transaction_type` (expense|income|transfer|refund|fee|adjustment)
- `status money_transaction_status` (posted|pending|cancelled)
- `merchant_name text null`
- `mcc text null`
- `comment text null`
- `is_transfer boolean default false`
- `transfer_group_id uuid null`
- `raw_payload jsonb`
- `dedupe_hash text`
- `created_at, updated_at`

Constraints & indexes:

- Unique `(source, external_id)` when present
- Unique `(dedupe_hash)` fallback
- Indexes: `(posted_at)`, `(payer_person_id, posted_at)`, `(account_id, posted_at)`

#### `money_line_items`

- `id uuid pk`
- `transaction_id uuid fk money_transactions on delete cascade`
- `title text`
- `amount numeric` (same sign convention as transaction)
- `quantity numeric null`
- `unit text null` (pcs|kg|g|l|ml)
- `line_status money_line_status` (final|returned|cancelled)
- `related_line_item_id uuid null` (return/cancellation linkage)
- `category_id uuid fk money_categories null`
- `beneficiary_person_id uuid null` (Dog/Wife/Max/Shared)
- `assignment_method money_assignment_method` (import|rule|llm|manual)
- `assignment_rule_id uuid null`
- `assignment_confidence numeric null` (0..1)
- `raw_payload jsonb`
- `created_at, updated_at`

Rule: transaction must have >= 1 line item (enforce in Import Confirm + optional DB trigger).

#### `money_categories` (tree, depth<=4)

- `id uuid pk`
- `parent_id uuid fk money_categories null`
- `depth int`
- `name_ru text`
- `name_en text`
- `slug text unique`
- `archived_at timestamptz null`
- `created_at, updated_at`

#### `money_rules` (deterministic)

- `id uuid pk`
- `enabled boolean`
- `priority int`
- `scope money_rule_scope` (transaction|line_item)
- `conditions jsonb`
- `actions jsonb`
- `created_at, updated_at`

Conditions examples:

- merchant contains/regex
- comment contains/regex
- source ==
- currency ==
- amount range
- line item title contains/regex

Actions examples:

- set_category_id
- set_beneficiary_person_id
- set_is_transfer

#### `money_import_batches`

- `id uuid pk`
- `source text`
- `payer_person_id uuid`
- `import_type text` (file|web_export)
- `file_path text null`
- `meta jsonb`
- `created_at`

### 1.3 Multi-currency

#### `fx_rates`

- `rate_date date`
- `base_currency char(3)` (recommend: RUB)
- `quote_currency char(3)` (USD)
- `rate numeric` (define convention: 1 USD in RUB)
- unique `(rate_date, base_currency, quote_currency)`

Reporting:

- User selects reporting currency (default RUB).
- Convert each amount by `posted_at::date` rate; if missing use nearest previous rate and mark approximated.

## 2) Imports

### 2.1 Supported sources (Phase 1)

Banks: T-Bank, Alfa, Bakai.
Stores: Wildberries, Ozon, Пятёрочка, Самокат, Командор.

### 2.2 Import modes

Important: **each supported source will have only one (or at most two) import modes initially**. Other modes and sources will be added later. Phase 1 must implement a clean connector framework and ship the first connectors.

- File import (CSV/JSON/OFX when available)
- Web export via Chrome Extension (preferred)

### 2.3 Matching store compositions to bank transactions

Heuristics:

- total amount match (with rounding tolerance)
- date within ±2 days
- merchant alias match
  UI: show confidence + manual linking.

### 2.4 Dedupe

- primary: `(source, external_id)`
- fallback: `dedupe_hash = hash(source + posted_at + amount + currency + merchant + account_hint)`

---

## 3) Transfers (auto + excluded)

Detection order:

1. Source-provided type
2. Rules (patterns)
3. Name-based heuristics: some banks include counterparty/person names in the transaction title/description; use that as a strong transfer signal (configurable alias list per person)
4. Pair matching: opposite sign, same abs amount, within window, between known accounts; set `transfer_group_id`

Transfers excluded from expenses by default.

---

## 4) Categorization + Beneficiary assignment

Pipeline:

1. Import hints (MCC/store metadata)
2. Rule engine
3. Manual edits (lock)
4. LLM suggestions (optional; preview required)

Line items store `beneficiary_person_id` to support reports (Dog/Wife/Max/Shared).

---

---

## 6) UI (React)

Navigation requirement:

- Add a **new top-level Money section** in the app navigation (currently only Health exists).

Required screens:

- Money Dashboard (month + reporting currency + totals + breakdowns + dog panel)
- Transactions list (filters) + Transaction detail (composition editor)
- Import Wizard (source → upload → preview/dedupe → confirm)
- Categories Manager (tree depth<=4)
- Rules Manager (CRUD + test)
- Salary (profile + events + expected income)
- Dog calculator: settlement view + manual entries CRUD

State mgmt recommendation: React Query + Zustand.

---

## 7) Backend (Supabase)

### 7.1 RPC (DB)

- `money_upsert_transactions_batch(batch_json)` (idempotent)
- `money_upsert_line_items_batch(batch_json)`
- `money_apply_rules_for_batch(batch_id)`
- `money_monthly_aggregates(month, reporting_currency, person_id?)`
- `money_dog_settlement(month, reporting_currency, dog_person_id, max_person_id, wife_person_id, split_ratio)`

### 7.2 Edge Functions

- `money_llm_classify` (OpenRouter) — optional
- `fx_rates_sync` — daily FX ingest from **fxratesapi.com** (transaction-date conversion)

---

## 8) Chrome Extension (Web Export)

Goal: export structured JSON from store order pages/web UIs.

Output JSON fields:

- `export_version`
- `source`
- `exported_at`
- `orders[]`: { order_id, date, total_amount, currency, items[] { title, qty, unit, unit_price, amount } }

Constraints:

- user-initiated
- no backend scraping
- support one store at a time

---

## 9) Implementation plan (Cursor tasks)

1. Schema + RLS + indexes + unique constraints
2. Basic UI + manual entry (transactions + line items + beneficiary)
3. Import framework + first connectors (T-Bank file + WB web export)
4. Rule engine + rules UI
5. Monthly aggregates + dashboard
6. Dog settlement calculator
7. Salary forecasting
8. Add more connectors (Alfa/Bakai + other stores)
9. Optional LLM classification

---

## 10) Remaining critical decisions (resolved)

1. Default reporting currency: **RUB**.
2. FX conversion policy: **transaction-date**.
3. FX provider: **fxratesapi.com**.
4. Shared beneficiary: **skip for now** (use NULL `beneficiary_person_id` to mean “unassigned/shared”).
5. Dog calculator: use a **separate manual entries table** (`money_dog_manual_entries`) not linked to `money_transactions`.

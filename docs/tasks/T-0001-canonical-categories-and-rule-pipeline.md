---
id: T-0001
title: Canonical money categories and rule pipeline
status: done
kind: feature
priority: p2
depth: execplan
created: 2026-03-14
updated: 2026-03-14
owner: TBD
tags: [money, categories, rules]
---

# Canonical Money Categories and Rule Pipeline

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository contains `docs/PLANS.md`, and this document is maintained in accordance with that file.

## Purpose / Big Picture

After this change, the money domain always contains a built-in canonical category set that cannot be deleted and is present in every environment after migrations run. Users can add their own custom categories under those built-in categories, create person-specific ordered categorization pipelines made of normal rules and smart rules, and apply those pipelines to imported or manually edited line items.

Success is observable in four ways. First, the Categories screen always shows the seeded built-in categories and does not allow deleting them. Second, every imported line item is automatically sent through the rule pipeline for that transaction's payer person as part of import completion. Third, the Rules screen lets the user manage a rule list for a selected person and rerun that person's pipeline for one line item, one transaction, or a date-range batch of transactions. Fourth, a line-item debug view shows which person's rules ran, which rules were skipped by filters, which rule changed the category, and what final category was saved.

## Progress

- [x] (2026-03-10T00:00:00Z) Read `docs/PLANS.md`, money architecture docs, current money schema, and existing categories UI to anchor this plan in the current repository.
- [x] (2026-03-10T00:20:00Z) Draft the target design for canonical categories, custom categories, ordered rule evaluation, smart rules, and debug tooling.
- [x] (2026-03-10T14:45:00Z) Moved this plan from `docs/exec-plans/todo/` to `docs/exec-plans/in-progress/` and started implementation with repository context gathering, DB/UI surface mapping, and quality workflow setup.
- [x] (2026-03-10T18:20:00Z) Implemented canonical categories, deterministic rule-pipeline SQL/RPCs, import-time automatic rule application, and the Categories/Rules/transaction debug UI surfaces with focused tests.
- [x] (2026-03-10T19:35:00Z) Added the `money-categorize` LLM orchestration service and edge-function entrypoint, routed web replay actions through it when LLM rules are enabled, and switched import auto-apply to the same orchestration path for LLM-capable rule sets.
- [ ] Implement the schema, seed data, RPCs, Edge workflow, UI, and validation steps described below.

## Surprises & Discoveries

- Observation: `money_categories` already exists, but every row is currently just a normal editable row with no distinction between built-in and user-defined categories.
  Evidence: `supabase/migrations/20260206000000_create_money_core.sql` defines only `parent_id`, `depth`, names, `slug`, and `archived_at`.

- Observation: imported transaction metadata already captures strong inputs for categorization, including merchant name, MCC, source comment, source category id, and source category name.
  Evidence: `src/types/money.ts` and `supabase/db/functions/money_upsert_transactions_batch.sql` both include `merchant_name`, `mcc`, `comment`, `source_comment`, `source_category_id`, and `source_category_name`.

- Observation: the repository already has one narrow smart-categorization primitive based on historical merchant usage.
  Evidence: `supabase/db/functions/get_money_merchant_default_categories.sql` returns the most-used category per merchant for a payer.

- Observation: the Edge Function-side generated database types lagged the new money rule tables even after the SQL implementation was added, so new repository code had to use explicit untyped admin-client calls for those fresh relations until artifacts are refreshed again in the validation stage.
  Evidence: `supabase/functions/money-categorize/repository.ts` and `supabase/functions/money-import/repository.ts` now cast the admin client for `money_category_rules`, `money_category_rule_runs`, `money_category_rule_run_steps`, and the built-in mapping tables because the current `_shared/database.types.ts` surface does not yet include them.

## Decision Log

- Decision: keep one category table, but explicitly mark rows as either `canonical` or `custom`.
  Rationale: the repo already stores category references in `money_line_items.category_id`; extending the existing table is lower risk than splitting the concept into parallel category tables and then rewriting all current queries and forms.
  Date/Author: 2026-03-10 / Codex

- Decision: require every custom category to belong to a canonical branch by storing `canonical_category_id` on each category row.
  Rationale: smart rules need a stable canonical target set, reporting needs consistent rollups, and users still need freedom to create personal leaves such as `Dog treats` or `Coffee beans` without losing canonical reporting.
  Date/Author: 2026-03-10 / Codex

- Decision: keep the built-in canonical taxonomy flat at one level instead of shipping a built-in parent-child tree.
  Rationale: the user explicitly does not want a default tree. A flat shipped taxonomy makes built-in mapping simpler, reduces debate about parent semantics, and still leaves room for user-defined custom children under any built-in category.
  Date/Author: 2026-03-10 / Codex

- Decision: scope categorization rules per person instead of keeping one global rule list.
  Rationale: different people can have different merchants, naming patterns, and category preferences. Per-person rule lists avoid cross-person rule interference and make import-time automatic runs deterministic because each transaction already has `payer_person_id`.
  Date/Author: 2026-03-10 / Codex

- Decision: model the categorization system as an ordered pipeline where each rule can either no-op or overwrite the current category, and the last applied rule wins.
  Rationale: this matches the requested behavior exactly and makes debug output legible because every step can report "filtered out", "matched but no change", or "changed category to X".
  Date/Author: 2026-03-10 / Codex

- Decision: preserve manual edits by default with an explicit "locked by manual assignment" flag that normal pipeline runs do not overwrite unless the user chooses a force re-run action.
  Rationale: users need trust that fixing one bad categorization in the UI will not be silently reverted by the next background or batch rule run.
  Date/Author: 2026-03-10 / Codex

- Decision: run deterministic rules and rule-history writes through database RPCs, and run LLM-backed rules through a dedicated Edge Function orchestrator.
  Rationale: deterministic matching belongs close to the data for repeatability and bulk execution, while LLM classification requires external network calls and should remain outside Postgres.
  Date/Author: 2026-03-10 / Codex

## Outcomes & Retrospective

This section is intentionally blank until implementation begins. At minimum, record whether the canonical taxonomy proved large enough, whether rule debugging was understandable in practice, whether LLM latency was acceptable, and whether any rule/filter primitives turned out to be unnecessary or missing.

## Context and Orientation

The money domain already exists in both the web app and the Supabase database. The current category management UI lives in `src/app/money/categories/page.tsx` and uses `src/hooks/use-money-categories.ts` to read and mutate `money_categories`. Transaction and line-item editing flows live under `src/app/money/transactions/*` and `src/components/money/transaction-form.tsx`.

The durable ledger rows are `money_transactions` and `money_line_items`. A transaction is the bank- or source-level record, such as one card payment. A line item is the composition-level row inside that transaction, such as `Dog food 2kg` or `Restaurant dinner`. Category assignment happens at line-item level because that is the level the user cares about for receipt composition and reporting.

In this plan, "canonical category" means a built-in category shipped by the product and present in every environment. It is not deletable and is used by smart rules such as MCC mapping. "Custom category" means a user-created category stored in the same tree, still visible in reports, but always attached to one canonical branch. "Rule pipeline" means the ordered list of enabled rules evaluated from top to bottom against a candidate line item. "Filter" means the conditions that decide whether a rule is allowed to run for that line item. "Smart rule" means a rule whose target category is computed automatically instead of being hard-coded by the user.

The current repository does not yet have a money rules table, a rule runner, or a line-item pipeline-debug surface. This plan introduces them without changing the core intent of the current ledger model. It also makes pipeline execution an automatic part of import completion, with explicit replay entry points for one line item, one transaction, or a date-range batch of transactions selected by the user. Rules are not global: each rule belongs to one person, and automatic or manual runs resolve the active rule list from the line item's transaction payer person unless the replay UI explicitly asks the user to choose a person-scoped batch.

## Default Canonical Taxonomy

Seed the following built-in canonical categories as a flat, one-level default taxonomy. The exact text labels may be refined for locale quality, but the `system_key` values must remain stable because mappings and tests will rely on them.

Built-in canonical categories:

- `income`
- `transfers`
- `housing`
- `utilities`
- `food`
- `transport`
- `shopping`
- `health`
- `education`
- `entertainment`
- `travel`
- `family`
- `pets`
- `services_fees`
- `gifts_donations`
- `taxes`
- `savings_investments`
- `business`
- `other`
- `uncategorized`
- `needs_review`

Rules for the taxonomy:

1. Canonical rows are seeded by migration and repaired idempotently by a seed function.
2. Canonical rows are all depth `1` and have no built-in canonical parent-child hierarchy.
3. Canonical rows cannot be deleted and cannot change `category_kind`, `system_key`, or `canonical_category_id`.
4. Custom rows can be created, renamed, re-parented, archived, and deleted when unused.
5. A custom row must always reference exactly one built-in canonical category through `canonical_category_id`.
6. A custom row may optionally use `parent_id` to form a user-defined tree beneath a built-in canonical category, but it must never change its `canonical_category_id` to point across branches without an explicit edit.
7. The UI must visually distinguish canonical rows from custom rows.

## Useful Rule Inputs

Rules should be able to read the following fields because they already exist, are stable, or are routinely present in imported data.

Transaction-level inputs:

- `money_transactions.source`
- `money_transactions.posted_at`
- `money_transactions.amount`
- `money_transactions.currency`
- `money_transactions.transaction_type`
- `money_transactions.status`
- `money_transactions.merchant_name`
- `money_transactions.brand_id` and brand slug or name when present
- `money_transactions.mcc`
- `money_transactions.comment`
- `money_transactions.source_comment`
- `money_transactions.source_category_id`
- `money_transactions.source_category_name`
- `money_transactions.cashback_amount`
- `money_transactions.account_id`
- account source and account kind through `money_accounts`
- `money_transactions.payer_person_id`
- `money_transactions.is_transfer`
- the effective rule owner person for the current run

Line-item-level inputs:

- `money_line_items.title`
- `money_line_items.amount`
- `money_line_items.quantity`
- `money_line_items.unit`
- `money_line_items.line_status`
- current `money_line_items.category_id`
- current assignment method and whether the line is manually locked
- raw receipt metadata from `money_line_items.raw_payload` when a connector provides structured details such as SKU, brand, barcode, or original source item category

Derived inputs to compute inside the pipeline:

- normalized merchant name
- normalized line-item title
- absolute amount
- unit price when `quantity` is present
- day of week and month from `posted_at`
- whether the current category is canonical, custom, or empty
- whether the line item belongs to a source that has receipt-quality metadata

## Rule Types and Filters

Implement two rule families: `direct` rules and `smart` rules.

Direct rules are configured by the user with an explicit target category. They should support the following operators:

- text contains
- text does not contain
- exact equals
- starts with
- regex matches
- value in set
- numeric range
- is empty
- is not empty

The first release should support these direct-rule filter fields:

- line-item title
- merchant name
- transaction comment
- transaction source comment
- source name
- source category id
- source category name
- MCC
- transaction type
- account source
- account kind
- payer person
- line-item amount
- transaction amount
- current category empty or not empty
- category is in canonical branch X
- transfer flag

The first release should use a simple and explicit filter model:

1. Each rule has a `match_mode` of `all` or `any`.
2. Each filter compares one field to one value or value set.
3. Nested boolean groups are out of scope for the first release.
4. A rule may also define a top-level scope filter of `all_line_items`, `uncategorized_only`, `custom_only`, `canonical_only`, or `manual_unlocked_only` for common cases that should not require many explicit filter rows.

Useful direct rule templates that the UI should ship:

- line-item title contains text, then set category
- merchant equals text, then set category
- MCC equals code, then set category
- source category equals text, then set category
- amount within range, then set category
- comment contains text, then set category

## Smart Rules

Implement the following smart rules in the first release.

`mcc_map`

This rule maps the transaction MCC to a canonical category using a built-in mapping table. The mapping table lives in the database so it can be versioned, tested, and extended without code changes. If no mapping exists for the MCC, the rule no-ops.

`source_category_map`

This rule maps `source_category_id` or `source_category_name` from the import source to a canonical category using a source-specific mapping table. The mapping is keyed by source plus source-category identifier or normalized name. If no mapping exists, the rule no-ops.

`merchant_history`

This rule uses the person's own previously confirmed line items to infer the most likely canonical category for the current merchant and optionally normalized line-item title. It should only learn from manual assignments and from rules that person has explicitly accepted, not from low-confidence LLM outputs. The existing `get_money_merchant_default_categories` function is the starting point, but it must be expanded from "top category per merchant" to canonical-category suggestions usable by the pipeline.

`line_item_history`

This rule matches normalized line-item title plus canonical branch or merchant context against previously confirmed assignments for the same person. It is useful for repetitive receipts where the same item names recur.

`llm_categorization`

This rule sends the transaction context, line-item context, the user prompt, and the list of available category candidates to the LLM. Candidate categories include all built-in canonical categories plus any custom categories available in the active person's category space. The LLM must return either one existing category id from the provided candidate list or an explicit `no_change` result. It must never invent a category id. The system prompt should require deterministic JSON output and should include short category descriptions and an instruction to prefer a matching custom category when that person's custom taxonomy is more precise than the built-in categories.

`fallback_uncategorized`

This rule is deterministic and simply assigns `uncategorized` or `needs_review` when no earlier rule assigned anything. It gives the user a clean queue for review rather than leaving lines blank forever.

Do not implement an open-ended "smart magic rule" surface beyond these named kinds in the first release. Named smart rules keep the UI understandable, the debug logs comprehensible, and the test matrix finite.

### Built-in Mapping Data

Ship MCC and source-category mappings as built-in product data, not as user setup.

For MCC mapping:

1. Create `money_mcc_canonical_category_map` with one row per MCC code.
2. Seed it from a repository-owned SQL seed file under `supabase/db/seeds/` or a dedicated insert function in `supabase/db/functions/`.
3. Store the target as canonical `system_key` during seed generation and resolve to category ids during seed or repair, so the seed remains stable even if UUIDs differ between environments.
4. Cover a useful baseline of common expense MCCs first and route unknown or ambiguous MCCs to no-op rather than forced guesses.

For source-category mapping:

1. Create `money_source_category_canonical_map` keyed by `source`, optional `source_category_id`, optional normalized `source_category_name`, and target canonical `system_key`.
2. Ship rows for all sources already supported by the import framework in this repository, starting with the current T-Bank import fields and leaving room for future sources.
3. Prefer source category id when both id and name exist, because ids are usually more stable than labels.
4. Allow multiple rows per source so the product can ship mapping updates as new imports are added.

Both mapping tables must be seeded automatically by migrations or idempotent repair functions, tested via pgTAP, and visible in debug payloads so a user can tell exactly which built-in map entry fired.

## Data Model and Interfaces

Add a new enum under `supabase/db/types/`:

- `money_category_kind` with values `canonical` and `custom`
- `money_rule_kind` with values `direct`, `mcc_map`, `source_category_map`, `merchant_history`, `line_item_history`, `llm_categorization`, `fallback_uncategorized`

Extend `public.money_categories` with:

- `category_kind public.money_category_kind NOT NULL`
- `system_key text NULL UNIQUE`
- `canonical_category_id uuid NOT NULL REFERENCES public.money_categories(id)`
- `sort_order int NOT NULL DEFAULT 0`
- `created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL`

Add a check or trigger that enforces:

- canonical rows must have `canonical_category_id = id`
- canonical rows must have `parent_id IS NULL`
- custom rows must have `canonical_category_id <> id`
- custom rows cannot be created without a canonical category reference
- `depth` remains between 1 and 4

Extend `public.money_line_items` with:

- `category_locked_by_user boolean NOT NULL DEFAULT false`
- `last_category_rule_id uuid NULL`
- `last_category_rule_run_id uuid NULL`
- `category_assigned_at timestamptz NULL`

Create `public.money_category_rules` with fields:

- `id uuid pk`
- `person_id uuid not null references public.persons(id) on delete cascade`
- `name text`
- `description text null`
- `enabled boolean`
- `sort_order int`
- `rule_kind public.money_rule_kind`
- `target_category_id uuid null`
- `match_mode text not null check in ('all','any')`
- `scope_filter text not null`
- `filters jsonb not null`
- `config jsonb not null`
- `stop_processing boolean not null default false`
- `created_by uuid null`
- `created_at timestamptz`
- `updated_at timestamptz`

Add a unique ordering invariant so that `sort_order` is unique per `person_id`, not globally.

Create `public.money_category_rule_runs` with fields:

- `id uuid pk`
- `triggered_by_user_id uuid null`
- `person_id uuid not null references public.persons(id) on delete cascade`
- `trigger_source text not null` such as `import_auto`, `single_line_item_replay`, `single_transaction_replay`, `date_range_replay`, `single_preview`, `background_repair`
- `line_item_id uuid not null`
- `transaction_id uuid not null`
- `starting_category_id uuid null`
- `final_category_id uuid null`
- `saved boolean not null`
- `llm_tokens_prompt int null`
- `llm_tokens_completion int null`
- `created_at timestamptz not null`

Create `public.money_category_rule_run_steps` with fields:

- `id uuid pk`
- `rule_run_id uuid not null`
- `rule_id uuid not null`
- `sort_order int not null`
- `matched boolean not null`
- `changed_category boolean not null`
- `previous_category_id uuid null`
- `next_category_id uuid null`
- `decision_reason text not null`
- `debug_payload jsonb not null`
- `created_at timestamptz not null`

Create mapping tables:

- `public.money_mcc_canonical_category_map`
- `public.money_source_category_canonical_map`

Add or update database functions under `supabase/db/functions/`:

- `money_seed_canonical_categories()`
- `money_preview_category_rule_pipeline(p_line_item_id uuid, p_person_id uuid default null, p_rule_ids uuid[] default null)`
- `money_apply_category_rule_pipeline(p_line_item_ids uuid[], p_person_id uuid default null, p_force_overwrite_locked boolean default false, p_trigger_source text default 'manual_replay')`
- `money_apply_category_rule_pipeline_for_transaction(p_transaction_id uuid, p_person_id uuid default null, p_force_overwrite_locked boolean default false)`
- `money_apply_category_rule_pipeline_for_date_range(p_person_id uuid, p_from date, p_to date, p_force_overwrite_locked boolean default false)`
- `money_get_category_rule_debug(p_line_item_id uuid, p_limit int default 20)`
- a helper function that resolves rule input payload for one line item, including transaction and account fields

These functions should default `p_person_id` from `money_transactions.payer_person_id` when replaying a single line item or transaction and should require an explicit `p_person_id` for date-range replay so the batch is unambiguous.

Add a dedicated Edge Function:

- `supabase/functions/money-categorize/index.ts`

This function owns LLM-backed rule execution, bulk orchestration, and persistence of debug traces for runs that include `llm_categorization`. Deterministic preview and apply paths may stay inside DB RPCs when no LLM rule is in the active rule set. It must support the same execution scopes as deterministic runs: one line item, one transaction, import-created line items, and date-range batch replay. Every invocation must carry the active `person_id`, and the function must only load that person's enabled rules and that person's historical-learning context.

Update TypeScript types:

- `src/types/money.ts`
- generated DB types under `supabase/db/database.types.ts`

Create new hooks:

- `src/hooks/use-money-category-rules.ts`
- `src/hooks/use-money-category-debug.ts`
- extend `src/hooks/use-money-categories.ts` for canonical/custom distinctions and category lock semantics

## Plan of Work

The work should be delivered in five milestones.

### Milestone 1: Canonical category foundation

Add the new enums, extend `money_categories`, seed the flat built-in taxonomy, and add invariants that make canonical rows undeletable and always recoverable. Update the categories hook and page so the user can see built-in categories, custom rows beneath them, and locked canonical nodes.

At the end of this milestone, a clean local database reset shows the built-in category list automatically, and the Categories screen prevents deletion of built-in rows while still allowing creation of custom rows beneath them.

### Milestone 2: Deterministic rule engine

Create `money_category_rules`, rule-run history tables, and the deterministic pipeline RPCs. Implement direct rules, filter evaluation, ordered execution, `stop_processing`, line-item category locking behavior, person ownership of rules, and explicit replay scopes for one line item, one transaction, and a user-selected date-range batch of transactions. Wire the rule engine into transaction detail actions so a user can re-run rules without involving the LLM.

At the end of this milestone, a user can create text- and metadata-based rules, order them, preview them, apply them, and inspect step-by-step debug output for deterministic runs.

### Milestone 3: Smart rules

Add the mapping tables and seed the built-in MCC and source-category mappings shipped with the feature. Expand merchant history into a canonical-category smart rule, add line-item history, and create the `money-categorize` Edge Function for LLM-backed categorization. The LLM contract must be structured JSON, must support `no_change`, and must receive both canonical and custom category candidates.

At the end of this milestone, the pipeline can mix normal rules with named smart rules and still produce auditable step logs showing why each smart rule did or did not act.

### Milestone 4: Management and debug UI

Add a Rules screen at `src/app/money/rules/page.tsx` and supporting components under `src/components/money/`. The screen needs a person selector, CRUD, ordering, enable/disable, preview/test on sample line items, templates for the common direct rules, and replay actions for one line item, one transaction, and a date-range batch. Extend transaction and line-item views with a debug drawer or side panel that shows the latest pipeline run and allows opening prior runs.

At the end of this milestone, the full feature is usable from the web app without SQL access.

### Milestone 5: Automatic execution and acceptance

Trigger categorization automatically for every newly imported line item after import confirmation, while respecting manual locks. Automatic runs must use the rule set owned by the transaction's `payer_person_id`. Deterministic-only active pipelines may run fully in DB RPCs; pipelines that include `llm_categorization` must route through the Edge orchestrator. Add e2e coverage for the happy paths: built-in categories present, custom category creation, direct rule application, smart rule mapping, import-time auto-apply, replay by scope, person-specific rule isolation, and line-item debug visibility. Document the final behavior in money design docs if the implementation reveals constraints that future contributors must know.

At the end of this milestone, imported line items are categorized through the rule pipeline by default, and the user can prove what happened for any individual line item.

## Concrete Steps

From the repository root, implement the feature in this order:

1. Add enum SQL files under `supabase/db/types/` and include them from `supabase/db/01_types_functions.sql`.
2. Add a migration that extends `money_categories`, `money_line_items`, and creates the new rule and mapping tables.
3. Add seed or repair functions for canonical categories and built-in mappings, and include them in `supabase/db/functions/*` plus idempotent deploy wiring.
4. Add RLS policies for new tables under `supabase/db/policies/` and include them from `supabase/db/03_policies.sql`.
5. Add pgTAP coverage under `supabase/tests/functions/` and `supabase/tests/policies/`.
6. Regenerate DB artifacts with the canonical DB workflow commands.
7. Extend `src/types/money.ts` and add hooks for rules and debug data.
8. Update `src/app/money/categories/page.tsx` and add `src/app/money/rules/page.tsx` with supporting components.
9. Add debug entry points to transaction detail and line-item UI.
10. Add the `money-categorize` Edge Function and its tests if the active rule set contains `llm_categorization`.
11. Wire import completion to run the pipeline automatically for every new imported line item.
12. Add replay actions for one line item, one transaction, and date-range transaction batches, all scoped to a selected person.
13. Run validation commands and capture final outputs in this plan.

Commands to run during implementation:

- `just db-reset`
- `just db-lint`
- `just db-test`
- `just db-artifacts-refresh`
- `just test-unit-web`
- `just test-unit-functions`
- `just test-e2e`
- `just ci-fast`
- `just ci`

Expected observable checkpoints:

- After `just db-reset`, querying or loading the Categories screen shows the seeded built-in category list.
- After creating a direct rule and applying it to a sample line item, the line item category changes and the debug history shows the rule step.
- After enabling an MCC or source-category smart rule, importing a matching transaction produces a canonical category without the user hard-coding a target category in that rule.
- After importing a transaction with line items, each imported line item has a recorded pipeline run without requiring a manual replay step.
- After replaying rules for a single transaction or a date-range batch, each affected line item gets a new debug run with the correct `trigger_source` and `person_id`.
- After enabling an LLM rule with a prompt that allows `no_change`, the debug log clearly shows whether the model selected a category from the provided canonical or custom candidate set for that person or intentionally left the line item unchanged.

## Validation and Acceptance

Acceptance is behavior, not just schema shape.

Database acceptance:

- canonical categories are present after `db-reset` with stable `system_key` values
- canonical categories cannot be deleted
- custom categories cannot exist without an owning canonical category
- direct rules evaluate filters correctly for `all` and `any`
- rule ownership is per person and one person's rules never execute for another person's transaction unless explicitly requested in a controlled admin or debug path
- rule runs and rule steps are persisted with readable reasons
- manual locks prevent overwrite unless force re-run is requested
- every imported line item receives an automatic pipeline run
- replay by line item, transaction, and date range works and records the correct replay source

Web acceptance:

- `src/app/money/categories/page.tsx` shows canonical rows as locked and custom rows as editable
- `src/app/money/rules/page.tsx` supports selecting a person and then create, edit, delete, enable, disable, reorder, preview, apply, and replay by scope for that person's rules
- transaction detail shows the current category, assignment source, lock state, and a debug panel with pipeline history

Smart-rule acceptance:

- MCC mapping sets the expected canonical category for a known MCC fixture
- source-category mapping sets the expected canonical category for a known imported source-category fixture
- merchant history suggests a canonical category after at least one confirmed prior assignment
- merchant history and line-item history only learn from and apply to the same person
- LLM rule returns either a category from the provided canonical and custom candidate list or `no_change`, never an invented id

Suggested automated tests:

- pgTAP tests for canonical seed repair, undeletable canonical rows, flat built-in taxonomy invariants, built-in mapping seeds, import-time auto-apply, replay scopes, person-scoped rule isolation, and deterministic rule evaluation
- Vitest tests for hooks and rules UI components
- Edge Function tests for `money-categorize`
- Playwright flow covering categories setup, rule creation, pipeline apply, and debug inspection

## Idempotence and Recovery

The canonical category seed and mapping seed functions must be idempotent. Running them multiple times must repair missing canonical rows and preserve stable ids or system keys without duplicating rows.

If a migration partially succeeds during local development, rerun `just db-reset` to rebuild the local Supabase database from scratch. During implementation, never manually delete canonical rows to "fix" state drift; use the repair function or reset command instead.

If an LLM rule misbehaves, the user must be able to disable that rule without disabling the rest of the pipeline. Deterministic rules and their debug history must remain usable even when the LLM rule is off. Import-time auto-apply must degrade safely: if an LLM step fails, the run should record the failure in debug output and continue according to the rule's configured no-change behavior rather than blocking the import.

## Artifacts and Notes

Add concise evidence here as implementation proceeds. At minimum capture:

- the canonical category seed result after `db-reset`
- the built-in MCC and source-category mapping seed result after `db-reset`
- one deterministic rule preview transcript
- one persisted debug transcript showing multiple pipeline steps
- one replay transcript for a transaction and one for a date-range batch, both showing person scope
- one LLM debug payload example with `no_change` and one with a category selection

## Interfaces and Dependencies

The following repository surfaces must exist at the end of implementation.

In `src/types/money.ts`, define types for:

- `MoneyCategoryKind`
- `MoneyCategoryRuleKind`
- `MoneyCategoryRule`
- `MoneyCategoryRuleRun`
- `MoneyCategoryRuleRunStep`

In `src/hooks/use-money-categories.ts`, extend `MoneyCategoryTreeNode` and fetched category types so the UI can distinguish canonical and custom rows and can show canonical branch metadata.

In `src/hooks/use-money-category-rules.ts`, expose hooks for:

- listing rules for a person
- creating and updating rules
- deleting rules
- reordering rules
- previewing the pipeline for one line item
- applying the pipeline to one or many line items
- replaying the pipeline for one transaction
- replaying the pipeline for a date-range batch

In `supabase/functions/money-categorize/`, define:

- `createMoneyCategorizeHandler(deps)`
- a repository adapter for loading line-item context and persisting debug traces
- an LLM client adapter that accepts a fixed JSON schema response

In the database layer, ensure the following callable interfaces exist:

- `public.money_seed_canonical_categories()`
- `public.money_preview_category_rule_pipeline(...)`
- `public.money_apply_category_rule_pipeline(...)`
- `public.money_apply_category_rule_pipeline_for_transaction(...)`
- `public.money_apply_category_rule_pipeline_for_date_range(...)`
- `public.money_get_category_rule_debug(...)`

The implementation should reuse existing money transaction and line-item queries rather than introducing a second read model for categories or pipeline history.

## Revision Note

Created on 2026-03-10 to capture the requested feature for undeletable canonical money categories, user custom categories, ordered categorization rules, smart rules, and line-item pipeline debugging.

Updated on 2026-03-10 to reflect three product decisions: automatic pipeline execution for every imported line item with replay scopes for line item, transaction, and date-range batch; a flat one-level built-in category taxonomy instead of a built-in tree; and LLM categorization using both canonical and custom category candidates.

Updated on 2026-03-10 again to scope rules per person instead of globally, with automatic import-time runs using `payer_person_id` and replay actions preserving person isolation.

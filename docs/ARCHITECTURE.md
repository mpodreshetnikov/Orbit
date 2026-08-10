# Architecture

## Purpose And Scope

This document is the top-level architecture map for the repository. It defines runtime surfaces, domain boundaries, layer boundaries, and a scored maturity baseline that can be tracked over time.

Related docs:

- Design patterns and deep design docs: [`docs/DESIGN.md`](./DESIGN.md)
- Quality operating model and scoring algorithm: [`docs/QUALITY.md`](./QUALITY.md)
- Security model and review checklist: [`docs/SECURITY.md`](./SECURITY.md)
- Operations and debugging procedures: [`docs/RUNBOOK.md`](./RUNBOOK.md)

## Runtime Surface Map

| Surface                              | Primary Entry Points                                                                                                                                                                                                             | Responsibilities                                                               | Core Dependencies                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Web app (Next.js)                    | `src/app/layout.tsx`, `src/app/health/*`, `src/app/money/*`, `src/app/api/*`                                                                                                                                                     | User-facing UI, route orchestration, authenticated API routes                  | React, Next.js App Router, React Query, Supabase client/server SDK |
| Database runtime (Supabase Postgres) | `supabase/migrations/*`, `supabase/db/deploy.sql`, `supabase/db/functions/*`, `supabase/db/policies/*`, `supabase/db/cron/jobs.sql`                                                                                              | Durable schema, RLS, RPC functions, triggers, cron scheduling                  | Postgres, pg_cron, pg_net, RLS helpers                             |
| Edge Functions                       | `supabase/functions/health-ocr/index.ts`, `supabase/functions/health-structure/index.ts`, `supabase/functions/money-import/index.ts`, `supabase/functions/notifications-cron/index.ts`, `supabase/functions/icd-lookup/index.ts` | External integration and workflow execution (OCR/LLM/import/push)              | Supabase service role, external APIs, DB RPCs                      |
| Browser extension                    | `browserExtension/src/background.ts`, `browserExtension/src/content-script.ts`, `browserExtension/src/connectors/*`, `browserExtension/popup-src/main.tsx`                                                                       | Web-export ingestion bridge (currently T-Bank web), session-driven import runs | Chrome APIs, money-import function, web app message bridge         |
| PWA service worker                   | `public/sw.js`                                                                                                                                                                                                                   | Push notification rendering, action handling, message bridge with app          | Notifications API, app API routes, stored locale cache             |
| MCP connector                        | `src/app/api/mcp/route.ts`, `src/app/api/oauth/*`, `src/app/.well-known/*`, `src/app/oauth/authorize/page.tsx`                                                                                                                   | Agent-facing Health tools over MCP, with an in-app OAuth 2.1 server            | `mcp-handler`, `@modelcontextprotocol/server`, zod, Supabase Auth  |

## Domain Map

### Product Domains

#### Health

- Primary routes:
  - `src/app/health/page.tsx`
  - `src/app/health/records/*`
  - `src/app/health/medications/*`
  - `src/app/health/measurements/*`
  - `src/app/health/observations/*`
  - `src/app/health/findings/*`
  - `src/app/health/conditions/*`
  - `src/app/health/checkups/*`
  - `src/app/health/catalogs/*`
- Primary hooks/components:
  - `src/hooks/use-medical-records.ts`, `src/hooks/use-background-ocr.ts`, `src/hooks/use-structure-extraction.ts`
  - `src/hooks/use-observation-history.ts`, `src/hooks/use-measurements.ts`, `src/hooks/use-finding-history.ts`
  - `src/hooks/use-conditions.ts`, `src/hooks/use-checkups.ts`, `src/hooks/use-regimens.ts`
  - `src/components/records/*`, `src/components/medications/*`, `src/components/checkups/*`, `src/components/conditions/*`
- DB tables/policies/functions:
  - tables: `medical_records`, `record_attachments`, `record_observations`, `measurements`, `record_findings`, `conditions`, `condition_records`, `checkup_items`, `checkup_completions`, `med_regimens`, `med_dose_events`, `med_inventory_transactions`
  - policies: `supabase/db/policies/medical_records.sql` and related health policy files
  - functions: `search_medical_records`, `get_record_observations`, `get_record_findings`, `get_record_conditions`, medication/checkup generators and reminder functions
- Edge/API surfaces:
  - edge: `health-ocr`, `health-structure`, `icd-lookup`, `notifications-cron`
  - API routes: `src/app/api/medications/*`, `src/app/api/notifications/*`, `src/app/api/push-subscribe/route.ts`
  - MCP tools: `src/app/api/mcp/route.ts` with `src/lib/mcp/tools/*` over `src/lib/mcp/health/*`; design in `docs/design/domains/health/mcp-server.md`
- Shared server-side logic (used by both API routes and MCP tools):
  - `src/lib/medications/regenerate-dose-events.ts`, `src/lib/regimen-mappers.ts`

#### Money

- Primary routes:
  - `src/app/money/transactions/*`
  - `src/app/money/import/*`
  - `src/app/money/accounts/page.tsx`
  - `src/app/money/categories/page.tsx`
- Primary hooks/components:
  - `src/hooks/use-money-transactions.ts`, `src/hooks/use-money-accounts.ts`, `src/hooks/use-money-cards.ts`, `src/hooks/use-money-categories.ts`, `src/hooks/use-money-merchant-default-categories.ts`
  - `src/components/money/transaction-form.tsx`, `src/components/money/line-item-editor.tsx`
- DB tables/policies/functions:
  - tables: `money_accounts`, `money_cards`, `money_categories`, `money_transactions`, `money_line_items`, `money_import_batches`, `money_import_sessions`, `money_import_batch_rows`
  - policies: `supabase/db/policies/money_*.sql`
  - functions: `money_upsert_transactions_batch`, `get_money_merchant_default_categories`
- Edge/API surfaces:
  - edge: `money-import`
  - web/extension bridge: `src/app/money/import/page.tsx`, `browserExtension/src/background.ts`, `browserExtension/src/connectors/tbank-web.ts`

### Cross-Cutting Domains

#### Auth And Allowlist

- Middleware gate: `src/middleware.ts`, `src/lib/supabase-middleware.ts`
- Server auth helpers: `src/lib/supabase-server.ts`
- DB allowlist helpers: `supabase/db/functions/_is_allowed_user.sql`, `supabase/db/functions/link_allowed_user.sql`
- Allowlist table/policy: `allowed_users` + `supabase/db/policies/allowed_users.sql`

#### Notifications And Push

- Notification polling/actions in app: `src/hooks/use-notifications.ts`, `src/hooks/use-ensure-push-subscription.ts`
- Service worker execution: `public/sw.js`
- API routes: `src/app/api/notifications/*`, `src/app/api/push-subscribe/route.ts`
- DB/cron: `notification_digests`, `push_subscriptions`, `notification_routing`, `supabase/db/cron/jobs.sql`

#### i18n And Locale

- Locale resolution/messages: `src/i18n/request.ts`, `src/messages/en.json`, `src/messages/ru.json`
- UI language state/sync: `src/stores/ui-store.ts`, `src/components/layout/language-toggle.tsx`, `src/components/layout/language-sync.tsx`

#### Import Connector And Extension

- Web connector registry: `src/lib/import/connector-types.ts`, `src/lib/import/connectors/*`
- Extension connector registry: `browserExtension/src/connectors/*`
- Import session and batch reporting model: `money_import_sessions`, `money_import_batch_rows`

#### DB Deploy And Operations

- Migration history: `supabase/migrations/*`
- Idempotent deploy track: `supabase/db/deploy.sql` and phases `01_types_functions.sql` to `04_cron.sql`
- Local/CI execution wiring: `justfile`, `scripts/just/*`, `.github/workflows/main.yml`

## Layer Map And Dependency Rules

### Layer Definitions

1. Presentation And Navigation
   - Routes/layouts/components (`src/app`, `src/components/layout`, domain UI components).
2. Application Orchestration
   - Hooks/stores/query cache (`src/hooks`, `src/stores`, provider wiring).
3. Domain Workflow Logic
   - Edge Functions and SQL workflow functions/triggers/cron (`supabase/functions`, `supabase/db/functions`, `supabase/db/triggers`, `supabase/db/cron`).
4. Data Governance
   - Schema/migrations/RLS/policies/types (`supabase/migrations`, `supabase/db/policies`, enum/type SQL).
5. Delivery And Operations
   - CI/CD, deploy scripts, preflight checks, runbook (`.github/workflows`, `scripts/just`, docs ops guides).

### Dependency Rules

- Rule L1: Presentation may depend on layer 2 contracts, but should not duplicate durable business rules from layers 3-4.
- Rule L2: Hooks and stores may orchestrate API/RPC calls, but invariants belong in SQL/Edge workflow boundaries.
- Rule L3: Edge and SQL workflow logic may depend on layer 4 structures and helper functions, never on layer 1 component assumptions.
- Rule L4: All user data tables must have explicit RLS/policy coverage in `supabase/db/policies`.
- Rule L5: Delivery changes that mutate DB behavior must update both migration history and idempotent deploy track when applicable.

## Maturity Scoring Model (Strict Baseline)

### Criteria And Weights

- Functional completeness: 20%
- Data/rule integrity: 25%
- Reliability/failure handling: 20%
- Maintainability/modularity: 20%
- Testability/observability: 15%

### Formula

`weighted_score = 0.20*functional + 0.25*integrity + 0.20*reliability + 0.20*maintainability + 0.15*testability`

- Each criterion is scored on a 0-100 scale.
- Weighted score is rounded to nearest integer.
- Baseline snapshot date: `2026-02-20`.

### Architecture Scorecard Row Schema

Use this schema for each domain/layer row when updating history:

- `date` (ISO date): snapshot date
- `scope` (string): domain or layer name
- `functional` (0-100)
- `integrity` (0-100)
- `reliability` (0-100)
- `maintainability` (0-100)
- `testability` (0-100)
- `score` (0-100 weighted rounded)
- `delta` (integer): change from previous snapshot
- `evidence` (list of file/command refs)
- `gaps` (list of gap IDs)

## Product-Domain Maturity Scorecard (Baseline `2026-02-20`)

| Domain   | Functional | Integrity | Reliability | Maintainability | Testability | Weighted Score | Delta | Evidence                                                                                        | Gap IDs                                                    |
| -------- | ---------: | --------: | ----------: | --------------: | ----------: | -------------: | ----: | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `health` |         75 |        71 |          66 |              62 |          64 |             68 |   `0` | `src/app/health/*`, `src/hooks/use-regimens.ts`, `supabase/functions/health-structure/index.ts` | `ARCH-G01`, `ARCH-G02`, `ARCH-G03`, `ARCH-G04`, `ARCH-G05` |
| `money`  |         63 |        58 |          53 |              51 |          54 |             56 |   `0` | `src/app/money/*`, `src/app/money/import/page.tsx`, `supabase/functions/money-import/index.ts`  | `ARCH-G01`, `ARCH-G03`, `ARCH-G04`, `ARCH-G05`             |

## Architectural-Layer Maturity Scorecard (Baseline `2026-02-20`)

| Layer                     | Functional | Integrity | Reliability | Maintainability | Testability | Weighted Score | Delta | Evidence                                                                                                           | Gap IDs                            |
| ------------------------- | ---------: | --------: | ----------: | --------------: | ----------: | -------------: | ----: | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Presentation/navigation   |         68 |        60 |          60 |              60 |          57 |             61 |   `0` | `src/components/layout/app-shell.tsx`, `src/components/layout/top-nav.tsx`, `src/components/layout/mobile-nav.tsx` | `ARCH-G01`, `ARCH-G06`             |
| Application orchestration |         61 |        53 |          54 |              51 |          53 |             54 |   `0` | `src/hooks/*`, `src/stores/*`, `src/components/providers/query-provider.tsx`                                       | `ARCH-G01`, `ARCH-G02`             |
| Domain workflow logic     |         63 |        59 |          55 |              52 |          53 |             57 |   `0` | `supabase/functions/*`, `supabase/db/functions/*`, `supabase/db/cron/jobs.sql`                                     | `ARCH-G01`, `ARCH-G05`             |
| Data governance           |         66 |        68 |          63 |              59 |          58 |             63 |   `0` | `supabase/migrations/*`, `supabase/db/policies/*`, `supabase/db/deploy.sql`                                        | `ARCH-G05`                         |
| Delivery/operations       |         55 |        46 |          44 |              45 |          43 |             47 |   `0` | `.github/workflows/main.yml`, `justfile`, `scripts/just/build-local-all.cjs`                                       | `ARCH-G03`, `ARCH-G04`, `ARCH-G06` |

## Gap Ledger

| Gap ID     | Gap                                                                   | Why It Matters                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARCH-G01` | Monolithic hotspots in UI and function layers                         | Large files increase regression risk and slow refactors/reviews                             | `src/components/records/record-detail.tsx`, `src/components/records/structure-review-step.tsx`, `src/components/medications/medication-form.tsx`, `supabase/functions/health-structure/index.ts`, `supabase/functions/money-import/index.ts`                                                                                                          |
| `ARCH-G02` | Legacy/dead-path logic is still exported                              | Increases cognitive load and risk of accidental reuse of stale behavior                     | `src/hooks/use-medications.ts`, `src/hooks/index.ts`, `src/hooks/use-medical-records.ts` (`useIngestRecord`) and missing `supabase/functions/ingest-record`                                                                                                                                                                                           |
| `ARCH-G03` | CI does not enforce lint/type/smoke gates before deploy               | Quality regressions can merge if local gates are skipped                                    | `.github/workflows/main.yml` currently runs secret scan + deploy jobs only                                                                                                                                                                                                                                                                            |
| `ARCH-G04` | Runtime-split unit and pgTAP lanes are newly seeded but still shallow | Core harness exists, but confidence still depends on expanding per-domain behavior coverage | command map in `justfile` (`test-unit*`, `quality-db-test`, `check`), early-stage suite depth in `src/**/*.test.*`, `browserExtension/**/*.test.*`, `supabase/tests/*`                                                                                                                                                                                |
| `ARCH-G05` | RLS granularity is mostly allowlist-first, not always owner-scoped    | Works for trusted shared-family model but weakens strict least-privilege partitioning       | `supabase/db/policies/money_transactions.sql`, `supabase/db/policies/medical_records.sql`, widespread `public.is_allowed_user()` usage. The MCP connector inherits this model rather than widening it: its tools query through a user-scoped JWT, so they see exactly what the same user sees in the browser (`src/lib/mcp/supabase-user-client.ts`). |
| `ARCH-G06` | Documentation map drift in rules/plans locations                      | Slows onboarding and creates ambiguity on canonical planning paths                          | `AGENTS.md` references `docs/PLANS.md/` while planning content is split across `docs/PLANS.md` and `docs/exec-plans/`                                                                                                                                                                                                                                 |

## Score History Log And Update Cadence

### Update Cadence

- Monthly architecture review (minimum once per month).
- Additional update on major releases that include DB or workflow changes.
- Every update must include:
  - new weighted scores,
  - deltas,
  - updated evidence links,
  - status changes in gap ledger.

### History Log

| Date         | Scope                            | Score | Delta | Notes                    |
| ------------ | -------------------------------- | ----: | ----: | ------------------------ |
| `2026-02-20` | Domain: `health`                 |    68 |   `0` | Baseline strict snapshot |
| `2026-02-20` | Domain: `money`                  |    56 |   `0` | Baseline strict snapshot |
| `2026-02-20` | Layer: Presentation/navigation   |    61 |   `0` | Baseline strict snapshot |
| `2026-02-20` | Layer: Application orchestration |    54 |   `0` | Baseline strict snapshot |
| `2026-02-20` | Layer: Domain workflow logic     |    57 |   `0` | Baseline strict snapshot |
| `2026-02-20` | Layer: Data governance           |    63 |   `0` | Baseline strict snapshot |
| `2026-02-20` | Layer: Delivery/operations       |    47 |   `0` | Baseline strict snapshot |

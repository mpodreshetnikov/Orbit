# Money Domain Design

## Scope

Money domain covers accounts/cards/categories, transaction ledger with line items, and import workflows (file + extension).

## Domain Surfaces

- Routes: `src/app/money/*`
- Components: `src/components/money/*`
- Hooks: `src/hooks/use-money-accounts.ts`, `use-money-cards.ts`, `use-money-categories.ts`, `use-money-transactions.ts`, `use-money-merchant-default-categories.ts`
- Edge: `supabase/functions/money-import/index.ts`
- Extension connectors: `browserExtension/src/connectors/*`
- SQL: money tables, policies, and import/reporting SQL in `supabase/migrations/*`, `supabase/db/*`

## Design Documents

- Ledger and line items: [`ledger-and-line-items.md`](./ledger-and-line-items.md)
- Import framework: [`import-framework-file-and-extension.md`](./import-framework-file-and-extension.md)
- Accounts/cards/categories mapping: [`accounts-cards-categories-and-mapping.md`](./accounts-cards-categories-and-mapping.md)

## Domain Boundaries

- In scope: ingestion, normalization, dedupe/idempotent persistence, review and correction in app.
- Out of scope: direct banking APIs, full investment platform, generalized finance forecasting engine.

## Current Limits

- Connector coverage is still limited (primary T-Bank paths).
- Import parsing/normalization logic is concentrated in large files.
- Domain-level automated tests are minimal.

## References

- [`docs/ARCHITECTURE.md`](../../../ARCHITECTURE.md)
- [`docs/QUALITY.md`](../../../QUALITY.md)
- [`docs/RUNBOOK.md`](../../../RUNBOOK.md)

# Money Ledger And Line Items

## Intent

Define canonical ledger design and invariants for transactions and line-item composition.

## Current Implementation In This Repo

### Core entities

- `money_accounts`: ownership and account metadata.
- `money_cards`: card-last4 mapping used for import reconciliation.
- `money_transactions`: canonical transaction-level rows.
- `money_line_items`: composition-level rows with category and beneficiary assignment.
- `money_categories`: category hierarchy.

### Data access and editing

- `src/hooks/use-money-transactions.ts` handles list/detail/create/update/delete.
- UI entry points:
  - `src/app/money/transactions/page.tsx`
  - `src/app/money/transactions/new/page.tsx`
  - `src/app/money/transactions/[id]/page.tsx`
  - `src/components/money/transaction-form.tsx`

## Rules To Follow

1. Every transaction should preserve at least one meaningful line-item representation.
2. Keep transaction and line-item changes consistent (avoid partial updates).
3. Preserve dedupe-related fields for imported rows (`source`, `external_id`, `dedupe_hash`).
4. Category and beneficiary assignment must remain optional but explicit.
5. Keep money enum semantics synchronized between SQL and TypeScript types.

## Anti-Patterns To Avoid

- Mutating imported ledger rows without preserving provenance fields.
- Category logic hardcoded in UI without shared mapping helpers.
- Breaking line-item consistency during transaction edits.

## Tradeoffs

- Line-item granularity increases reporting power but adds reconciliation complexity.
- Manual editing flexibility can conflict with strict import idempotency if provenance is ignored.

## Known Gaps And Next Refactor Targets

- Split large form files into reusable transaction/line-item modules.
- Expand reporting helpers beyond current list/detail and import reports.

## References

- `src/types/money.ts`
- `supabase/migrations/20260206000000_create_money_core.sql`
- `supabase/db/functions/money_upsert_transactions_batch.sql`

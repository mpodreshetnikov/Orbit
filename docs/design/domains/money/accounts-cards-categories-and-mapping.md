# Money Accounts, Cards, Categories, And Mapping

## Intent

Define ownership and mapping model used to connect imported transaction hints to durable account/card/category entities.

## Current Implementation In This Repo

### Entities

- Accounts: `money_accounts`
- Cards (last4 mapping): `money_cards`
- Categories tree: `money_categories`
- Merchant defaults helper: `get_money_merchant_default_categories`

### Hook and UI surfaces

- hooks:
  - `src/hooks/use-money-accounts.ts`
  - `src/hooks/use-money-cards.ts`
  - `src/hooks/use-money-categories.ts`
  - `src/hooks/use-money-merchant-default-categories.ts`
- routes/pages:
  - `src/app/money/accounts/page.tsx`
  - `src/app/money/categories/page.tsx`
  - `src/app/money/import/page.tsx`

### Mapping behavior

- Import rows may carry `account_hint` (for example card last4).
- Import UI maps hints to accounts/cards before persistence.
- Missing mappings can be resolved by creating account/card records inline.

## Rules To Follow

1. Account ownership always ties to `owner_person_id`.
2. Card records should normalize to stable last4 format.
3. Category tree depth and slug constraints should remain consistent with DB rules.
4. Mapping defaults should be transparent and editable by user.
5. Import paths should never assume mapping exists for all source rows.

## Anti-Patterns To Avoid

- Hardcoding source-specific account assumptions in transaction write path.
- Mixing account ownership semantics with payer attribution semantics.
- Category writes that bypass tree constraints.

## Tradeoffs

- Last4 card mapping is practical and fast, but imperfect for ambiguous or shared cards.
- Hierarchical categories are expressive but require careful CRUD handling.

## Known Gaps And Next Refactor Targets

- Expand mapping heuristics with auditable confidence and explicit conflict resolution.
- Add more domain tests around mapping edge cases and dedupe interactions.

## References

- `supabase/migrations/20260210100000_create_money_cards.sql`
- `supabase/migrations/20260210200000_add_money_transactions_card_id.sql`
- `src/lib/import/connectors/tbank-csv.ts`

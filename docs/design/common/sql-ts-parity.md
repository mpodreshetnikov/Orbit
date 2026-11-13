# SQL ↔ TypeScript parity for dual-implemented rules

Canonical recipe when the same business rule is evaluated in SQL (pgTAP / RPCs) and in
TypeScript (Vitest or Deno). Mutation and coverage floors do not prove the twins agree.

## When this applies

- Money category rule filters (`money_evaluate_category_rule_filter` ↔ Deno
  `evaluateRuleFilter` in `supabase/functions/money-categorize/service.ts`)
- Any future dual-implemented predicate (regex, operators, windows, allowlists)

Vitest helpers under `src/lib/money/rule-filter-text.ts` are **property-test oracles**, not a
third production path — keep them aligned when the Deno/SQL twins change.

## Recipe

1. **One shared fixture table** of `(input, expected)` cases — titles, merchants, amounts,
   operators, values. Prefer JSON/CSV or a temp SQL table that both runners can read, or
   duplicate the same literals with a comment cross-link both ways.
2. **SQL side:** pgTAP asserts `public.<fn>(…)` against each fixture row (`db-test`).
3. **TS/Deno side:** unit tests call the twin with the same fixtures — assert the same booleans
   / outcomes. Do **not** re-encode the SQL in the TS test (no mirror-of-implementation).
4. **Regex note:** document whether matching is raw vs normalized and case-sensitive
   (Postgres `~` vs `RegExp`) so a parity failure is actionable.
5. **Gap ownership:** closing missing operator/parity cases for money filters is
   `T-261113-qgz` / Orbit #272. New dual rules start with this recipe; do not reopen qgz scope
   from unrelated tasks.

## Anti-patterns

- Asserting only that a TS helper “looks like” the SQL comment
- Separate fixture sets that silently diverge
- Treating line coverage on either twin as proof they agree

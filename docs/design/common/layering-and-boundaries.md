# Layering And Boundaries

## Intent

Define clear boundaries between presentation, orchestration, workflow logic, data governance, and delivery layers so responsibilities are explicit and testable.

## Current Implementation In This Repo

- Presentation: `src/app/*`, `src/components/*`
- Orchestration: `src/hooks/*`, `src/stores/*`, providers in `src/components/providers/*`
- Workflow logic: `supabase/functions/*` and SQL workflow functions in `supabase/db/functions/*`
- Data governance: `supabase/migrations/*`, `supabase/db/policies/*`, type/function SQL
- Delivery: `.github/workflows/main.yml`, `justfile`, `scripts/just/*`

## Rules To Follow

1. Keep route/page files focused on composition and navigation, not business invariants.
2. Keep reusable client orchestration in hooks/lib.
3. Move cross-surface invariants to SQL/edge workflow boundaries.
4. Preserve migration track and deploy track parity for DB behavior changes.
5. Document layer ownership when introducing a new workflow.

## Anti-Patterns To Avoid

- Implementing integrity rules only in component event handlers.
- Calling external systems directly from multiple layers for same workflow.
- Embedding SQL business logic assumptions in UI components.

## Tradeoffs

- DB-centric logic improves correctness but can increase SQL complexity.
- Edge function orchestration improves isolation but adds operational surfaces.
- Extra boundary clarity increases upfront design work and reduces regression risk later.

## Known Gaps And Next Refactor Targets

- Very large files in presentation and workflow layers create boundary blur.
- Some legacy hooks still expose superseded models (`use-medications`).

## References

- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md)
- [`docs/design/common/state-and-data-fetching.md`](./state-and-data-fetching.md)
- [`docs/design/common/auth-rls-and-trust-boundaries.md`](./auth-rls-and-trust-boundaries.md)

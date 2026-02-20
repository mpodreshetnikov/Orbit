# State And Data Fetching

## Intent

Standardize client-side state ownership and data access behavior across routes.

## Current Implementation In This Repo

- Query and mutation orchestration: React Query (`@tanstack/react-query`) in hooks.
- Supabase clients:
  - browser client in `src/lib/supabase.ts`
  - server clients in `src/lib/supabase-server.ts` and middleware client in `src/lib/supabase-middleware.ts`
- UI state:
  - `src/stores/ui-store.ts` for language/person selection
  - `src/stores/processing-queue-store.ts` for OCR job queue UI

## Rules To Follow

1. Data access from UI should flow through hooks, not ad-hoc inline queries.
2. Query keys must be explicit and invalidation should be targeted to affected scopes.
3. Persist only small UI preferences in Zustand; avoid duplicating server state in stores.
4. Use server Supabase clients for server components/routes.
5. Keep external side effects (fetch to functions/APIs) behind hooks with clear error surfaces.

## Anti-Patterns To Avoid

- Duplicate Supabase queries inside components that already have hooks.
- Cache invalidation on broad keys when targeted invalidation is possible.
- Storing mutable server records in local store long-term.

## Tradeoffs

- Hook-heavy orchestration improves reuse but can produce oversized hooks if extraction is delayed.
- React Query caching improves UX but requires disciplined invalidation.

## Known Gaps And Next Refactor Targets

- Several hooks exceed maintainable size (`use-conditions`, `use-regimens`).
- Stale/legacy hook path remains exported (`use-medications`).

## References

- `src/components/providers/query-provider.tsx`
- `src/hooks/index.ts`
- [`docs/design/common/error-handling-and-observability.md`](./error-handling-and-observability.md)

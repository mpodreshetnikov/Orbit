# UI Shell, Navigation, And Person Context

## Intent

Describe shared UI shell behavior, app-section navigation model, and person context propagation.

## Current Implementation In This Repo

- Shared shell: `src/components/layout/app-shell.tsx`
- Section routing helper: `src/lib/app-section.ts`
- Top and mobile navigation:
  - `src/components/layout/top-nav.tsx`
  - `src/components/layout/sidebar.tsx`
  - `src/components/layout/mobile-nav.tsx`
- Person selection and URL sync:
  - `src/components/layout/person-selector.tsx`
  - `src/components/layout/person-id-from-url-sync.tsx`
  - `src/stores/ui-store.ts`

## Rules To Follow

1. Keep shell behavior consistent between `health` and `money` sections.
2. Person context must be explicit and resilient (selector + URL sync for deep links).
3. Top-level navigation entries should correspond to concrete domain route roots.
4. Language and theme state must remain synchronized with runtime consumers.
5. New global UI controls should be added in shell-level components, not duplicated per route.

## Anti-Patterns To Avoid

- Domain-specific shell forks unless behavior cannot be shared.
- Hidden person context assumptions in domain components.
- Hardcoding section logic outside `getAppSection`-style helpers.

## Tradeoffs

- Shared shell maximizes consistency but can become crowded with cross-domain controls.
- URL-based person sync supports notifications and deep links but needs careful cleanup of query params.

## Known Gaps And Next Refactor Targets

- Navigation docs and rule-map drift should be monitored against AGENTS routing notes.
- UI shell features should be periodically audited for separation of cross-domain vs domain-specific controls.

## References

- `src/app/health/layout.tsx`
- `src/app/money/layout.tsx`
- `src/components/layout/language-sync.tsx`
- [`docs/design/common/layering-and-boundaries.md`](./layering-and-boundaries.md)

# Unit Test Matrix

## Principle

Behavior changes require matching unit-test changes in the same change set.

## Runtime lanes

- Web/client + server components:
  - `test-unit-web`
- Browser extension:
  - `test-unit-ext`
- Node/tooling runtime:
  - `test-unit-node`
- Supabase functions (Deno):
  - `test-unit-functions`

Run aggregate fast lane after targeted lanes:

- `test-unit`

## Suggested sequence

1. Run lane(s) impacted by changed files.
2. Fix failures.
3. Run `test-unit`.
4. Run `ci-fast` during iteration.
5. Run `ci` before non-doc handoff.

## Test quality checks

- Assert changed behavior, not unrelated internals.
- Cover happy path and at least one failure/edge branch.
- Keep mocks minimal and deterministic.

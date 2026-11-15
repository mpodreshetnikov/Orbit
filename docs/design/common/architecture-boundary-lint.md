# Architecture Boundary Lint (Pilot)

Warn-only machine check for a narrow slice of
[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) dependency rules and the mobile Metro allowlist.
Owned by registry task `T-261115-csy` (B5). Scorecard / CodeQL doc refresh is a separate task (B8).

## Command

- `lint-boundaries`: `just quality-lint-boundaries`
- Wired into `quality-lint` / `quality-lint-parallel` **without** `--max-warnings=0`, so warnings do
  not fail Quality Gates while the pilot stays in `warn` mode.

Config: [`eslint.boundaries.config.mjs`](../../../eslint.boundaries.config.mjs) (separate from the
product ESLint config so Deno edge sources are not run through Next.js rules).

## Tool

**eslint-plugin-boundaries** (not dependency-cruiser). Fits the existing ESLint lanes, resolves
TypeScript path aliases (`@orbit-types/*`, `@orbit-messages/*`, `@db`), and covers the three pilot
surfaces without a second graph tool. Revisit dependency-cruiser only if Deno URL imports or
non-ESLint surfaces outgrow this config.

## Rules Covered

| Bullet               | Rule                   | From                 | Disallow (targets)                                                      |
| -------------------- | ---------------------- | -------------------- | ----------------------------------------------------------------------- | ---------- | ----- | --- | ---------------------------------------------- |
| (a) Mobile allowlist | Metro + ARCH isolation | `mobile/src`         | web `src/app                                                            | components | hooks | lib | stores`, edge, migrations, other `supabase/db` |
| (a) allow            | —                      | `mobile/src`         | may import `src/types`, `src/messages`, `supabase/db/database.types.ts` |
| (b) L1↛L3/L4 deep    | Rule L1 surface        | `src/app`            | `supabase/functions`, `supabase/migrations`, `supabase/db`              |
| (c) L3↛L1            | Rule L3                | `supabase/functions` | `src/app`, `src/components`, `mobile/src`, plus hooks/lib/stores        |

Related product fence (already **error** in `eslint.config.mjs`): all of `src/**` uses
`no-restricted-imports` against extension/scripts/supabase functions|migrations|db. The pilot restates
the `src/app` slice via boundaries so the same graph is visible on the warn path.

## Severity Path

1. **Now:** `boundaries/element-types` = `warn`; recipe omits `--max-warnings=0`.
2. **After** a clean warn phase (zero open findings, exceptions listed below): flip to `error` and add
   `--max-warnings=0` on `quality-lint-boundaries`.

## Exceptions / False Positives

None open at pilot introduction (clean warn run on `mobile/src`, `src/app`, `supabase/functions`).
When a finding is accepted rather than fixed, add a dated row here (path, rule bullet, reason) — do
not silence with broad ignores.

**Triaged during pilot (fixed in config, not excepted):** default element `mode: "folder"` walked
path suffixes so `src/components/**` also matched `mobile/src/components/**`. All descriptors use
`mode: "full"` to keep mobile and web trees distinct.

## Out Of Scope

Full L1–L5 suite, health↛money domain isolation, knip/Nx, mobile Android QG, coverage floor, ARCH
scorecard refresh (B8).

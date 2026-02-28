---
name: feature-bugfix-validation
description: Validate feature work and bugfixes end-to-end. Use this when implementing or reviewing app changes that need UI flow checks with playwright-cli plus unit test updates/execution and local dev auth bypass setup for fast sign-in.
---

# Feature/Bugfix Validation

Use this skill for feature and bugfix verification in this repository.

## When To Use

- A change affects user-visible UI flows and needs quick browser validation.
- A bugfix changes runtime behavior and needs unit coverage updates.
- Local testing is blocked by Google OAuth and you need dev auth bypass.

## Required Workflow

1. Start local environment:
   - default auth flow: `dev-ready`
   - bypass auth flow: `dev start bypass`
2. Validate affected UI flows using `playwright-cli`.
3. Add or update unit tests for changed units.
4. Run relevant unit lanes, then aggregate unit tests.
5. Run final confidence gates before handoff.

## UI Flow Validation (playwright-cli)

Follow [references/ui-flow-checklist.md](references/ui-flow-checklist.md).

Minimum expectations:

- Open target route and capture snapshot evidence.
- Execute happy path.
- Execute at least one failure/edge path.
- Verify redirect and auth-gated behavior when relevant.

## Unit Test Validation

Follow [references/unit-test-matrix.md](references/unit-test-matrix.md).

Minimum expectations:

- Update/add tests for changed behavior in the same change set.
- Run lane-specific commands first, then `test-unit`.
- Keep tests deterministic and focused on changed logic.

## Local Dev Auth Bypass

Follow [references/local-dev-auth-bypass.md](references/local-dev-auth-bypass.md).

Use it to skip Google OAuth in local development and sign in as any email for testing.
For quick seeded access in local DB, the default allowlisted email is `dev@example.com`.

## Final Gates

Use command IDs from `AGENTS.md` and enforce:

- Iteration: `ci-fast`
- Final non-doc handoff: `ci`

If a gate cannot run due environment blockers, report the blocker and the exact command.

---
name: e2e-user-behaviour-validation
description: Mandatory for changes that affect end-to-end user behaviour. Use this skill to test and verify e2e user behaviour via playwright-cli UI flows, unit test updates/execution, and local dev auth bypass for fast sign-in.
---

# E2E User Behaviour Validation

**Use this skill whenever a change affects end-to-end user behaviour.** The agent must test and verify that e2e behaviour before handoff.

## When To Use (mandatory)

- **Any change that affects end-to-end user behaviour** — use this skill and run the workflow below.
- A change affects user-visible UI flows and needs browser validation.
- A bugfix or feature changes runtime behaviour and needs unit coverage plus e2e checks.
- Local testing is blocked by Google OAuth and you need dev auth bypass.

If in doubt whether a change affects e2e user behaviour, treat it as affecting it and run this validation.

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
- Verify redirect and auth-gated behaviour when relevant.

## Unit Test Validation

Follow [references/unit-test-matrix.md](references/unit-test-matrix.md).

Minimum expectations:

- Update/add tests for changed behaviour in the same change set.
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

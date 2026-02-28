# UI Flow Checklist (playwright-cli)

## Goal

Verify changed UI behavior quickly with reproducible browser steps.

## Steps

1. Start local stack with `dev-ready`.
2. Open browser session:
`playwright-cli open http://127.0.0.1:3000`
3. Navigate to impacted route(s) and capture baseline:
`playwright-cli snapshot`
4. Execute happy-path interactions.
5. Execute at least one failure or edge path.
6. Capture final snapshot(s).
7. Close session:
`playwright-cli close`

## Auth-sensitive Flows

- If testing auth-gated pages, use local dev bypass flow before protected-route checks.
- Confirm redirect behavior:
  - unauthenticated -> `/login`
  - allowlisted/authenticated -> protected page (for example `/health`)

## Evidence To Record

- Route tested.
- Actions performed.
- Expected vs actual result.
- Snapshot file names if captured.

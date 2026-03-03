# UI Flow Checklist (playwright-cli)

## Goal

Verify changed UI behavior quickly with reproducible browser steps.

## Steps

1. Start local stack: use **bypass** unless you need to verify auth flow (login/OAuth/redirects). Run `dev start bypass` (or `just dev start bypass`); if the stack is already running, ensure it was started with bypass. Use `dev-ready` only when the task explicitly requires testing the real auth flow.
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

- **When not verifying auth:** Always use bypass (step 1). Sign in via Local dev sign in on `/login` for fast access to auth-gated pages.
- **When verifying auth flow:** Start with `dev-ready` (no bypass), then confirm redirect behavior:
  - unauthenticated -> `/login`
  - allowlisted/authenticated -> protected page (for example `/health`)

## Evidence To Record

- Route tested.
- Actions performed.
- Expected vs actual result.
- Snapshot file names if captured.

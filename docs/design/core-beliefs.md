# Core Beliefs

## Belief 1: Durable Rules Belong In The Database

### Belief Statement

Business invariants that protect user data must be enforced in SQL/RLS, not only in client code.

### Why It Exists

The app has multiple execution surfaces (web, API routes, edge functions, extension). UI-only checks are bypassable.

### How Enforced Here

- RLS and policies: `supabase/db/policies/*`
- Helper guards: `supabase/db/functions/_is_allowed_user.sql`, `supabase/db/functions/_is_owner_of_person.sql`
- Workflow invariants in SQL functions/triggers: `supabase/db/functions/*`, `supabase/db/triggers/*`

### Failure Signals

- Auth-sensitive behavior differs by caller surface.
- Data can be mutated through one route despite UI restrictions.

### Corrective Actions

- Add or tighten RLS/policies.
- Move invariant logic into SQL functions or triggers.
- Add explicit evidence in architecture/quality docs.

## Belief 2: Keep Runtime Surfaces Explicit

### Belief Statement

Every workflow must define where orchestration runs: component/hook, API route, edge function, and SQL layer.

### Why It Exists

Implicit orchestration boundaries cause drift, duplicated logic, and brittle debugging.

### How Enforced Here

- Route-level boundaries in `src/app/*`.
- Hook orchestration in `src/hooks/*`.
- Edge workflows in `supabase/functions/*`.
- DB workflow functions in `supabase/db/functions/*`.

### Failure Signals

- Same decision logic copied across hooks and edge functions.
- Incident triage cannot identify owning layer quickly.

### Corrective Actions

- Move shared logic to one owning layer.
- Add/update design docs for workflow ownership.

## Belief 3: Safety Beats Convenience For Auth

### Belief Statement

Auth behavior must be explicit and verifiable at each trust boundary.

### Why It Exists

This app uses middleware auth, API routes, edge functions (`verify_jwt = false`), and service role contexts.

### How Enforced Here

- Middleware gate: `src/middleware.ts`, `src/lib/supabase-middleware.ts`
- Allowlist checks in server and edge paths.
- Security checklist in `docs/SECURITY.md`.

### Failure Signals

- Endpoint auth assumptions are undocumented.
- Service-role usage leaks into client contexts.

### Corrective Actions

- Document endpoint auth contract.
- Add explicit token validation in functions where needed.
- Update security review evidence in PR.

## Belief 4: Score The Architecture Strictly, Improve Continuously

### Belief Statement

Low baseline scores are acceptable when evidence is clear and trend improves over time.

### Why It Exists

Strict baseline makes progress measurable and avoids hiding debt.

### How Enforced Here

- Domain/layer scorecards and gap ledger in `docs/ARCHITECTURE.md`.
- Quality scoring and cap rules in `docs/QUALITY.md`.

### Failure Signals

- Scores rise without evidence.
- Known debt is not tracked with IDs.

### Corrective Actions

- Require evidence links for each scored row.
- Keep gap IDs and reassessment cadence current.

## Belief 5: Docs Are Part Of The System, Not Afterthoughts

### Belief Statement

Design, architecture, quality, security, and runbook docs are operational artifacts that must evolve with the code.

### Why It Exists

Onboarding speed, incident recovery, and safe delivery depend on doc accuracy.

### How Enforced Here

- Canonical docs in `docs/`.
- DRY documentation rule in `AGENTS.md`.
- Explicit doc update requirements in `docs/QUALITY.md`.

### Failure Signals

- Canonical location drift.
- Conflicting policy text across documents.

### Corrective Actions

- Keep one canonical source per policy.
- Link instead of duplicating policy text.
- Track doc drift as architecture gaps.

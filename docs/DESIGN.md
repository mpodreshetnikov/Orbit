# Design

## Purpose

This document defines the common design patterns used in the app and acts as the canonical map to detailed design documents.

Cross-links:

- Architecture map and scored maturity model: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- Quality checks and quality scoring algorithm: [`docs/QUALITY.md`](./QUALITY.md)
- Security model and review checklist: [`docs/SECURITY.md`](./SECURITY.md)
- Runtime operations and incident guidance: [`docs/RUNBOOK.md`](./RUNBOOK.md)

## Design Principles

1. Put durable rules in the database, not only in UI.
2. Keep route files thin; put reusable orchestration in hooks/lib.
3. Use explicit trust boundaries (middleware, auth checks, RLS, function-level auth).
4. Keep async workflows observable with status transitions and user feedback.
5. Prefer additive evolution with migration history and idempotent deploy parity.

## Common Patterns Followed In This Repo

- App-shell split by product section (`health`, `money`) with shared top navigation and person context.
- Hook-centric data orchestration using React Query + Supabase clients.
- DB-enforced constraints via RLS/policies/functions/triggers.
- Edge Functions for external integrations and long-running/domain workflows.
- Service-worker-mediated push notification rendering and action handling.
- Import connector abstraction (web + extension registries) for money ingestion.

## Anti-Patterns To Avoid

- Business rules implemented only in components.
- New DB behavior shipped without migration and `supabase/db` parity.
- Security-sensitive endpoints without explicit auth behavior.
- Expanding already monolithic files without extracting modules.
- Adding second “source of truth” docs when canonical docs already exist.

## Detailed Design Map

### Core

- Core beliefs: [`docs/design/core-beliefs.md`](./design/core-beliefs.md)

### Common

- Layering and boundaries: [`docs/design/common/layering-and-boundaries.md`](./design/common/layering-and-boundaries.md)
- State and data fetching: [`docs/design/common/state-and-data-fetching.md`](./design/common/state-and-data-fetching.md)
- Auth, RLS, and trust boundaries: [`docs/design/common/auth-rls-and-trust-boundaries.md`](./design/common/auth-rls-and-trust-boundaries.md)
- Async jobs and notifications: [`docs/design/common/async-jobs-and-notifications.md`](./design/common/async-jobs-and-notifications.md)
- Error handling and observability: [`docs/design/common/error-handling-and-observability.md`](./design/common/error-handling-and-observability.md)
- UI shell, navigation, and person context: [`docs/design/common/ui-shell-navigation-and-person-context.md`](./design/common/ui-shell-navigation-and-person-context.md)

### Domain: Health

- Domain index: [`docs/design/domains/health/README.md`](./design/domains/health/README.md)
- Records ingestion pipeline: [`docs/design/domains/health/records-ingestion-pipeline.md`](./design/domains/health/records-ingestion-pipeline.md)
- Clinical data lifecycle: [`docs/design/domains/health/clinical-data-lifecycle.md`](./design/domains/health/clinical-data-lifecycle.md)
- Regimens, dose events, reminders: [`docs/design/domains/health/regimens-dose-events-and-reminders.md`](./design/domains/health/regimens-dose-events-and-reminders.md)

### Domain: Money

- Domain index: [`docs/design/domains/money/README.md`](./design/domains/money/README.md)
- Ledger and line items: [`docs/design/domains/money/ledger-and-line-items.md`](./design/domains/money/ledger-and-line-items.md)
- Import framework (file + extension): [`docs/design/domains/money/import-framework-file-and-extension.md`](./design/domains/money/import-framework-file-and-extension.md)
- Accounts/cards/categories mapping: [`docs/design/domains/money/accounts-cards-categories-and-mapping.md`](./design/domains/money/accounts-cards-categories-and-mapping.md)

## How To Extend Design Docs

When introducing a new domain or major cross-cutting pattern:

1. Add a domain folder under `docs/design/domains/<domain>/`.
2. Add a domain `README.md` with map and boundaries.
3. Add focused detail docs for workflows, data model, and failure modes.
4. Update this `docs/DESIGN.md` map in the same change set.
5. Link any quality/security/architecture implications in canonical docs instead of duplicating policy text.

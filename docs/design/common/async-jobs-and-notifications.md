# Async Jobs And Notifications

## Intent

Describe the design patterns for asynchronous workflows, status transitions, cron jobs, and push notifications.

## Current Implementation In This Repo

- Health ingestion async workflow:
  - UI queue state: `src/stores/processing-queue-store.ts`
  - OCR kickoff/retry: `src/hooks/use-background-ocr.ts`
  - Structuring step: `src/hooks/use-structure-extraction.ts`
  - realtime updates: `src/hooks/use-processing-monitor.ts`
- Notification scheduling and delivery:
  - SQL cron jobs: `supabase/db/cron/jobs.sql`
  - digest creation and dispatch logic: `supabase/functions/notifications-cron/index.ts`
  - API/action surfaces: `src/app/api/notifications/*`, `src/app/api/medications/run-cron/route.ts`
  - client polling/action handling: `src/hooks/use-notifications.ts`, `public/sw.js`

## Rules To Follow

1. Every async workflow must have explicit lifecycle states and transitions.
2. State changes must invalidate or refresh dependent queries.
3. Background notification workflows must be idempotent where practical.
4. Cron-invoked functions should be safe under retries and partial failures.
5. User-visible async failures must surface actionable messages.

## Anti-Patterns To Avoid

- Hidden state transitions without persisted status in DB.
- Unbounded retries without backoff or recovery path.
- Multiple independent schedulers for the same notification type.

## Tradeoffs

- SQL + edge split gives strong durability and flexible delivery but increases reasoning complexity.
- Polling plus push ensures robustness across client states but can duplicate work.

## Known Gaps And Next Refactor Targets

- Some async orchestration files are too large for easy change isolation.
- Observability of cron outcomes is mostly operational/manual, not centrally scored in CI.

## References

- [`docs/RUNBOOK.md`](../../RUNBOOK.md)
- [`docs/design/domains/health/records-ingestion-pipeline.md`](../domains/health/records-ingestion-pipeline.md)
- [`docs/design/domains/health/regimens-dose-events-and-reminders.md`](../domains/health/regimens-dose-events-and-reminders.md)

# Health Regimens, Dose Events, And Reminders

## Intent

Define scheduling, event generation, intake resolution, and reminder-delivery design for medication regimens.

## Current Implementation In This Repo

### Data and workflow components

- Regimens/events/inventory tables:
  - `med_regimens`
  - `med_dose_events`
  - `med_inventory_transactions`
- Client orchestration:
  - `src/hooks/use-regimens.ts`
  - medication UIs in `src/app/health/medications/*` and `src/components/medications/*`
- SQL workflow functions:
  - generation: `generate_med_dose_events_for_horizon*`, `run_med_event_generation_for_all_users`
  - event resolution: `mark_dose_taken`, `mark_dose_skipped`, `undo_dose_intake`, `update_dose_event_resolution_details`
  - inventory updates: `update_regimen_inventory`
  - digests: `create_medication_reminder_digests`, `create_medication_refill_digests`
- Notification delivery:
  - edge function: `supabase/functions/notifications-cron/index.ts`
  - service worker rendering/actions: `public/sw.js`

### Scheduling pattern

- Cron jobs invoke generation and notification pipelines.
- Event generation is horizon-based and idempotent-oriented.
- User actions (`taken`, `skipped`, `undo`) update both event state and inventory transactions.

### Health-specific edge cases and failure recovery patterns

- Timezone changes after regimen creation:
  - regenerate future events via regenerate endpoint,
  - generator functions clear/rebuild future horizon to avoid stale schedule offsets.
- Repeated cron execution:
  - generation and digest creation are designed to be repeat-safe,
  - duplicate rows are prevented by event uniqueness and digest dedupe logic.
- Late or out-of-order intake actions:
  - `mark_dose_taken`/`mark_dose_skipped`/`undo_dose_intake` enforce server-side event state transitions,
  - inventory adjustments are reconciled from durable event transitions instead of client assumptions.
- Push delivery failure:
  - digest rows remain in DB and can be retried by subsequent cron cycles,
  - client push state is isolated from regimen/event truth.

## Rules To Follow

1. Regimen schedule semantics must remain explicit in stored JSON contracts.
2. Event resolution must update both status and inventory consistency where applicable.
3. Reminder digests should be deduplicated and safe under repeated cron runs.
4. Notification actions must map to explicit server-side mutations.
5. Any schedule semantics change requires both migration and `supabase/db` function updates.

## Anti-Patterns To Avoid

- Client-only medication completion state without DB mutation.
- Multiple competing generators writing the same horizon concurrently.
- Inconsistent timezone handling between generation and reminder windows.

## Tradeoffs

- JSON-based schedules provide flexibility but require disciplined validation and helpers.
- SQL-driven generation is robust and fast but can be harder to unit-test without DB harnesses.

## Known Gaps And Next Refactor Targets

- Continue reducing size of medication dashboard/form and regimen hook modules.
- Improve explicit test coverage for edge cases around timezone and retry paths.

## References

- `supabase/db/cron/jobs.sql`
- `src/app/api/medications/regenerate-events/route.ts`
- `src/app/api/medications/run-cron/route.ts`
- [`docs/RUNBOOK.md`](../../../RUNBOOK.md)

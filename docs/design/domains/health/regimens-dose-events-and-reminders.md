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

### What a dose definition records

`med_regimens.dose_definition` (typed `PlannedIntake`, `src/types/regimen.ts`) holds what one intake
delivers, and `med_dose_events.planned_intake` holds the copy each generated event was created from.
`unit_strength` is `ADR-260907-cvj`. The model, the write paths and the MCP renderer carry it; what
is still missing is the app's capture field and the migration of stored rows, both listed under
**Known Gaps**. So a row that has one is read and written correctly today, and most rows do not have
one yet.

- `intake` — how much of the dosage form is taken: `1.5 pill`. This is the quantity that moves
  during a titration.
- `unit_strength` — what **one** unit contains: `[{Сертралин, 100, milligram}]`. This is the quantity
  that stays still, and it is the field a strength is recorded in. The per-intake total is
  `intake.amount × unit_strength[i].amount`, computed where it is needed and stored nowhere as an
  independent fact. It is omitted only where the dosage form **is** the active ingredient — a powder
  dosed in milligrams — because there the amount already is the strength. A mass unit alone does not
  establish that: a 5 g application of 1% hydrocortisone is 10 mg of ingredient per gram of cream,
  and a compounded powder can carry several ingredients at once. Keying the omission on the unit
  would make both unrepresentable and unmigratable.
- `active` — **legacy**: the same ingredients as a per-intake total. Read for rows not yet migrated,
  written by nothing new, removed once the migration in `T-260829-1my` has run. A reader finding both
  prefers `unit_strength`.

A per-intake total cannot survive the operations this domain already performs. The generator takes
`dose_definition` whole and overrides only `{intake,amount}` per slot, so a 1-pill / 100 mg course
with a 2-pill evening slot generated an event saying 2 pills and 100 mg — a total recorded for a
different number of units, written by the system with nobody editing anything. An amount edit
strands the figure the same way, since `dose_definition` is edited in place and only future
unresolved events are regenerated. And given `{2 pill, 100 mg}` nothing can rescale it, because
nothing records how many units the 100 mg was for. Per-unit strength is invariant under exactly
those operations, which is why the generator needs no change: a slot's own amount multiplies a
strength that does not depend on it.

An event snapshots the `unit_strength` it was generated from, so a past intake carries the strength
that was in force at the time while the course carries what is in force now, and neither is
reconstructed from the other.

`planned_intake` is not wholly a plan, though, and adherence or audit code must not read it as one:
`update_dose_event_resolution_details` and the MCP `log_dose` correction path both overwrite
`planned_intake.intake.amount` with the amount actually taken, so a 1-pill event corrected to 0.5
reads 0.5 and the original plan is gone. Only `unit_strength` is a generation snapshot; the amount
beside it may have been amended to the actual intake.

Reasoning and the rejected alternatives: `ADR-260907-cvj` in the task registry.

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
2. A strength is recorded per unit of the dosage form. Anything that needs a per-intake total derives
   it from the amount beside it; no write path stores that total as the source of truth.
3. Event resolution must update both status and inventory consistency where applicable.
4. Reminder digests should be deduplicated and safe under repeated cron runs.
5. Notification actions must map to explicit server-side mutations.
6. Any schedule semantics change requires both migration and `supabase/db` function updates.

## Anti-Patterns To Avoid

- Storing a per-intake ingredient total as the recorded strength: the next slot override, amount
  edit or logged correction leaves it describing a different number of units, and no reader can tell.
- Client-only medication completion state without DB mutation.
- Multiple competing generators writing the same horizon concurrently.
- Inconsistent timezone handling between generation and reminder windows.

## Tradeoffs

- JSON-based schedules provide flexibility but require disciplined validation and helpers.
- SQL-driven generation is robust and fast but can be harder to unit-test without DB harnesses.

## Known Gaps And Next Refactor Targets

- **The medication form cannot capture a strength.** It has no field for one, so today only an MCP
  client can record it, through `plannedIntakeSchema` in `src/lib/mcp/schemas/regimen.ts`. The form
  does carry an existing one through an edit rather than emptying it, which it used to do on every
  save; a legacy `active` total is carried only while the amount does not move, since it cannot be
  rescaled. Tracked in `T-260829-1my`.
- **Stored rows are not migrated.** Almost every row still records a per-intake `active` and no
  `unit_strength`, so the MCP renderer's withholding rule still fires on them. The migration is
  `unit_strength = active.amount ÷ intake.amount`, exact wherever the amount is positive, on
  `med_regimens.dose_definition` and `med_dose_events.planned_intake`; `T-260829-1my` gates it behind
  promotion to `depth: execplan`. `active` is removed only after it has run.
- Continue reducing size of medication dashboard/form and regimen hook modules.
- Improve explicit test coverage for edge cases around timezone and retry paths.

## References

- `supabase/db/cron/jobs.sql`
- `src/app/api/medications/regenerate-events/route.ts`
- `src/app/api/medications/run-cron/route.ts`
- [`docs/RUNBOOK.md`](../../../RUNBOOK.md)

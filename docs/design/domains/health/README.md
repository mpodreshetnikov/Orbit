# Health Domain Design

## Scope

Health domain covers records ingestion, clinical extraction/review, longitudinal health data, and medication/checkup reminders.

## Domain Surfaces

- Routes: `src/app/health/*`
- Components: `src/components/records/*`, `src/components/measurements/*`, `src/components/findings/*`, `src/components/conditions/*`, `src/components/checkups/*`, `src/components/medications/*`
- Hooks: `src/hooks/use-medical-records.ts`, `use-background-ocr.ts`, `use-structure-extraction.ts`, `use-conditions.ts`, `use-checkups.ts`, `use-regimens.ts`
- Edge: `health-ocr`, `health-structure`, `icd-lookup`, `notifications-cron`
- SQL: health tables + functions/policies in `supabase/db/*`

## Design Documents

- Records ingestion pipeline: [`records-ingestion-pipeline.md`](./records-ingestion-pipeline.md)
- Clinical data lifecycle: [`clinical-data-lifecycle.md`](./clinical-data-lifecycle.md)
- Regimens, dose events, reminders: [`regimens-dose-events-and-reminders.md`](./regimens-dose-events-and-reminders.md)

## Domain Boundaries

- In scope: medical records, structured observations/findings/conditions/checkups, medication regimens/events/notifications.
- Out of scope: provider-side EHR integrations, generalized diagnosis engines, external scheduling systems.

## Current Limits

- Major workflow files remain monolithic in some areas.
- Automated test depth is still smoke-first.
- Some legacy code paths remain present and should be retired deliberately.

## References

- [`docs/ARCHITECTURE.md`](../../../ARCHITECTURE.md)
- [`docs/SECURITY.md`](../../../SECURITY.md)
- [`docs/RUNBOOK.md`](../../../RUNBOOK.md)

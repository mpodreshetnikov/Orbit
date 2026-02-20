# Health Records Ingestion Pipeline

## Intent

Define the canonical sequence for converting raw record input (file/camera/text) into durable structured health data.

## Current Implementation In This Repo

### Entry points

- New record wizard: `src/components/records/add-record-wizard.tsx`
- Record detail and review views: `src/components/records/record-detail.tsx`, `src/components/records/ocr-review-step.tsx`, `src/components/records/structure-review-step.tsx`

### Core workflow services

- OCR function: `supabase/functions/health-ocr/index.ts`
- Structuring function: `supabase/functions/health-structure/index.ts`
- Hook orchestration:
  - `src/hooks/use-background-ocr.ts`
  - `src/hooks/use-structure-extraction.ts`

### State transitions

Typical lifecycle:

`draft` -> `ocr_processing` -> `ocr_review` -> `structuring` -> `structure_review` -> `active`

Failure branch:

`ocr_processing` -> `ocr_failed` (with `ocr_error`) -> retry path

Legacy compatibility status (`processing`) still appears in monitor logic and should be phased out in future cleanup.

### Health-specific edge cases and failure recovery patterns

- OCR returns empty/low-quality text:
  - keep the record in reviewable state (`ocr_review` or `ocr_failed`),
  - allow user correction in `ocr-review-step.tsx`,
  - retry OCR/structuring without creating a duplicate record.
- Structuring fails after OCR success:
  - keep OCR artifacts attached to the record,
  - surface failure in record detail with retry entry point,
  - require explicit re-run through `use-structure-extraction.ts`.
- User abandons workflow in mid-state:
  - status remains durable in `medical_records.status`,
  - processing monitor (`use-processing-monitor.ts`) resumes UI state from server truth.
- Duplicate trigger attempts (double-click, reconnect, refresh):
  - run calls are keyed by `record_id`,
  - workflow should be treated as idempotent and avoid duplicate derived entities.

## Rules To Follow

1. Persist each workflow stage in `medical_records.status`.
2. Do not skip review transitions for user-editable extraction output.
3. On failure, persist actionable error state (`ocr_failed`, `ocr_error`) and expose retry.
4. Invalidate/query-refresh all dependent health views after stage transitions.
5. Keep OCR and structuring workflows idempotent per `record_id` where possible.

## Anti-Patterns To Avoid

- Writing extracted observations/findings directly from UI without review stage contracts.
- Triggering edge functions without authenticated session/token context.
- Leaving records in transient states without recovery path.

## Tradeoffs

- Multi-stage review improves correctness and user control but adds latency and UI complexity.
- Background processing improves responsiveness but requires robust status tracking and realtime updates.

## Known Gaps And Next Refactor Targets

- `health-structure` function size and mixed responsibilities should be split.
- `record-detail` and `structure-review-step` should be decomposed into smaller workflow modules.
- Legacy `useIngestRecord` hook path should be removed or fully implemented.

## References

- `src/types/medical-record.ts`
- `src/hooks/use-processing-monitor.ts`
- [`docs/design/common/async-jobs-and-notifications.md`](../../common/async-jobs-and-notifications.md)

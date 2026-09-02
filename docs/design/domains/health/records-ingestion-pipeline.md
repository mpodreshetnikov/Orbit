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

### What `ocr_error` carries

`ocr_error` holds a classified cause, not a sentence: `ocr_cause:<code> <English summary>`, capped
at 500 characters with the code first so truncation can only cost the summary. The vocabulary is
declared in `supabase/functions/health-ocr/failure.ts` and mirrored for the browser in
`src/lib/health/ocr-failure.ts`, which also translates it — the server composes in English and does
not know the reader's language.

Two rules the column depends on:

- The provider's own error body is never quoted into it. That body can echo the request, and for
  OCR the request is the patient's document.
- Both writers use this format. The edge function writes it, and says in its failure payload
  (`persisted`) whether the record actually carries it — an answer is not proof of a write, since
  a request refused before the record is known is answered in JSON and written nowhere. The
  browser leaves the column alone for a persisted failure, and settles the record itself
  otherwise — but always through `reconcileAfterFailedHandoff`, because a lost response is not a
  request that never landed and a run holding the claim must not be failed from the browser.

A run that transcribed the document but lost a page writes the same string on the success path,
so a three-page document that came back with two does not read as a clean success. A page the
model cut short at its completion budget counts as such a loss too (`truncated_page`): it has
text, but everything downstream reads that prefix as the whole page.

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

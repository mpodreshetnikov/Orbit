---
id: T-0021
title: Make an OCR failure name its cause instead of reporting that no text was extracted
status: open
kind: bug
priority: p2
depth: note
created: 2026-08-23
updated: 2026-08-23
owner: TBD
tags: [health, ocr, observability, errors]
---

# Make an OCR failure name its cause instead of reporting that no text was extracted

## Context

On 2026-08-22 a photo uploaded on production failed OCR with `Failed to extract text from any
attachment`. The record (`33ad1f21-279d-480c-9785-d9d68c3bed3e`) carried that string in
`ocr_error`, and the record detail screen showed it verbatim. The message points at the photograph,
so the first move it invites is re-shooting the document. The actual cause was `OpenRouter API
error: 401` — the `OPENROUTER_API_KEY` in the Supabase Edge Function secrets was rejected. Nothing
about the document was wrong, and no amount of re-photographing could have helped. The real cause
existed only in the edge function logs, which a user cannot see and which required a Supabase
console session to correlate.

The message is produced by a two-step loss of information in
`supabase/functions/health-ocr/service.ts`:

1. The per-attachment `catch` at `service.ts:191` logs the error and pushes an empty string into
   `pageTexts`. Whatever the provider said is discarded at that point — the loop treats an
   auth failure, a rate limit, an unsupported MIME type and a genuinely unreadable page as the
   same event.
2. When every page comes back empty, `service.ts:167` throws the aggregate
   `Failed to extract text from any attachment`, which is the only string that reaches
   `updateRecordFailure` and therefore the only string the user ever sees.

The distinction is already available at the point of the loss. `_shared/llm-retry.ts:41` classifies
statuses: 429 and 5xx are retried as provider problems, everything else is treated as ours. A 401
is exhausted immediately and deliberately (retrying a bad key is pointless) — so by the time
`service.ts:191` catches it, the code already knows this was a non-retryable configuration failure
rather than a bad photo, and throws that knowledge away.

Two smaller defects sit on the same path:

- `src/components/records/record-detail.tsx:742` renders `record.ocr_error` raw. The server
  composes these strings in English, so a Russian-language UI shows an untranslated English
  sentence, falling back to `t("processing.failed")` only when the column is null.
- A partial failure is indistinguishable from a total one. If page 2 of a three-page document
  fails, `buildCombinedPageText` (`service.ts:63`) writes `[Не удалось извлечь текст]` for it and
  the run reports success, with no durable record that a page was lost.

Afterwards, someone hitting this can tell from the record screen alone whether to re-photograph the
document, retry later, or fix a configuration problem — without opening Supabase logs.

Scope is `health-ocr` only. The absent `structure_error` column and its UI surface belong to
[`T-0006`](./T-0006-health-image-recognition-pipeline-hardening.md) Milestone 5, which covers
`health-structure` having no durable error at all; this task covers `health-ocr` having a durable
error that misleads.

## Progress

- [ ] Carry the per-attachment failure cause out of the loop in `health-ocr/service.ts` instead of
      discarding it at `service.ts:191`, keeping enough to distinguish a non-retryable
      configuration or auth failure from an exhausted retry from a page the model could not read.
- [ ] Compose the aggregate error at `service.ts:167` from those causes, so `ocr_error` names what
      happened rather than only that nothing came back. Keep it within `maxOcrErrorLength` (500)
      and keep provider response bodies out of it — they can quote the request, which for OCR is
      the patient's document.
- [ ] Record a partial page failure durably rather than only in the combined text, so a
      three-page document that lost one page does not read as a clean success.
- [ ] Map the cause classes to translated strings in `record-detail.tsx:742` rather than rendering
      the raw English server string.
- [ ] Cover in `health-ocr/service_test.ts`: a non-retryable provider failure, a retry-exhausted
      failure and an unreadable page each produce a distinguishable `ocr_error`.

## Decision Log

- Decision: Scope this to `health-ocr` and leave `health-structure`'s missing `structure_error`
  column with T-0006 Milestone 5.
  Rationale: The two tasks have different exit conditions. T-0006 has to add a column and a UI
  surface where none exists; this task has to stop an existing column from carrying a misleading
  value. Satisfying either would not satisfy the other, which is the test for separate tasks
  rather than duplicates. Folding this into T-0006 would also bury a small, shippable fix inside a
  seventeen-defect plan with three milestones still open.
  Date/Author: 2026-08-23 / Claude

- Decision: Classify causes for the user rather than passing the provider's message through.
  Rationale: The provider's error body can quote the request, and for OCR the request contains the
  patient's document — `openrouter-client.ts:159` already declines to read the body for exactly
  this reason. A fixed set of cause classes gives the user an actionable message and keeps
  patient data out of a database column and off the screen.
  Date/Author: 2026-08-23 / Claude

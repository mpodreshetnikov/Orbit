---
id: T-0006
title: Fix and harden the medical image recognition pipeline
status: in-progress
kind: bug
priority: p1
depth: execplan
created: 2026-08-03
updated: 2026-08-03
owner: TBD
tags: [health, extraction, ocr]
---

# Fix and harden the medical image recognition pipeline (health-ocr and health-structure)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`docs/PLANS.md`](../PLANS.md) from the repository root.

## Purpose / Big Picture

Today a user photographs a lab printout, the app reads it, and the extracted values look plausible on the review screen — and then quietly never show up in the health history or trend charts. Reference ranges are not normalised, so a haemoglobin measured in `g/L` in one document and `g/dL` in another are never comparable. Sometimes the whole extraction fails with "structure extraction failed" and every value from the document is lost, including the forty that parsed perfectly. Multi-page documents time out in the browser and end up marked as failed even though the server succeeded.

This is not the model being unreliable. It is a set of concrete defects in how we call the model and what we do with its answer. The single largest one: **we fetch the medical code catalogues from the database, pass them into the prompt builder, and then send the model only the row counts instead of the actual codes.** The model is asked to emit `obs_code`, `finding_code` and `site_code` values while being told nothing except how many exist. It necessarily invents them, every invented code fails the exact-string lookup in the database, and the resulting row is written with `is_applied = false` — which is exactly the flag the history query filters on.

There is a second, structural problem behind several of the first. One model call is currently asked to produce eleven top-level fields covering four unrelated jobs — classify the document, extract clinical entities from it, diff those against the patient's existing chart, and match them against the patient's due checkups — from a single context blob that mixes the document text with the patient's medical history. That shape is why quality here is hard to reason about: one model and one reasoning budget serve all four jobs, any single failure fails all eleven fields, and there is no signal that tells you which job got worse. Worse, putting the patient's existing conditions next to an extraction task invites the model to echo one back as if the document had said it — and extracted conditions are written to the chart without review.

After this work, a user can photograph a two-page blood panel, review the extracted values, activate the record, and immediately see those values plotted in the observation history with units normalised to the catalogue's canonical unit. When a single value is unparseable, the other values still land, and the bad one is shown as needing attention instead of destroying the run. When the provider hiccups, the request is retried instead of burning the record. The pipeline runs as four narrow steps, each with its own prompt, schema, model and score, so a regression points at the step that caused it. And we will have a scored regression corpus, so "the LLM is behaving worse" becomes a number instead of a feeling.

## Progress

- [x] (2026-08-02) Full read-through review of the pipeline completed; twelve defects confirmed against source with file and line references (see `Context and Orientation` and `Surprises & Discoveries`).
- [x] (2026-08-02) Second pass over the shape of the model call itself; five further defects confirmed (D13–D17) covering task overload, patient-history contamination of extraction, undelimited document text, absent output contract, and uncacheable prompt ordering.
- [x] (2026-08-02) Milestone 0 — Stop logging patient data. Shipped standalone. `raw_response` and `raw_observation_names` removed; shape-only telemetry in their place; raw payload gated behind `HEALTH_STRUCTURE_DEBUG_RAW_PAYLOAD`, default off. Two regression tests fail against the previous code. **Remaining: the operational purge of already-emitted logs, which is not a code change.**
- [x] (2026-08-02) Milestone 1 — Split the single eleven-field call into four single-purpose stages under `supabase/functions/health-structure/stages/`; prompt construction fixed (fenced untrusted document text, per-stage strict JSON Schema, stable-first ordering, worked examples, per-stage model and effort).
- [x] (2026-08-02) Milestone 2 — Catalogue vocabulary now reaches the extraction prompt, and `code-resolution.ts` resolves labels deterministically in tiers. Review-UI silent-loss path closed in `structure-review-step.tsx`.
- [x] (2026-08-02) Milestone 3 — Per-value validation in `stages/validate.ts`; enum and date defects no longer reject the whole insert. (completed: validation and reporting; remaining: the `record_extraction_issues` table, which needs a migration and pgTAP against a running Supabase.)
- [x] (2026-08-02) Milestone 4 — `_shared/llm-retry.ts` with backoff, jitter, `Retry-After`, truncation-as-retryable, non-retryable 4xx; `provider.require_parameters` and a `models` fallback array.
- [x] (2026-08-03) Anchor grounding corrected to compare tokens rather than characters, after a test-quality audit found it silently dropping correctly-extracted values (see `Surprises & Discoveries` and `Decision Log`).
- [x] (2026-08-03) `health-ocr` brought up to the transport and prompt standard of `health-structure`: retry with backoff, strict `json_schema` with `provider.require_parameters`, fenced-JSON recovery, array-content handling, truncation detection, and a transcription prompt that forbids the "helpful" rewriting that changes lab values. `parseJsonObject`/`extractContentText` moved to `_shared/llm-json.ts` so both functions share one implementation. This is the client-level half of Milestone 7; the queue and image preprocessing remain.
- [ ] Milestone 5 — Record token usage and give structuring failures a durable error. (completed: per-record token usage is logged from the staged pipeline; remaining: the `structure_error` column and its UI surface.)
- [ ] Milestone 6 — Fix the pre-review chart writes, the resolved-finding sentinel, and the missing idempotency guard.
- [ ] Milestone 7 — Move OCR off the synchronous request path and preprocess images.
- [ ] Milestone 8 — Build a scored extraction regression corpus and wire it into the quality gate.

## Surprises & Discoveries

- Observation: The structuring prompt sends catalogue **counts**, not catalogue **contents**, while the full catalogues are fetched and passed in.
  Evidence: `supabase/functions/health-structure/openrouter-parse.ts:225-248` builds `briefContext` whose only catalogue field is `catalog_counts: { observations: N, finding_types: N, body_sites: N }`. The populated `context.observationCatalog`, `context.findingTypeCatalog` and `context.bodySiteCatalog` arrays — loaded in `supabase/functions/health-structure/service.ts:241-248` — are read only for their `.length`.

- Observation: The equivalent money pipeline does this correctly, which is why the health path reads as an oversight rather than a design choice.
  Evidence: `supabase/functions/money-categorize/openrouter-categorize.ts:81` sends `Allowed categories: ${JSON.stringify(request.candidateCategories)}` — the actual candidate list, not a count.

- Observation: A hallucinated `obs_code` produces silent data loss with no user-visible signal at all.
  Evidence: `supabase/functions/health-structure/service.ts:126` sets `is_applied: catalogEntry !== null`. `src/hooks/use-observation-history.ts:56` and `:253` both filter `.eq("is_applied", true)`. In the review UI, `src/components/records/structure-review-step.tsx:268` computes `const isUnapplied = isCustom && !observation.is_applied` where `isCustom = !observation.obs_code` — so a row that _has_ a (bogus) `obs_code` is never rendered as unapplied and never offered the "Apply" button. The row looks completely normal, saves cleanly, and is then excluded from every history query forever.

- Observation: The catalogues are small enough that the fix is trivial — there is no size justification for sending counts.
  Evidence: 37 observation rows (29 in `supabase/migrations/20250127000003_create_observation_catalog.sql`, 8 in `supabase/migrations/20250128000007_add_eye_observations.sql`), 30 finding types and 72 body sites in `supabase/migrations/20250128000002_create_finding_catalogs.sql`.

- Observation: `synonyms_ru` and `synonyms_en` are selected from the database on every structuring call and never used for anything.
  Evidence: `supabase/functions/health-structure/repository.ts:124`, `:138` and `:151` select them; the only consumers anywhere in the codebase are the catalogue admin screens (`src/components/catalogs/observation-catalog-list.tsx:197`). `supabase/functions/health-structure/catalog.ts` matches by exact code equality only.

- Observation: No test anywhere asserts what the prompt actually contains, which is why the catalogue omission shipped unnoticed.
  Evidence: `supabase/functions/health-structure/openrouter-parse_test.ts` contains no reference to `buildPrompt`, `catalog`, or the outgoing request body's prompt text.

- Observation: The complete, unredacted structured medical extraction is written to edge-function logs on every single request.
  Evidence: `supabase/functions/health-structure/openrouter-parse.ts:331-344` calls `console.log(JSON.stringify({ health_structure_llm_debug: true, raw_response: contentText, ... }))`. `contentText` is the model's full JSON answer: diagnoses, lab values, ICD codes.

- Observation: Neither LLM call retries, and neither inspects `finish_reason`.
  Evidence: grep for `retry`, `backoff`, `attempt` and `finish_reason` across `supabase/functions/health-ocr/*.ts` and `supabase/functions/health-structure/*.ts` (excluding tests) returns nothing.

- Observation: The anchor grounding introduced by Milestone 1 was itself a silent-data-loss defect, of exactly the kind this plan exists to remove.
  Evidence: `anchorIsGrounded` compared characters after collapsing whitespace only, so an anchor differing from the document by an en-dash, by spacing around a dash, by a trailing full stop, or by ё spelled as е failed grounding and the entity was dropped. Those are the reformattings a model asked to quote verbatim performs most often. Found by auditing the tests rather than the code: the suite asserted that an absent anchor is rejected and that whitespace is tolerated, and asserted nothing about a present anchor the model had reformatted — so the failing half was invisible.

## Decision Log

- Decision: Split the model's job in two — the model extracts _verbatim text_, and code resolution to catalogue identifiers happens in deterministic TypeScript.
  Rationale: Inlining the catalogue (Milestone 2, step one) fixes the immediate breakage, but it still asks the model to be a lookup table, which does not scale past a few hundred codes and stays vulnerable to near-miss codes. Having the model return `obs_name_text` / `unit_text` and resolving to `obs_code` in code makes hallucinated codes structurally impossible rather than merely discouraged, and lets us reuse the `synonyms_ru`/`synonyms_en` columns that are already populated and already fetched. We do both: inline the catalogue _and_ stop trusting the returned code as authoritative.
  Date/Author: 2026-08-02, pipeline review.

- Decision: Validate and quarantine per entity rather than failing the whole document.
  Rationale: `replaceRecordObservations` and `replaceRecordFindings` insert as a single array (`supabase/functions/health-structure/repository.ts:257` and `:269`). One value violating a database CHECK constraint rejects the entire array, so a single out-of-vocabulary `severity` string destroys every finding in the document after the model call has already been paid for. Users lose everything and see only a generic error.
  Date/Author: 2026-08-02, pipeline review.

- Decision: Keep OpenRouter as the gateway; do not switch providers as part of this work.
  Rationale: Every defect found is on our side of the boundary — prompt construction, response validation, persistence and error handling. Swapping providers would change the symptom surface without fixing any of them, and would invalidate the regression corpus before it exists. Provider choice can be revisited once Milestone 8 gives us a score to compare against.
  Date/Author: 2026-08-02, pipeline review.

- Decision: Do not write to the `conditions` table before the user has reviewed the extraction.
  Rationale: `docs/design/domains/health/records-ingestion-pipeline.md:53` already states the rule ("Do not skip review transitions for user-editable extraction output"), and observations and findings follow it. Conditions do not, so a hallucinated diagnosis is added to the patient's chart before any human sees it, and is not cleaned up if the user abandons the review.
  Date/Author: 2026-08-02, pipeline review.

- Decision: Decompose the single call into four single-purpose stages, and do it before grounding rather than after.
  Rationale: One call currently produces eleven top-level fields across four unrelated tasks (D13), which forces one model, one temperature and one reasoning budget to serve all of them, makes any single failure fatal to all eleven, and leaves no way to attribute a quality regression to a task. Grounding first would make this worse before better: inlining the catalogue adds several thousand tokens to a request already large enough to hit truncation (D8). Stages first means the catalogue attaches to the one stage that needs it. Raised by the repository owner.
  Date/Author: 2026-08-02, pipeline review round two.

- Decision: The extraction stage must not receive the patient's existing conditions, findings or checkup items.
  Rationale: Today they sit in the same context that asks for conditions extracted from the document (`openrouter-parse.ts:231-236`), separated only by the prose line "Use only facts explicitly present in OCR text." A list of plausible, relevant, medically-coherent conditions placed next to an extraction task is the strongest hallucination pull in this pipeline, and because extracted conditions are written to the chart without review (D10), an echo becomes a chart entry. Withholding the context removes the failure mode structurally rather than asking the model not to do it. Reconciliation still needs that context, which is precisely why it becomes its own stage operating on already-extracted entities rather than on the raw document.
  Date/Author: 2026-08-02, pipeline review round two.

- Decision: Reconciliation sees the extracted entities but never the raw OCR text.
  Rationale: It is a matching problem, not a reading problem. Withholding the document text means the stage can only match what extraction already committed to finding, or decline to match — it cannot introduce document content of its own. It also makes the stage cheap enough to run on a smaller model, and skippable outright when the person has no conditions, findings or due checkups.
  Date/Author: 2026-08-02, pipeline review round two.

- Decision: Trigram matching runs in TypeScript rather than as a `pg_trgm` database function.
  Rationale: The plan specified `pg_trgm` so comparison happens where the data lives. In practice the catalogues are 37/30/72 rows and are already loaded into memory to build the extraction prompt, so a round-trip buys nothing, and an in-process implementation stays unit-testable without a running database. Revisit if the catalogues grow by an order of magnitude.
  Date/Author: 2026-08-02, implementation.

- Decision: Value validation is plain TypeScript rather than Zod.
  Rationale: The plan called for Zod with a JSON Schema derived from it. Adding a dependency resolved from esm.sh could not be verified in the implementation environment, and the checks actually needed — four closed enumerations, an ISO date, a clamped confidence — are small and total. The strict `json_schema` sent to the provider already carries the same enumerations, so the single-definition goal is met by the schema rather than by Zod. Revisit if the extraction shape grows.
  Date/Author: 2026-08-02, implementation.

- Decision: Defer the `record_extraction_issues` table; report rejections through telemetry meanwhile.
  Rationale: The validation itself is what prevents data loss and needed no table. Persisting rejects requires a migration, RLS mirroring `record_observations`, and pgTAP coverage, none of which can be exercised without a running Supabase. Shipping the validation now and the table later keeps the risky part reviewable on its own.
  Date/Author: 2026-08-02, implementation.

- Decision: Log redaction becomes Milestone 0 and ships standalone, ahead of everything else.
  Rationale: It was originally bundled with token telemetry in Milestone 5, which meant patient data would keep accumulating in logs throughout three substantial milestones of work. The change is a deletion with no dependency on anything else in the plan, so there is no reason for it to wait. Raised in review of this plan.
  Date/Author: 2026-08-02, plan review.

- Decision: Do not delete historical orphan conditions; add provenance columns to `conditions` and leave pre-existing rows in place.
  Rationale: The original cleanup predicate was unimplementable. `public.conditions` (`supabase/migrations/20250128000005_create_conditions.sql:5-28`) has no provenance columns; `is_llm_extracted` and `is_user_verified` are on `public.condition_records` (`:58-59`), and an orphan by definition has no `condition_records` row left to read them from. A user-created condition whose last record link was removed is therefore indistinguishable from an LLM orphan, and the cleanup would have deleted real chart data. Deleting a genuine diagnosis is far more costly than leaving a stale one visible for review. Raised in review of this plan.
  Date/Author: 2026-08-02, plan review.

- Decision: Backfill `resolution_status` only from the `Resolved: ` anchor prefix, never from the zero sentinel.
  Rationale: Backfilling from `size_mm = 0 OR count = 0` would permanently freeze the exact ambiguity the new column exists to eliminate. Such rows can exist: both columns are unconstrained in the database (`supabase/migrations/20250128000003_create_record_findings.sql:27-28`) and the edit dialog constrains only count, client-side (`src/components/findings/finding-edit-dialog.tsx:446`, versus no minimum on size at `:433`). Ambiguous rows default to `observed`, which means some historical rows will reappear as active findings — the correct direction to err. Raised in review of this plan.
  Date/Author: 2026-08-02, plan review.

- Decision: Use an owner-identifying lease (`processing_run_id`) and guard terminal writes, rather than a status-predicate transition.
  Rationale: The originally proposed predicate `status in ('ocr_review','structure_review','structuring')` does not serialise anything — a second concurrent caller still matches once the first has set `structuring`. Dropping `structuring` from it fails differently, because `src/hooks/use-structure-extraction.ts:43` sets that status client-side before invoking. And neither variant closes D9, because the terminal writes are unconditional: `updateRecordSuccess` (`supabase/functions/health-ocr/repository.ts:113-127`) updates by `id` with no predicate, so a stale worker overwrites a newer `ocr_failed` regardless of how entry was guarded. The claim must identify its owner, and completion must verify it still holds. Raised in review of this plan.
  Date/Author: 2026-08-02, plan review.

- Decision: Ground quoted anchors on tokens — words and digits — rather than on characters.
  Rationale: The check exists to catch invention, not to grade transcription fidelity. A model that reformats punctuation while quoting has still quoted the document, and rejecting it there discards a real lab value with no user-visible signal — the same failure mode as D1, reintroduced by the fix for it. Both sides are lowercased, ё is folded to е, and every non-alphanumeric run becomes a separator; the words and the digits must still be present, in order. Separators are not collapsed away, so "9.7" stays distinct from "97". Matching is padded to token boundaries so "гемоглобин 97" does not ground against "гемоглобин 970", and an anchor with no tokens at all is never grounded rather than matching everything. Found while auditing test quality before merge.
  Date/Author: 2026-08-03, implementation.

- Decision: When OCR truncates on every attempt, return the partial transcription flagged rather than throwing.
  Rationale: Truncation was previously undetected — `finish_reason` was never read, so a page that overran `max_tokens: 12000` returned its opening as though it were the whole document, and structuring then extracted from a document missing its tail. Detection alone is not enough, because the obvious response makes things worse: `service.ts:186-201` catches a per-page OCR error and substitutes `""`, so throwing on truncation would discard the entire page instead of its tail. Retrying doubles the completion budget, which fixes the ordinary case; when even that fails, the text read so far is returned with `truncated: true` and logged. A partly-read page still yields real values, and a dropped one yields none.
  Date/Author: 2026-08-03, implementation.

- Decision: Refer to commands by their `AGENTS.md` command ID, showing the concrete command line alongside each ID once.
  Rationale: `AGENTS.md:91-95` asks docs and plans to use IDs so they survive changes to command implementations, while `docs/PLANS.md` requires this plan to be followable by someone holding only the working tree and this file. Pure IDs would satisfy the first and break the second. Showing `id -> command` once satisfies both, and names `AGENTS.md` as the tiebreaker if they drift. Raised in review of this plan.
  Date/Author: 2026-08-02, plan review.

## Outcomes & Retrospective

**2026-08-02 — Milestones 0 through 4 implemented.** The pipeline now runs as four narrow stages; the catalogue reaches the model; codes are resolved deterministically rather than trusted; a single malformed value costs one attribute instead of the whole document; and transient provider failures are retried. 320 edge-function tests pass, up from 278, and web type-checking is clean.

Two defects turned out to be worse in combination than either was alone, which only became visible while implementing. D14 (patient history in the extraction prompt) and D10 (conditions written to the chart before review) meant a condition the model read off the patient's own record could be re-asserted as a fresh finding and materialised into `conditions` without a human ever seeing it. Milestone 1 closes the first half structurally; the second half remains open until Milestone 6.

Three deviations from the plan as written, each recorded in the `Decision Log`: trigram matching runs in TypeScript rather than via `pg_trgm`; validation is plain TypeScript rather than Zod; and the `record_extraction_issues` table is deferred, with rejections reported through telemetry in the interim.

What remains is the work that needs a database or changes the client contract — the `structure_error` column, the chart-write reordering and idempotency lease, the queued OCR path with image preprocessing, and the scored regression corpus. Milestone 8 in particular is the one that turns all of this from "should be better" into a number, and none of the preceding milestones can be called verified without it.

## Context and Orientation

The medical image recognition feature turns a photograph or PDF of a medical document into structured rows in the database. It runs in two Supabase Edge Functions — small server-side TypeScript programs running on Deno, deployed separately from the Next.js web app, invoked over HTTP by the browser.

**Stage one, `health-ocr`**, reads the pixels. Its entry point is `supabase/functions/health-ocr/index.ts`, which re-exports the handler from `supabase/functions/health-ocr/handler.ts`. The handler checks configuration and the bearer token, then calls `runHealthOcrService` in `supabase/functions/health-ocr/service.ts`. That service authenticates the user, loads the record's attachments, and for each attachment downloads the file from Supabase Storage and base64-encodes it into a `data:` URL (`service.ts:32-56`). It then calls `callVisionOcrSingle` in `supabase/functions/health-ocr/openrouter-client.ts` once per attachment, sequentially, and concatenates the per-page text into a single string with `--- Страница N ---` separators (`service.ts:62-70`). On success it writes `ocr_text`, a suggested `title`, and status `ocr_review` to the `medical_records` row.

**Stage two, `health-structure`**, reads that text and produces structured data. Same shape: `index.ts` re-exports `handler.ts`, which calls `runHealthStructureService` in `supabase/functions/health-structure/service.ts`. That service loads six pieces of context in parallel (`service.ts:241-248`): three reference catalogues (`observation_catalog`, `finding_type_catalog`, `body_site_catalog`) and three person-scoped lists (existing conditions, existing active findings, upcoming checkup items). It passes all six to `deps.parseStructuredData`, which in production is `callOpenRouterParse` in `supabase/functions/health-structure/openrouter-parse.ts`. The model's JSON answer is normalised, then turned into database rows by `buildObservationRows` (`service.ts:76-132`) and `buildFindingRows` (`service.ts:134-185`), and finally the conditions and resolutions are processed by `supabase/functions/health-structure/resolution.ts`.

A **catalogue** here means a table of canonical medical concepts with a stable string code. `observation_catalog` holds lab analytes: each row has an `obs_code` such as `vitamin_b12` or `ferritin`, Russian and English display names, a `canonical_unit`, arrays of Russian and English synonyms, and an `accepted_units` JSON map describing how to convert each accepted unit into the canonical one. `finding_type_catalog` holds finding kinds (`polyp`, `cyst`, …) and `body_site_catalog` holds anatomical sites with a `parent_site_code` hierarchy.

**Canonical unit conversion** is how two documents become comparable. `supabase/functions/health-structure/unit-conversion.ts` looks up the extracted unit string in the catalogue row's `accepted_units` map and applies either a multiplication factor or a small arithmetic formula to produce `value_canonical` and `unit_canonical`. Crucially, `convertToCanonical` returns the raw value unchanged when `catalogEntry` is `null` (`unit-conversion.ts:68-73`) — no catalogue match means no normalisation.

**`is_applied`** is a boolean column on `record_observations` (added in `supabase/migrations/20250128000008_add_observation_is_applied.sql`) that decides whether an observation participates in the patient's longitudinal history. `src/hooks/use-observation-history.ts` filters on it in both of its queries.

The browser side lives in `src/hooks/use-background-ocr.ts` (uploads files, calls `health-ocr`, drives the processing-queue store) and `src/hooks/use-structure-extraction.ts` (calls `health-structure`, invalidates the React Query caches). Review screens are `src/components/records/ocr-review-step.tsx` and `src/components/records/structure-review-step.tsx`. Record status is a Postgres enum `record_status` whose workflow values were added in `supabase/migrations/20250127000001_add_ocr_workflow_statuses.sql`: `draft → ocr_processing → ocr_review → structuring → structure_review → active`, with `ocr_failed` added later in `supabase/migrations/20250130000001_add_ocr_failed_and_error.sql`.

### The seventeen confirmed defects

**D1 — The prompt omits the catalogues (root cause, highest impact).** Described in `Surprises & Discoveries` above. `supabase/functions/health-structure/openrouter-parse.ts:225-248`. The blast radius is: no catalogue match → `catalog_id: null` → `is_applied: false` → excluded from history; no unit conversion; `finding_type_id` and `body_site_id` null, so `matchExistingFinding` (`resolution.ts:115-145`) drops to fuzzy lowercase text comparison when deciding whether a prior finding has resolved.

**D2 — Prompt band-aids instead of grounding.** `openrouter-parse.ts:255` instructs the model "Never emit placeholder labels such as Unknown observation or Unknown finding." That instruction exists because of D1. Once the model knows the vocabulary, the instruction is unnecessary; while D1 stands, the instruction cannot work.

**D3 — Enumerated fields are cast, not validated, and the database rejects the whole batch.** `normalizeFinding` casts `severity` and `laterality` straight from model output with a TypeScript `as` after only a null check (`openrouter-parse.ts:141-150`), and `normalizeObservation` does the same for `status` (`openrouter-parse.ts:116-123`). The database has CHECK constraints: `severity IN ('mild','moderate','severe','unknown')` and `laterality IN ('left','right','bilateral','none')` at `supabase/migrations/20250128000003_create_record_findings.sql:29-30`, and `status IN ('normal','low','high','critical_low','critical_high','unknown')` at `supabase/migrations/20250127000005_create_record_observations.sql:35`. A model answer of `"borderline"` or `"left-sided"` therefore rejects the entire insert array and the whole run fails. Note that `record_type` _is_ validated against `ALLOWED_RECORD_TYPES` (`openrouter-parse.ts:11-20,161-162`) — the correct pattern already exists in the same file and was simply not applied to the other three fields.

**D4 — `record_date` is not validated.** `openrouter-parse.ts:166` accepts any non-empty string. `medical_records.record_date` is a `date` column (`supabase/migrations/20250126000003_create_medical_records.sql:27`). A model answer of `"March 2024"` or `"не указано"` makes `updateMedicalRecord` throw (`repository.ts:248`), failing the run after the model call has been paid for and before any observation is written.

**D5 — No retries on either LLM call.** A single HTTP 429 or 5xx from OpenRouter fails the record. There is no `models` fallback array and no `provider` routing block in either request body (`openrouter-client.ts:101-121`, `openrouter-parse.ts:280-295`).

**D6 — `:nitro` routing without `require_parameters`.** Both functions request `openai/gpt-5.2:nitro` (`openrouter-client.ts:102`; `openrouter-parse.ts:40` and the `OPENROUTER_HEALTH_STRUCTURE_MODEL` default at `deps.ts:62`). The `:nitro` suffix asks OpenRouter to route for throughput. Without `provider: { require_parameters: true }`, routing may select a provider that does not honour `response_format`, in which case prose comes back and `parseStructuredFromLlmContent` throws `"OpenRouter returned invalid JSON content"` (`openrouter-parse.ts:41,99`). This produces exactly the intermittent, unreproducible "the model is broken today" symptom.

**D7 — The OCR JSON parse has no fallback.** `openrouter-client.ts:137` calls bare `JSON.parse(content)`. The structuring path at least tries a fenced-code-block fallback (`openrouter-parse.ts:87-88`). Any preamble text in the OCR answer throws, and `service.ts:200` pushes an empty string for that page — the page's text is silently lost while the overall run still reports success.

**D8 — `max_tokens: 12000` with no truncation detection.** `openrouter-client.ts:119`. If the answer is cut off mid-JSON, `JSON.parse` throws and the page is silently dropped as in D7. `finish_reason` is never read in either function, so truncation is indistinguishable from any other parse failure. The structuring call sets no completion budget at all.

**D9 — Multi-page OCR races the client timeout and corrupts record status.** `service.ts:146` iterates attachments sequentially; each call has a 55 second ceiling (`openrouter-client.ts:39`). The browser aborts the whole request at 120 seconds (`src/hooks/use-background-ocr.ts:25`). On a three-page document the browser aborts and writes `status: 'ocr_failed'` (via `updateRecordToOcrFailed`, `use-background-ocr.ts:40-56,307`) while the edge function is still running; the edge function then completes and writes `status: 'ocr_review'` plus the text. Last writer wins, so the record's state is decided by a race.

**D10 — Conditions are written to the patient's chart before review.** `service.ts:352` calls `processExtractedConditions`, which calls `resolveOrCreateCondition` (`resolution.ts:32-83`). That function inserts into the `conditions` table and then `recomputeConditionCurrentStatus` (`resolution.ts:108`) mutates `conditions.current_status`. This happens during extraction, before the user has seen anything. A re-run calls `clearConditionRecords` (`service.ts:351`), which deletes only from `condition_records` — the `conditions` rows created by the previous run are orphaned and accumulate. Abandoning the review leaves the hallucinated diagnosis in the chart.

**D11 — Resolved findings use a magic sentinel that collides with real data.** `resolution.ts:172-173` writes `size_mm: 0, count: 0` to mean "this finding has resolved", and `repository.ts:197` reads it back as `if (sizeMm === 0 || count === 0) continue`. A genuinely zero-count or zero-size finding is therefore treated as resolved. Meanwhile `service.ts:171` writes `count: item.count || 1`, so a model-reported `count: 0` becomes `1` — the writer and the reader disagree about what zero means.

**D12 — No idempotency guard and no durable structuring error.** Nothing prevents two concurrent `health-structure` runs for the same record: `updateMedicalRecord` does not gate on the current status (`repository.ts:243-249`), so a double-click or a retry-while-running produces duplicate conditions and duplicate `condition_records`. This contradicts `docs/design/domains/health/records-ingestion-pipeline.md:57`, which asserts the workflow is idempotent per `record_id`. Separately, there is an `ocr_error` column but no `structure_error` column; on failure `src/hooks/use-structure-extraction.ts:125` resets the status to `ocr_review` and the message survives only in a toast, so nothing is left to debug from.

Two further non-functional findings sit alongside these. The full model answer — every diagnosis and lab value — is logged unredacted on every request (`openrouter-parse.ts:331-344`), which for a health application is the most serious item in this document. And `usage.prompt_tokens` / `usage.completion_tokens` are discarded by both health functions, even though `money-categorize` already captures them (`supabase/functions/money-categorize/openrouter-categorize.ts:192-193`), so there is no per-record cost visibility.

### Five more defects in how the call itself is composed

The twelve above are defects in individual steps. These five are defects in the shape of the request — one model call carrying four unrelated jobs and a context blob that mixes sources it should keep apart. They are the reason the pipeline's quality is hard to reason about, and they are why fixing D1 alone would not be enough.

**D13 — One call is doing four unrelated jobs.** `buildPrompt` (`supabase/functions/health-structure/openrouter-parse.ts:224-261`) asks for eleven top-level output fields in a single response, spanning four distinct cognitive tasks. _Document classification_: `record_type`, `title`, `record_date`, `summary`, `keywords`. _Clinical extraction from the document_: `observations`, `findings`, `conditions`. _Reconciliation against the patient's history_: `findings_to_resolve`, `conditions_to_resolve`. _Matching against the patient's care schedule_: `checkups_to_complete`. Reading a document and diffing that reading against a patient's existing chart are different skills that want different context, and bundling them has concrete costs: one model, temperature and reasoning budget must serve all four; a failure in any one of them fails all eleven fields; and because there is a single quality signal, there is no way to tell which task regressed when output gets worse. It is also the reason the response is large enough to run into the truncation problem in D8.

**D14 — The patient's history contaminates document extraction.** `briefContext` puts `existing_conditions` — the patient's condition names, ICD codes and statuses — into the same prompt that asks the model to extract `conditions` from the document (`openrouter-parse.ts:231-236`). The only thing separating "conditions this document mentions" from "conditions this person already has" is one line of prose: `"Use only facts explicitly present in OCR text."` That is a weak guard against a strong pull — the model has a list of plausible, relevant, medically-coherent conditions sitting right there, and echoing one back as an extraction is the single most likely hallucination this pipeline can produce. It is also the most damaging, because extracted conditions are written straight into the chart without review (D10). D14 compounded with D10 is the worst interaction in the pipeline: a condition the model read off the patient's own history can be re-asserted as a fresh finding from the document and materialised into `conditions` before any human sees it.

**D15 — The OCR text is interpolated with no delimiter.** The prompt ends with `` `OCR_TEXT:\n${ocrText}` `` (`openrouter-parse.ts:259`) — raw interpolation of user-supplied content into the same message as the instructions, with no fencing and no statement that what follows is data rather than instruction. The content is a photograph of an arbitrary document, so its text is fully attacker-controlled in the general case and merely unpredictable in the normal case. A document containing text that reads as an instruction — including innocently, such as a form with "Note to reader:" boilerplate — has a direct path to steering the extraction.

**D16 — The prompt states no output contract.** The schema is communicated as a single comma-separated line of field names (`openrouter-parse.ts:253`). No types, no nesting, no enumerations, no example response. The model is left to infer that `observations[].status` must be exactly one of six strings and that `record_date` must be ISO-8601 — the two inferences that, when wrong, cause the whole-batch insert failures in D3 and D4. Those are usually described as validation gaps, but they begin here: nothing ever told the model what "valid" means.

**D17 — Nothing in the prompt is cacheable.** The stable, identical-for-every-record part of this prompt is the catalogue vocabulary — which is absent entirely (D1). The per-person context is placed before the document text, so once D1 is fixed by inlining the catalogue, the prefix would still change on every record and defeat provider-side prompt caching. Ordering the prompt stable-to-variable is free at this size and becomes significant once the catalogue is actually present.

One smaller redundancy worth folding in while restructuring: `structuredData.summary` is written to both `notes` and `llm_summary` on the same row (`supabase/functions/health-structure/service.ts:284-285`), so the model's summary silently overwrites anything a user typed into notes.

## Plan of Work

### Milestone 0 — Stop logging patient data

**Scope.** After this milestone, edge-function logs contain no diagnoses, lab values or ICD codes. This is a deletion, it depends on nothing, and it must ship on its own before any other milestone starts. Every day the rest of this plan is in progress is another day of unredacted patient data accumulating in logs, so it does not get bundled with the telemetry work it originally sat beside.

Delete the `raw_response: contentText` field and the surrounding debug block at `supabase/functions/health-structure/openrouter-parse.ts:331-344`. Replace it with a telemetry event carrying only non-identifying shape data: response length, raw and normalised entity counts, `finish_reason`, and latency. If a raw-payload escape hatch is genuinely needed for local debugging, gate it behind an environment variable read in `deps.ts`, documented as never set in production and defaulting to off.

Then check whether the leak has already reached your log retention. The block is unconditional, so every structuring request since it was introduced has emitted one. Establish when it landed, confirm the retention window of whatever sink receives edge-function logs, and purge accordingly. Treat that as part of this milestone, not a follow-up — the code fix stops new leakage but does nothing about what is already stored.

### Milestone 1 — Split the single call into a staged pipeline

**Scope.** After this milestone, `health-structure` runs a sequence of narrow, individually-testable steps instead of one call that does everything. Nothing about what the user sees needs to change yet — this is a structural milestone whose payoff is that every subsequent milestone becomes tractable, plus one immediate correctness win: the extraction step stops being able to see the patient's existing conditions, which closes D14.

Do this **before** grounding (Milestone 2), not after. Inlining the catalogue into today's monolithic prompt would add several thousand tokens to a request that is already carrying four jobs and running into truncation (D8). The stages have to exist first so the catalogue can be attached to the one stage that needs it.

A term first, because it recurs below. A **stage** here is a single-purpose function with its own prompt, its own small output schema, its own model and reasoning-effort settings, its own retry policy, and its own telemetry span. Stages compose in a fixed order inside `runHealthStructureService`, and each is independently unit-testable with a stubbed fetch, which is what makes per-stage scoring possible in Milestone 8.

Create `supabase/functions/health-structure/stages/` and give each stage a module.

_Stage A — classify and summarise_ (`stages/classify.ts`). Input: the OCR text alone. Output: `record_type`, `title`, `record_date`, `summary`, `keywords`. No catalogue, no patient context — none of it is relevant to deciding what kind of document this is. This is the cheapest and most forgiving of the four jobs, so it is the natural place to use a smaller, faster model, and its failure is not fatal: a missing title falls back to the OCR-suggested one that `health-ocr` already wrote.

_Stage B — extract clinical entities_ (`stages/extract.ts`). Input: the catalogue vocabulary plus the OCR text. Output: `observations`, `findings`, `conditions`, each carrying verbatim document text and a `source_anchor`. **This stage must not receive the patient's existing conditions, findings, or checkup items.** That omission is the entire fix for D14 — the model cannot echo back a condition it was never shown. It is also the accuracy-critical stage and the one that justifies the strongest model and the highest reasoning budget in the pipeline.

_Stage C — resolve codes_ (`stages/resolve.ts`). No model call at all. Takes stage B's verbatim text and resolves it to catalogue identifiers deterministically, applies unit conversion, and verifies each `source_anchor` actually occurs in the OCR text. Detailed in Milestone 2; it is listed here so the sequence is complete.

_Stage D — reconcile against patient state_ (`stages/reconcile.ts`). Input: the **resolved** entities from stage C, plus the patient's existing conditions, existing active findings, and upcoming checkup items. Output: `findings_to_resolve`, `conditions_to_resolve`, `checkups_to_complete`. Note what is absent: the raw OCR text. This stage sees only what stage B already committed to having found, so it cannot invent document content — it can only match, or decline to match. That is a matching problem rather than a reading problem, it is well served by a cheaper model than stage B, and it can be **skipped entirely** when the person has no existing conditions, no active findings and no due checkups, which is the common case for a new user and saves a call outright.

Wire the stages into `runHealthStructureService` in place of the single `deps.parseStructuredData` call, keeping `StructuredDataWithEntities` as the assembled result so the persistence code below it and the API response shape both stay unchanged. Keep `parseStructuredData` as the injection point for `e2e-stub-parse.ts` so the deterministic E2E lane keeps working; the stub simply returns the assembled shape as it does today.

Now fix the prompt-construction defects, which are cheap to do correctly once each prompt is small and single-purpose.

Give every stage an explicit output contract (D16). Each stage gets a strict JSON Schema of its own — four small schemas rather than one large one. Small schemas are materially better served by provider-side structured output than a single eleven-field schema, and they make a malformed response attributable to one stage. State enumerations as enumerations and dates as ISO-8601 patterns in the schema itself, so `status`, `severity`, `laterality` and `record_date` are constrained at generation time rather than discovered to be wrong at insert time.

Fence the document text (D15). Wrap the OCR text in explicit delimiters and state plainly, immediately before them, that the enclosed content is a transcription of a patient's document, that it is data to be read rather than instructions to be followed, and that any instruction-like text inside it must be treated as part of the document. Apply this to stage A and stage B, the two stages that receive document text.

Order every prompt stable-first (D17). Fixed instructions, then the output schema, then worked examples, then the catalogue vocabulary in stage B, and only then the variable content — the OCR text in stages A and B, the entity list in stage D. This makes the long prefix identical across records so provider-side prompt caching can reuse it, which matters most for stage B, where the catalogue block is the largest stable component.

Add worked examples. Two or three short input-to-output pairs per stage, drawn from the corpus in Milestone 8 once it exists and hand-written before then. Examples do more for schema adherence and for edge cases like "value present but unit absent" than any amount of additional instruction prose.

Set model and effort per stage rather than globally. Replace the single `OPENROUTER_HEALTH_STRUCTURE_MODEL` environment variable with per-stage overrides — `OPENROUTER_HEALTH_STAGE_CLASSIFY_MODEL`, `..._EXTRACT_MODEL`, `..._RECONCILE_MODEL` — each falling back to a sensible default so an unset environment still works. This is what makes cost tuning possible: stage B deserves the expensive model, stages A and D do not.

While restructuring the write path, stop writing `summary` into both `notes` and `llm_summary` (`service.ts:284-285`). Keep `llm_summary` for the model's output and leave `notes` alone; it is a user-editable field and the model should not be silently overwriting it.

### Milestone 2 — Ground the model in the real catalogues

**Scope.** After this milestone, extracted lab values carry correct `obs_code` values, resolve to `catalog_id`, get `is_applied = true`, and are unit-normalised — so they appear in the observation history and trend charts. The work lands in stage B and stage C from Milestone 1.

Work in two layers, because the first is a one-line-shaped fix and the second is the durable one.

_Layer one — send the vocabulary._ In `supabase/functions/health-structure/openrouter-parse.ts`, replace the `catalog_counts` field of `briefContext` (`:226-230`) with three compact vocabulary arrays. Compact matters: send `{ code, ru, en, unit }` for observations and `{ code, ru, en }` for finding types and body sites, dropping the `id`, `synonyms_*` and `accepted_units` fields, which the model does not need. At current catalogue sizes this is roughly three to five thousand tokens. Add explicit instructions that `obs_code` must be one of the listed observation codes or `null`, `finding_code` one of the listed finding codes or `null`, `site_code` one of the listed site codes or `null`, and that inventing a code is worse than returning `null`. Place the vocabulary block at the **start** of the prompt, before the person-specific context and the OCR text, so it forms a stable prefix that provider-side prompt caching can reuse across records.

_Layer two — stop treating the model's code as authoritative._ Extend the model's observation schema with `obs_name_text` and `unit_text`, holding the label and unit exactly as they appear in the document. Then add a new module `supabase/functions/health-structure/code-resolution.ts` exporting `resolveObservationCode(nameText, catalog)` and equivalents for finding types and body sites. Resolution proceeds in tiers: exact `obs_code` match if the model supplied one that exists; then case-folded and whitespace-normalised match against `name_ru`, `name_en`, `synonyms_ru` and `synonyms_en` — the columns already fetched at `repository.ts:124,138,151` and currently unused; then a trigram similarity match above a tuned threshold, using the `pg_trgm` extension via a new database function so the comparison happens where the data lives; then give up and mark the row `needs_mapping`. Rewrite `supabase/functions/health-structure/catalog.ts` to delegate to this module, keeping its current exported function names so `service.ts` need not change shape.

Once resolution is deterministic, `is_applied` should reflect whether resolution succeeded, and a row that failed resolution must be _visible_ rather than silent. Change `src/components/records/structure-review-step.tsx:268` from `const isUnapplied = isCustom && !observation.is_applied` to `const isUnapplied = !observation.is_applied`, so any unapplied row — with or without an `obs_code` — renders in the dashed, dimmed style and offers the Apply affordance. Correspondingly change the save-time cleanup filter at `:1003` from `!obs.obs_code && !obs.is_applied` to `!obs.is_applied`, so the two code paths agree on what "unapplied" means.

Also require anchoring for observations. `ExtractedFinding` already requires a non-empty `source_anchor` and `normalizeFinding` drops findings without one (`openrouter-parse.ts:132`). Extend the same requirement to observations, and — this is the part that must be enforced in code rather than asked for in the prompt — verify server-side that each `source_anchor` actually occurs as a substring of `ocr_text` after whitespace normalisation. An entity whose quoted evidence is not literally present in the document did not come from the document; drop it or flag it, and count it in telemetry.

### Milestone 3 — Per-entity validation with quarantine

**Scope.** After this milestone, one malformed field costs one row instead of the whole document, and the user can see what was rejected and why.

Introduce a schema validator at the boundary. The repository already depends on Zod for web code; for the Deno functions add `zod` to `supabase/functions/deno.json` imports and refresh the lockfile with `functions-lock-refresh`. Define the extraction schema once in a new `supabase/functions/health-structure/schema.ts`: enumerations for `status`, `severity`, `laterality` and `record_type`; an ISO `YYYY-MM-DD` date refinement for `record_date` and `finding_date`; numeric bounds for `confidence` (zero to one), `size_mm` and `count`. Export both the Zod schema and a JSON Schema derived from it, because Milestone 4 sends the JSON Schema to the provider — one definition, two consumers, no drift.

Rewrite `normalizeStructuredOutput` (`openrouter-parse.ts:160-222`) to validate each array element independently. Valid elements go into the result. Invalid elements go into a new `rejected` array carrying the entity kind, the raw payload and the validation message. Fix D4 in the same pass: an unparseable `record_date` becomes `null` with a rejection note rather than propagating to the database.

Add a `record_extraction_issues` table in a new migration under `supabase/migrations/`, with `record_id`, `entity_kind`, `raw_payload jsonb`, `reason text`, `created_at`, RLS mirroring `record_observations`, and a pgTAP test under `supabase/tests/`. Have `runHealthStructureService` write the rejects there, cleared on re-run the same way `replaceRecordObservations` clears (`repository.ts:255`). Surface the count in `structure-review-step.tsx` as a "N items need attention" section, so a partial extraction is honest rather than invisible.

While here, use the `confidence` field that is already collected on every entity (`types.ts:23,40,48`) and currently gates nothing. Sort the review list by ascending confidence so the least certain rows are seen first, and render rows below a configurable threshold with a visual marker.

### Milestone 4 — Transport reliability

**Scope.** After this milestone, a provider hiccup costs a retry instead of a record, and a truncated answer is detected rather than silently swallowed.

Add `supabase/functions/_shared/llm-fetch.ts` exporting `callOpenRouterWithRetry(request, opts)`, used by both `health-ocr/openrouter-client.ts` and `health-structure/openrouter-parse.ts`. It retries on HTTP 429, on 5xx, and on network and timeout errors, with exponential backoff and jitter, capped at three attempts, honouring `Retry-After` when present. It does **not** retry on 4xx other than 429, since those are our bugs. It reads `finish_reason` from the response and treats `"length"` as a distinct, retryable truncation condition rather than letting it surface as a JSON parse error. It returns `usage` alongside the content so callers can record token counts.

In both request bodies, add `provider: { require_parameters: true }` so OpenRouter only routes to providers that honour the parameters we send, and a `models` fallback array naming a second capable vision-and-JSON model after the primary. Replace `response_format: { type: "json_object" }` with the strict `json_schema` form built from the Milestone 3 schema, so the provider constrains generation to the shape we want instead of merely promising valid JSON. Keep the Zod validation on the way in regardless: provider-side enforcement is a strong prior, not a guarantee.

Give the OCR call the fenced-code-block fallback the structuring call already has (`openrouter-parse.ts:87-88`) so `openrouter-client.ts:137` stops being a single point of failure, and set an explicit completion budget on the structuring call, which currently has none.

Before merging, verify the chosen model's declared capabilities rather than assuming them — `GET https://openrouter.ai/api/v1/models` reports `supported_parameters` and `input_modalities` per model. Add a startup assertion in `deps.ts` for both functions that fails loudly at deploy time if the configured model does not declare support for structured outputs and image input, so a model rename never degrades silently into prose answers.

### Milestone 5 — Count cost; make structuring failures durable

**Scope.** After this milestone, each record's token cost is visible in telemetry and a failed structuring leaves something to debug from. The log redaction that previously sat here has moved to Milestone 0 — see the note there.

Record `usage.prompt_tokens` and `usage.completion_tokens` from the retry wrapper as span attributes on the existing `edge.health_structure.parse_llm` and `edge.health_ocr.page` spans (`service.ts:267` and `:149` respectively), matching what `money-categorize` already does at `supabase/functions/money-categorize/openrouter-categorize.ts:192-193`.

Add a `structure_error` column to `medical_records` in a migration, mirroring `ocr_error` from `supabase/migrations/20250130000001_add_ocr_failed_and_error.sql`. Write it on failure in `runHealthStructureService`'s catch block, clear it on success, and render it in the record detail view so a failed structuring leaves a durable, debuggable trace instead of a toast that vanishes on refresh.

### Milestone 6 — Chart-write ordering, sentinels, and idempotency

**Scope.** After this milestone, nothing new reaches the patient's condition list without a human approving it, newly resolved findings stop colliding with real zero values, and concurrent runs stop duplicating data or overwriting each other's results. Note the word "new" in each case: this milestone fixes the mechanisms going forward and deliberately leaves ambiguous historical rows alone, for reasons recorded in the `Decision Log`.

Move condition materialisation out of extraction. `runHealthStructureService` should write condition _proposals_ scoped to the record — either as `condition_records` rows with a nullable `condition_id` plus the proposed name and ICD code, or a small dedicated proposals table — and stop calling `resolveOrCreateCondition` during extraction entirely. The existing `resolveOrCreateCondition` logic moves to the activation path in `structure-review-step.tsx`'s `handleSave(activate = true)`, alongside `verifyAllConditions`.

Do **not** attempt to clean up the historical orphans as part of this milestone. The obvious predicate — delete `conditions` rows that are LLM-created, unverified and have no surviving `condition_records` — cannot be expressed against the current schema. `public.conditions` (`supabase/migrations/20250128000005_create_conditions.sql:5-28`) has no provenance columns at all; `is_llm_extracted` and `is_user_verified` live on `public.condition_records` (`:58-59`). An orphan by definition has no surviving `condition_records` row, so there is nothing left to read the provenance from, and a genuine user-created condition whose last record link was deleted is byte-for-byte indistinguishable from an LLM orphan. Deleting on that heuristic would destroy real chart data.

Establish provenance first, then clean up. Add `is_llm_extracted` and `is_user_verified` columns to `conditions` itself, defaulting existing rows to the conservative values (`is_llm_extracted = false`, `is_user_verified = true`) so nothing already in the database can be swept up by a later cleanup. Populate them correctly from the new proposal-then-materialise path. Once rows created _after_ this milestone carry trustworthy provenance, a cleanup restricted to those rows becomes safe. Rows predating it stay put: they are ambiguous, they are few, and the cost of deleting a real diagnosis is far higher than the cost of leaving a stale one for manual review. Surface them in the conditions UI as unreviewed rather than removing them.

Replace the zero sentinel. Add an explicit `resolution_status` column to `record_findings` with values `observed` and `resolved`, defaulting to `observed`. Update the writer (`resolution.ts:163-181`) to set `resolution_status: 'resolved'` and leave `size_mm` and `count` null, and the reader (`repository.ts:195-197`) to filter on `resolution_status` instead of on zero. Drop the `count: item.count || 1` coercion at `service.ts:171` so a real zero survives.

Do not backfill `resolution_status` from the `size_mm = 0 OR count = 0` heuristic. That would freeze the exact ambiguity the column exists to remove: a user-entered finding with a legitimate zero would be permanently relabelled `resolved`. Such rows can exist — `record_findings.size_mm` is an unconstrained `numeric` and `count` an unconstrained `integer DEFAULT 1` (`supabase/migrations/20250128000003_create_record_findings.sql:27-28`), and while the edit dialog puts `min="1"` on the count input (`src/components/findings/finding-edit-dialog.tsx:446`) it puts no minimum on size at all (`:433`); both are client-side hints the database does not enforce. Backfill only rows that carry independent evidence of resolution — a `source_anchor` matching the `Resolved: ` prefix that `resolution.ts:177` writes — and leave everything else as `observed`, flagged for review. Note that this means the reader's behaviour changes for ambiguous historical rows: they will start appearing as active findings again. That is the correct direction to err, and it should be called out in the release notes.

Add a real ownership claim, not just a status check. The obvious conditional update is not sufficient: a predicate of `status in ('ocr_review','structure_review','structuring')` still matches for a second concurrent caller once the first has set `structuring`, so both workers proceed and nothing is actually serialised. Dropping `structuring` from the predicate does not fix it either, because `src/hooks/use-structure-extraction.ts:43` sets that status client-side _before_ invoking the function, so the server would reject every legitimate call.

Fix both halves. Move the transition server-side — delete the client-side status write in `use-structure-extraction.ts` and have `runHealthStructureService` perform the claim itself — and make the claim identify its owner rather than merely observing a status. Add a `processing_run_id uuid` and `processing_started_at timestamptz` to `medical_records`; the claim is a conditional update that sets both and returns the row only when the record is unclaimed or its claim has expired past a lease timeout. An empty result means "someone else owns this run", and the handler returns without doing work.

The claim alone still does not close D9, because the completion writes are unconditional. `updateRecordSuccess` (`supabase/functions/health-ocr/repository.ts:113-127`) updates by `id` with no status predicate, so a stale worker whose client already gave up and wrote `ocr_failed` will still overwrite it with `ocr_review` and the record's state remains decided by whoever writes last. Every terminal write — `updateRecordSuccess`, `updateRecordFailure`, and the structuring equivalents — must additionally be conditioned on `processing_run_id` still matching the run that is writing. A worker that has lost its claim discards its result and logs the fact instead of persisting it.

### Milestone 7 — Get OCR off the request path and preprocess images

**Scope.** After this milestone, a five-page document processes reliably, the browser never waits on it, and OCR accuracy on phone photographs improves measurably.

Preprocess before encoding. In `supabase/functions/health-ocr/service.ts`, between `downloadAttachment` and base64 encoding (`:38-55`), downscale the image so its longest edge is roughly 1500–2000 pixels, convert to greyscale, and normalise contrast. Phone photographs of lab printouts are the dominant input, and resolution normalisation plus contrast is the highest-leverage accuracy lever available — it is also a large cost reduction, since the current path base64-encodes up to ten megabytes (`service.ts:28`), roughly 13.3 megabytes of JSON body held in edge-function memory per page.

Ask for structure, not prose. Lab reports are tables, and flattening a table to free text is where value-to-unit-to-reference-range mispairing originates. Change the OCR system prompt (`openrouter-client.ts:42-59`) to request GitHub-flavoured Markdown preserving table structure, and keep that Markdown in `ocr_text`. Then, in `health-structure`, send the page images _alongside_ the OCR text to the structuring model rather than text alone, so the model can consult the original layout when the text is ambiguous. This removes the lossy hand-off that the current two-stage design bakes in.

Parallelise and decouple. Replace the sequential attachment loop (`service.ts:146`) with bounded-concurrency execution — three or four at a time — and move the whole invocation onto a job queue so the browser fires and forgets. `src/hooks/use-processing-monitor.ts` and the realtime subscription already exist to report progress, so the client work is mostly deleting the 120-second `AbortController` path from `use-background-ocr.ts` and letting status changes drive the UI.

### Milestone 8 — A scored regression corpus

**Scope.** After this milestone, "extraction got worse" is a number in CI, not an impression.

Assemble twenty to fifty real de-identified documents — a mix of blood panels, imaging reports, prescriptions and at least one deliberately poor photograph — under `test/fixtures/extraction/`, each paired with a hand-checked expected extraction. Add a scorer that reports precision and recall for observations, findings and conditions, plus exact-match accuracy for `obs_code` resolution, unit canonicalisation and `record_date`. Expose it as `just test-extraction` and register the command in `AGENTS.md`.

Run it two ways: in CI against recorded provider responses so it is deterministic and free, and on a schedule against the live provider so model drift is caught. Wire a floor into `coverage-check` so a regression below the agreed threshold fails the build. Separately, add the test that would have caught D1 — a unit test in `openrouter-parse_test.ts` asserting that the outgoing request body contains the actual catalogue codes and not merely their counts.

## Concrete Steps

All commands run from the repository root, `/home/user/Orbit`.

Steps below are named by their **command ID** — the stable identifier registered in `AGENTS.md`, which is the canonical registry mapping IDs to concrete command lines. `AGENTS.md` asks docs and plans to refer to commands by ID so they survive changes to the underlying implementation. The exact command line is shown alongside each ID once, because `docs/PLANS.md` requires this plan to be followable by someone who has only the working tree and this file. If an ID and the command shown here ever disagree, `AGENTS.md` wins — run `commands-list` (`just commands-list`) to see the current mapping.

Before starting, bring the local stack up and confirm a clean baseline:

    install       ->  just install-dependencies
    dev-ready     ->  just dev-ready-local     # long-running: start in the background
    ci-fast       ->  just ci-verify-local-fast

Expect `ci-fast` to pass. If it does not, fix that first — this plan assumes a green baseline.

While working on the Deno edge functions, the fast loop is:

    test-unit-functions  ->  just test-unit-functions
    lint-supabase        ->  just quality-lint-supabase-functions
    types                ->  just quality-typecheck

After a milestone that adds a migration:

    db-reset              ->  just supabase-local-reset-and-deploy
    db-artifacts-refresh  ->  just supabase-local-artifacts-refresh
    db-lint               ->  just quality-db-lint
    db-test               ->  just quality-db-test

`db-artifacts-refresh` regenerates the schema snapshot and the TypeScript database types; skipping it makes `types` fail with confusing errors about missing columns.

Before pushing any milestone, run the full gate:

    ci  ->  just ci-verify-local

To exercise the pipeline end to end with the deterministic stub parser rather than a live model, set `HEALTH_STRUCTURE_PARSER_MODE=e2e_stub` — read in `supabase/functions/health-structure/deps.ts:68-70` — and run:

    test-e2e  ->  just test-e2e

Note that the stub (`supabase/functions/health-structure/e2e-stub-parse.ts:37-42`) returns empty observation and finding arrays, so the E2E lane proves the plumbing and the status transitions, not extraction quality. Extraction quality is Milestone 8's job.

## Validation and Acceptance

**Milestone 0.** Run a structuring pass against a document containing a recognisable diagnosis and lab value, then search the edge-function logs for that diagnosis text, for one of the lab values, and for the key `raw_response`. All three must return nothing. Before this milestone all three are present in full on every request. Separately, confirm the historical purge ran: search the retained log window for the same `health_structure_llm_debug` marker and expect no hits.

**Milestone 1.** Two things to observe, one structural and one behavioural.

Structurally, run a structuring pass with a fetch stub that records every outgoing request and assert that three calls are made where one was made before — classify, extract, reconcile — each carrying its own small schema, and that a person with no conditions, no active findings and no due checkups produces only two, the reconcile stage having been skipped. Assert that the extract call's body contains **none** of the person's existing condition names; that is the D14 regression test and it fails before this milestone and passes after.

Behaviourally, take a document for a person whose chart already lists a condition the document does not mention — this is the contamination case — and confirm the extracted conditions do not include it. Before this milestone the model can echo it back from context; after, it has never seen it. Also confirm a truncation-prone dense multi-page document now completes, since no single response has to carry all eleven fields.

**Milestone 2.** Upload a photograph of a blood panel containing at least one analyte present in `observation_catalog` — ferritin and vitamin B12 are both seeded. Complete OCR review, run structuring, and inspect the resulting `record_observations` rows: `obs_code` matches a real catalogue code, `catalog_id` is non-null, `is_applied` is true, and `value_canonical` differs from `value_numeric` whenever the document's unit differs from the catalogue's `canonical_unit`. Activate the record and open the observation history — the value appears in the trend. Before this milestone the same document produces `catalog_id: null`, `is_applied: false` and nothing in the trend. Add a unit test asserting the outgoing prompt contains the string `ferritin`; it fails before the change and passes after.

**Milestone 3.** Feed the parser a fixture whose fourth observation has `status: "borderline"` and whose others are valid. Expect the three valid observations to be written, one row in `record_extraction_issues` naming the invalid `status`, and the review screen to show "1 item needs attention". Before this milestone the same input produces zero observations and a generic failure.

**Milestone 4.** With a stubbed fetch that returns HTTP 429 twice and then succeeds, expect one successful extraction and telemetry showing two retries. With a stub returning `finish_reason: "length"`, expect a distinct truncation error, not `"OpenRouter returned invalid JSON content"`. With `OPENROUTER_HEALTH_STRUCTURE_MODEL` set to a text-only model, expect the deploy-time assertion to fail with a message naming the missing capability.

**Milestone 5.** Run a structuring pass and confirm the `edge.health_structure.parse_llm` span carries prompt and completion token counts. Force a structuring failure, refresh the record detail page, and confirm the error is still displayed from `structure_error` rather than having vanished with the toast.

**Milestone 6.** Run structuring on a document mentioning a new diagnosis, then close the tab without activating. Query `conditions` for that person: the diagnosis is absent. Re-open, activate, and confirm it appears.

For the ownership claim, fire two `health-structure` requests for the same record concurrently and confirm exactly one set of rows, one set of `condition_records`, and one of the two responses reporting that the record was already claimed. Then test the stale-worker path explicitly, since that is the part an entry-time status check does not cover: start an OCR run, let the client abort and write `ocr_failed`, and allow the worker to finish afterwards. The record must remain `ocr_failed` — the stale worker discards its result because its `processing_run_id` no longer matches — and the discard must appear in telemetry. Before this milestone the same sequence leaves the record in `ocr_review`, decided purely by write order.

For the sentinel replacement, seed a `record_findings` row with `size_mm = 0` and a `source_anchor` that does not begin with `Resolved: `, run the migration, and confirm it comes back as `observed`, not `resolved`. Seed a second with the `Resolved: ` prefix and confirm it migrates to `resolved`.

**Milestone 7.** Upload a five-page PDF. The browser returns immediately, the processing indicator advances, and the record reaches `ocr_review` with all five pages present. Before this milestone the request aborts at 120 seconds and the record is left in a raced state. Compare `ocr_text` for a deliberately poor photograph before and after preprocessing and confirm the table structure survives as Markdown.

**Milestone 8.** `test-extraction` (`just test-extraction`) prints per-category precision and recall and exits non-zero when any category falls below its floor.

## Idempotence and Recovery

Every step here is safe to repeat. Migrations use `IF NOT EXISTS` guards in line with existing migrations in `supabase/migrations/`. `db-reset` rebuilds the local database from scratch and is the recovery path whenever local state looks inconsistent; `db-run` is the non-destructive day-to-day sync.

Two steps in Milestone 6 need care, and in both cases the safe move is to do less rather than more. The historical orphan conditions are deliberately **not** deleted — the provenance needed to identify them safely does not exist in the schema, so the milestone adds the provenance columns and leaves pre-existing rows alone. Do not "improve" this into a cleanup during implementation: an over-broad predicate here deletes real diagnoses from a patient's chart, and there is no undo. If a cleanup is wanted later, it must be restricted to rows created after the provenance columns exist.

The `resolution_status` backfill has the same shape. It must run in the same migration that adds the column, so no window exists where the reader filters on an unpopulated column, and it must be restricted to rows carrying the `Resolved: ` anchor prefix. Anything ambiguous stays `observed`. Both migrations are additive and re-runnable; neither destroys data, so recovery is a matter of re-running them.

Milestone 0 is the one step with an irreversible external component. Deleting the logging line is trivially revertable, but purging already-emitted logs is not — take whatever export your retention policy requires before purging, and confirm the export excludes the leaked payloads rather than preserving them somewhere new.

Milestones 1 through 5 are additive and independently revertable. Milestone 7's move to a job queue changes the client contract, so land it behind a feature flag and keep the synchronous path until the queued path has run clean for a full release cycle.

## Artifacts and Notes

The defect at the centre of this plan, as it currently stands in `supabase/functions/health-structure/openrouter-parse.ts:225-235`:

    function buildPrompt(ocrText: string, context: OpenRouterParseContext): string {
      const briefContext = {
        catalog_counts: {
          observations: context.observationCatalog.length,
          finding_types: context.findingTypeCatalog.length,
          body_sites: context.bodySiteCatalog.length,
        },
        ...

Contrasted with the money pipeline doing the same job correctly, `supabase/functions/money-categorize/openrouter-categorize.ts:81`:

    `Allowed categories: ${JSON.stringify(request.candidateCategories)}`,

And the silent-loss path in the review UI, `src/components/records/structure-review-step.tsx:268`:

    const isCustom = !observation.obs_code;
    const isUnapplied = isCustom && !observation.is_applied;

A row carrying a hallucinated `obs_code` has `isCustom === false`, so `isUnapplied` is `false`, so the row renders as a normal applied observation — while `src/hooks/use-observation-history.ts:56` filters it out of every history query.

## Interfaces and Dependencies

Continue using OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) as the gateway, configured through `OPENROUTER_API_KEY` and `OPENROUTER_HEALTH_STRUCTURE_MODEL` as today. Add `zod` to `supabase/functions/deno.json` for boundary validation, and enable the `pg_trgm` Postgres extension for fuzzy catalogue matching.

In `supabase/functions/_shared/llm-fetch.ts`, define:

    export interface LlmCallResult {
      contentText: string;
      finishReason: string | null;
      usage: { promptTokens: number | null; completionTokens: number | null };
      attempts: number;
    }

    export function callOpenRouterWithRetry(
      request: { model: string; body: Record<string, unknown> },
      opts: { fetchFn: typeof fetch; apiKey: string; timeoutMs: number; maxAttempts?: number },
    ): Promise<LlmCallResult>;

In `supabase/functions/health-structure/stages/types.ts`, define the shape every stage shares, so stages are uniform enough to be driven by a common runner and scored individually:

    export interface StageContext {
      fetchFn: typeof fetch;
      apiKey: string;
      model: string;
      effort?: "low" | "medium" | "high";
      timeoutMs: number;
      telemetry?: EdgeTelemetry;
    }

    export interface StageResult<T> {
      value: T;
      usage: { promptTokens: number | null; completionTokens: number | null };
      finishReason: string | null;
      rejected: Array<{ entityKind: string; raw: unknown; reason: string }>;
    }

Then one module per stage, each exporting a single function:

    // stages/classify.ts  — OCR text only; no catalogue, no patient context.
    export function runClassifyStage(
      ocrText: string,
      ctx: StageContext,
    ): Promise<StageResult<StructuredData>>;

    // stages/extract.ts   — catalogue vocabulary + OCR text. Deliberately NO patient context.
    export function runExtractStage(
      ocrText: string,
      catalogs: Pick<
        HealthStructureParseContext,
        "observationCatalog" | "findingTypeCatalog" | "bodySiteCatalog"
      >,
      ctx: StageContext,
    ): Promise<StageResult<ExtractedEntities>>;

    // stages/reconcile.ts — resolved entities + patient state. Deliberately NO OCR text.
    export function runReconcileStage(
      resolved: ResolvedEntities,
      patient: Pick<
        HealthStructureParseContext,
        "existingConditions" | "existingFindings" | "checkupItems"
      >,
      ctx: StageContext,
    ): Promise<StageResult<ReconciliationResult>>;

The two `Pick` types are the enforcement mechanism for the D14 decision, not documentation of it: `runExtractStage` cannot be handed patient context and `runReconcileStage` cannot be handed the document text, because neither parameter exists. Keep them that way — widening either signature reintroduces the contamination.

In `supabase/functions/health-structure/code-resolution.ts`, define:

    export type CodeResolution<T> =
      | { kind: "resolved"; entry: T; via: "code" | "name" | "synonym" | "fuzzy" }
      | { kind: "unresolved"; reason: string };

    export function resolveObservationCode(
      modelCode: string | null,
      nameText: string,
      catalog: ObservationCatalogItem[],
    ): CodeResolution<ObservationCatalogItem>;

    export function resolveFindingTypeCode(
      modelCode: string | null,
      nameText: string,
      catalog: FindingTypeCatalogItem[],
    ): CodeResolution<FindingTypeCatalogItem>;

    export function resolveBodySiteCode(
      modelCode: string | null,
      nameText: string | null,
      catalog: BodySiteCatalogItem[],
    ): CodeResolution<BodySiteCatalogItem>;

In `supabase/functions/health-structure/schema.ts`, export a `StructuredExtractionSchema` Zod object and a `structuredExtractionJsonSchema` derived from it, so the provider-side `response_format: { type: "json_schema" }` payload and the server-side validation share one definition.

`supabase/functions/health-structure/catalog.ts` keeps its three current exported function names — `findCatalogEntry`, `findFindingTypeCatalogEntry`, `findBodySiteCatalogEntry` — and delegates to `code-resolution.ts`, so `service.ts` requires no import changes.

Related design documents that must be updated as milestones land: `docs/design/domains/health/records-ingestion-pipeline.md` (the idempotency claim at line 57 and the review-transition rule at line 53 both become true only after Milestone 6) and the task registry under `docs/tasks/` (add tasks with `kind: debt` for the log leak and the missing extraction eval, closing them as the corresponding milestones complete; see `docs/tasks/README.md`).

## Revision Notes

**2026-08-02 — first revision, following review of the initial plan.** Six changes, all tightening steps that were either unimplementable as written or claimed more than they delivered. Each is recorded in full in the `Decision Log`; summarised here so a reader can see what moved and why.

The log redaction was promoted out of Milestone 5 into a new standalone Milestone 0, because bundling it behind three milestones of other work meant patient data would keep accumulating in logs for the duration. It also grew a step it was missing: purging what has already been emitted, not just stopping new emissions.

Three Milestone 6 steps were wrong rather than merely incomplete. The orphan-condition cleanup was unimplementable — the provenance columns it filtered on do not exist on `conditions` — and would have deleted genuine chart data; it is now replaced by adding provenance and explicitly leaving historical rows alone. The `resolution_status` backfill would have frozen the exact ambiguity the column was introduced to remove; it is now restricted to rows carrying independent evidence of resolution. The idempotency guard did not serialise anything, since the proposed status predicate still matched for a second concurrent caller, and it did not close D9 at all, since the terminal writes are unconditional; it is now an owner-identifying lease with guarded completion writes.

Finally, the `Concrete Steps` and `Validation and Acceptance` sections now name commands by their `AGENTS.md` command ID with the concrete command line shown alongside, resolving the tension between the repository's documentation DRY rule and this document's self-containment requirement.

The `Progress`, `Decision Log`, `Plan of Work`, `Concrete Steps`, `Validation and Acceptance` and `Idempotence and Recovery` sections were all updated to match. No defect in `Context and Orientation` changed — the twelve findings and their evidence stand as originally recorded.

**2026-08-02 — second revision, following a review of the call's overall shape.** The first version of this plan fixed grounding, validation, transport and persistence but left the request shape alone: one call producing eleven fields across four unrelated tasks. That omission was raised by the repository owner and is the substantive gap this revision closes.

Five defects were added to `Context and Orientation` under a new heading, taking the total from twelve to seventeen. D13 records the task overload itself. D14 is the most consequential: the patient's existing conditions are supplied to the same call that extracts conditions from the document, guarded only by a line of prose, and because extracted conditions bypass review (D10) an echoed condition becomes a chart entry. D15 covers the undelimited interpolation of document text into the instruction message. D16 records that the prompt never states an output contract, which is where the D3 and D4 insert failures actually originate. D17 covers prompt ordering that would defeat caching once the catalogue is present.

A new Milestone 1 splits the call into four stages — classify, extract, resolve, reconcile — and all later milestones were renumbered up by one. It is sequenced deliberately **before** grounding rather than after: inlining the catalogue into today's monolithic prompt would add thousands of tokens to a request already large enough to truncate, so the stages must exist first to give the catalogue somewhere narrow to attach. The stage signatures in `Interfaces and Dependencies` enforce the separation in the type system rather than by convention — the extraction stage has no parameter through which patient context could arrive, and the reconciliation stage has none through which document text could.

The milestone also folds in the prompt-construction fixes that only become cheap once each prompt is small: per-stage JSON Schemas, fenced document text, stable-first ordering, worked examples, and per-stage model and effort selection. One unrelated redundancy is fixed alongside them — the model's summary currently overwrites the user-editable `notes` field as well as `llm_summary`.

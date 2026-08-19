# Let a lab result close the condition it defines

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`docs/PLANS.md`](../../PLANS.md) from the repository root.

It follows [`health-extraction-defects-found-by-the-corpus.md`](./health-extraction-defects-found-by-the-corpus.md), whose six milestones are landed and whose final measurement exposed the defect below. That plan is checked in and is incorporated here by reference; you do not need to read it, because every fact this plan relies on is restated here.

## Purpose / Big Picture

A person has "Дефицит витамина B12" — vitamin B12 deficiency — recorded as an active condition on their chart. They have a blood test. The result comes back at 704 pg/mL against a printed reference range of 187–883, which is comfortably normal. The app reads the document, stores the result correctly, and leaves the condition marked active. Nothing closes it, nothing flags it, and nobody is told. The chart still says this person is B12 deficient.

This is not a flaky failure. Three consecutive live runs of the evaluation corpus produced the same answer: `conditions_to_resolve` scored 0%, stable, with one false negative every time. The pipeline is not occasionally missing this — it never does it.

The evidence needed is genuinely in front of the model. The reconciliation stage receives each extracted observation as name, code, value, unit and status, and this document's B12 row arrives with `obs_code: "vitamin_b12"` and `status: "normal"`. It has an active condition whose entire clinical meaning is that this exact analyte is low. It still returns an empty list, because nothing ever told it this counts. The stage carries one strong instruction about resolutions — "Only report a resolution when the extracted entities positively support it. Absence of a mention is not evidence of resolution." — and no rule saying that an analyte returning to its reference range is positive support for closing a deficiency named after that analyte. Faced with a conservative instruction and no permission, it declines. That is correct behaviour for the rule it was given.

After this work, a lab value that returns to normal **proposes** closing the condition defined by that value; a person confirms it in one tap and the chart updates. The four conditions on the same document that must not close are never proposed. Separately, an unconfirmed machine-made closure stops being able to change a chart at all, which is a safety fix worth having on its own.

You can see the extraction half working by running `just test-extraction` and reading the report. You can see the product half by opening a condition and confirming a proposal.

## Why this is dangerous to get wrong

Closing a condition is a write, and today it is an unsupervised one. `processConditionsToResolve` in `supabase/functions/health-structure/resolution.ts` inserts a condition record with `status_in_record: "resolved"`, then calls `recomputeConditionCurrentStatus`. That function, implemented in `repository.ts`, takes the single most recent condition record by document date and writes its status straight into `conditions.current_status`. It does **not** filter on `is_user_verified`. So a machine-authored resolution is authoritative the instant it is written, even though the row itself records that no human has checked it.

The two mistakes are not symmetric. A missed resolution leaves a stale "active" row that a person or clinician can see and correct. A wrongful resolution silently ends a live entry in a medical record, and nothing afterwards prompts anyone to look at it again. Every design decision below resolves in favour of not closing when unsure, and the corpus report's wrongful-resolution count — printed at the top, currently zero — is the number to watch throughout. If it rises, stop.

## Progress

- [ ] Milestone 1 — Stop an unconfirmed machine closure from changing a chart.
- [ ] Milestone 2 — Make the claim checkable (`supporting_obs_code`, the deterministic gate, the analyte table).
- [ ] Milestone 3 — Teach reconciliation the rule (instruction, off-corpus example, re-record, measure).
- [ ] Milestone 4 — Let a person see the proposal and confirm it.
- [ ] Milestone 5 — Lock it in (score the new field, name the traps, define how an entry earns auto-close).

## Surprises & Discoveries

Record new findings here as work proceeds. The entries below were established by reading the code and by three live runs of the corpus on 2026-08-09.

- Observation: The model has the evidence and declines to use it, so this is a prompt defect rather than a plumbing defect.
  Evidence: `buildExtractedSummary` in `stages/reconcile.ts` passes each observation as `{name, code, value, unit, status}`. The recorded extraction for case 001 emits `{"obs_code": "vitamin_b12", "value_numeric": 704, "ref_range_low": 187, "ref_range_high": 883, "status": "normal"}`. The recorded reconciliation returns `conditions_to_resolve: []` while correctly completing four checkups, one of which quotes the B12 value in its reason text. It read the row and did not act on it.

- Observation: The failure is perfectly stable, which is unusual on this corpus and makes a fix cheap to verify.
  Evidence: `--live --repeat 3` on 2026-08-09 reported `conditions_to_resolve` f1 at 0.0% with `fn` of 1.0 on every pass, marked `stable`. Most dimensions on this corpus swing between runs; this one does not.

- Observation: The obvious rule — "an analyte is normal, so close the condition" — would cause wrongful closures on the very same document.
  Evidence: case 001 carries five active conditions. Every lipid value is inside its reference range, so a naive rule closes `Дислипидемия`. ALT, AST and GGT are all in range, so it also closes `Неалкогольная жировая болезнь печени`, which is an imaging and histology diagnosis that enzymes cannot exclude. The corpus requires all four non-B12 conditions to stay open.

- Observation: An unverified machine closure is authoritative today. This is a live safety defect independent of the missing feature.
  Evidence: `recomputeConditionCurrentStatus` in `repository.ts` selects the newest `condition_records` row by document date and writes its `status_in_record` into `conditions.current_status` with no reference to `is_llm_extracted` or `is_user_verified`. The predecessor plan's baseline run recorded exactly one wrongful condition resolution, which under this logic would have changed a chart.

- Observation: Keying the mapping on ICD codes does not work, and this changed the design.
  Evidence: `conditions.code` is `text` and nullable, and `resolution.ts` creates conditions with `code: extracted.icd_code ?? null`, so a condition the model did not code — or whose code the WHO lookup did not confirm — carries no ICD at all and could never match an ICD-keyed table. ICD-10 also runs to roughly seventy thousand codes, which is unbounded curation, and the same clinical entity appears as `D50`, `D50.9` and `D509`, so exact string matching is brittle. The table is therefore keyed on the observation catalogue instead, which has thirty-eight entries and is already curated and already pinned in the eval snapshot.

- Observation: `status_in_record` cannot simply gain a "suggested" value.
  Evidence: `condition_records.status_in_record` carries `CHECK (status_in_record IN ('active','resolved','suspected','history'))`, and `conditions.current_status` carries the same four-value check. A new status string would need both constraints altered and would then be writable into `current_status`, which is the opposite of the intent. Reusing the existing `is_user_verified` boolean avoids inventing a state that the schema already expresses.

## Decision Log

- 2026-08-09 — A lab-driven resolution proposes rather than closes, and a person confirms it. Reason: it removes the wrongful-closure risk structurally rather than by being careful, and it decouples shipping from perfecting the mapping. The table can start almost empty and the feature still delivers on day one, because a proposal is useful and safe even where the mapping is uncertain. It also produces the data that curates the table — see the next entry.

- 2026-08-09 — Curation is bootstrapped from confirmations, not from an upfront pass over ICD-10. Reason: every confirm or reject is a labelled example of "does a normal _analyte_ close _this condition_". A pair that is consistently confirmed can be promoted to auto-close; a pair that is consistently rejected is evidence the entry is wrong. This keeps the table honest as the product's condition vocabulary grows, and it makes a wrong entry loud rather than silent, which is the failure mode the whole predecessor plan was about.

- 2026-08-09 — The table is keyed on the observation catalogue, not on ICD codes, and lives in code. Reason for the key: ICD is nullable on conditions, unbounded in size, and inconsistently formatted, while the catalogue is thirty-eight entries the team already owns. Asking "for each analyte, does a normal value close anything?" is finite. Reason for code rather than a database table: this is policy about when the system may write to someone's record, not clinical vocabulary. The existing catalogues are world-readable reference data and `finding_type_catalog` is additionally world-writable, which the predecessor plan flagged as a data-isolation problem; policy governing writes must not live somewhere a user can extend it.

- 2026-08-09 — The initial table is drafted here with an explicit confidence marker per entry, and the uncertain ones ship as proposal-only. Reason: the author of this plan is not a clinician. Marking an entry as confident or uncertain, in the code, makes the distinction reviewable rather than implied, and pairs it with the promotion rule above: uncertain entries can only ever propose until confirmations say otherwise.

- 2026-08-09 — Making unverified closures non-authoritative changes behaviour beyond this defect, and that is intended rather than incidental. Reason: it applies to every machine-authored condition resolution, including ones the pipeline already produces today. The predecessor plan's baseline recorded a wrongful one. Narrowing the change to only lab-driven resolutions would leave the more dangerous path — a resolution with no verification story at all — exactly as it is.

- 2026-08-09 — The deterministic gate is a floor, not the discriminator, and this plan says so rather than implying otherwise. Reason: the gate rejects a resolution that cites nothing, cites an analyte absent from this document, or cites one out of range. It does not by itself separate dyslipidaemia from B12 deficiency, because a cited cholesterol value passes all three checks. The analyte table is what separates them, and the confirmation step is what catches the table being wrong.

## Outcomes & Retrospective

To be completed as milestones land. For each, record what changed, what the corpus reported before and after, and anything that turned out differently from what this plan assumed. Record the wrongful-resolution count every time, including when it stays at zero.

## Context and Orientation

Every path below is relative to the repository root. If you have not worked in this repository before, read this section in full.

**The pipeline.** `supabase/functions/health-structure/` is a Supabase Edge Function running on Deno. It receives the OCR text of a medical document — a plain string already stored on the record, so this function never sees an image — and produces structured clinical data. Three model calls run in sequence, called stages, under `stages/`. The `classify` stage decides what kind of document this is and what date it describes. The `extract` stage pulls clinical entities out of the text and receives the code catalogues as vocabulary, but deliberately never receives the patient's history. The `reconcile` stage compares extracted entities against the patient's existing record and reports which existing findings and conditions the document shows to have resolved, and which due checkups it completes; it receives the extracted entities and the patient record but deliberately never receives the document text. That blindness is a designed property, stated in the comment above `runReconcileStage`, and it must survive this work: reconcile may gain more signals derived from extraction, but never the document itself.

**The deterministic half.** After the stages finish, `service.ts` turns their output into database rows with no model involved, and `resolution.ts` applies resolutions to existing records. `processConditionsToResolve` writes `status_in_record: "resolved"`. Verification belongs here, because it must be testable without spending a request and must not be something the model can talk its way past.

**How a condition's status is decided.** `conditions` holds one row per condition per person, with a nullable ICD `code` and a `current_status` of `active`, `resolved`, `suspected` or `history`. `condition_records` holds one row per condition per document, with `status_in_record` from the same four values, plus `source_anchor`, `confidence`, `is_llm_extracted` and `is_user_verified`. `recomputeConditionCurrentStatus` in `repository.ts` reads the newest `condition_records` row by the document's `record_date` and copies its `status_in_record` onto the condition. Both `is_*` flags are recorded and neither is consulted. Milestone 1 changes that.

**The catalogues.** Three reference tables define vocabulary: `observation_catalog` (38 analytes including `vitamin_b12`, `vitamin_d_25oh`, `hemoglobin`, `ferritin`, `serum_iron`, `tsh`, `hba1c`, `glucose`), `finding_type_catalog` and `body_site_catalog`. The eval uses a pinned snapshot at `test/fixtures/extraction/shared/catalogs.json`, regenerated by `scripts/extraction-eval/dump-catalogs.ts`. It is pinned so an unrelated catalogue edit cannot silently move every score.

**The eval harness.** `scripts/extraction-eval/` runs the real pipeline against hand-checked documents and scores the result. `just test-extraction` replays recorded provider responses, called cassettes, so the default run is free, offline and deterministic. `--live` calls OpenRouter and costs money. `--record` implies `--live` and refreshes the cassettes. `--repeat N` runs each case N times and reports mean and spread, and refuses without `--live`, because replaying one recording N times reports a spread of zero that reads as stability. The report prints per-case and total cost.

Cassettes are keyed on a digest of the model and the messages only — not the whole request body. This matters concretely here: **changing a JSON schema does not invalidate the cassettes on its own.** Add a field to the reconcile schema without changing prompt text and the corpus will replay old recordings that cannot contain it, looking healthy while measuring nothing. Milestone 2 changes the schema and must re-record explicitly.

Note also that the eval scores the **stage output**, not the database write. Milestones 2 and 3 are what the corpus can see; Milestones 1 and 4 are production safety and are verified by tests and by using the app.

**The case this plan is about.** `001-biochem-lipid-ru` is a Russian biochemistry and lipid panel. Its `meta.json` sets up five active conditions and states, in `condition_reconciliation_intent`, that exactly one must resolve and four must not. The one is `00000000-0000-4000-9000-000000000001`, Дефицит витамина B12. The four are iron-deficiency anaemia (no haemoglobin, ferritin or blood count anywhere in the document), non-alcoholic fatty liver disease (normal enzymes do not exclude steatosis), dyslipidaemia (every lipid in range, but that is control rather than cure) and chronic gastritis (nothing in a biochemistry panel bears on it). The case is one positive against four traps, and it is the whole extraction-side acceptance surface.

To run anything you need `npm ci` and, for live runs, `OPENROUTER_API_KEY`. Deno is needed for edge-function tests. The OpenRouter key carries a weekly spend limit separate from the account balance; if live calls return HTTP 403 with "Key limit exceeded (weekly limit)", raise the key's weekly limit rather than adding credit.

## Plan of Work

### Milestone 1 — Stop an unconfirmed machine closure from changing a chart

This milestone fixes a live safety defect and owes nothing to the rest of the plan. At the end of it, a condition resolution written by the model is recorded, visible and attributable, but does not move `conditions.current_status` until a human marks it verified. Every other status a record can carry is unaffected.

Change `recomputeConditionCurrentStatus` in `supabase/functions/health-structure/repository.ts`. Today it selects the single newest `condition_records` row by `medical_records.record_date` and writes its `status_in_record` onto the condition. Change it to ignore rows that are simultaneously a resolution, machine-authored and unverified — that is, `status_in_record = 'resolved'` and `is_llm_extracted` and not `is_user_verified` — and to use the newest remaining row instead. If no row remains, leave `current_status` untouched rather than defaulting it to anything.

Be careful with the shape of the query. The current implementation orders by document date and takes one row; the filtered version must apply the exclusion _before_ the limit, or a suppressed resolution will simply hide the row beneath it and leave the status stale in a different way. Write it as a filtered select with the same ordering and a limit of one.

Restrict the exclusion to resolutions. A machine-authored `active` or `suspected` row is how conditions get onto the chart in the first place, and suppressing those would stop the product working. Only closure is being made to require confirmation, because only closure destroys information.

Test it in `repository_test.ts` alongside the existing coverage: an unverified machine resolution leaves `current_status` as it was; the same row with `is_user_verified: true` applies; a machine `active` row still applies; and a verified resolution beneath an unverified one still wins rather than being shadowed by it.

This milestone is done when the Deno suite passes with those four tests, and when the corpus is unchanged — it scores the stage output and never touches the database, so a change here must move no number in the report at all. If a corpus number moves, something is wired more broadly than intended.

### Milestone 2 — Make the claim checkable

Nothing here changes what the model is asked to do. It changes what the system will accept from it, so that when Milestone 3 makes resolutions start happening there is already a floor underneath them.

Add a `supporting_obs_code` property to the `conditions_to_resolve` item schema in `RECONCILE_SCHEMA` in `stages/reconcile.ts`: the catalogue code of the observation whose value establishes the resolution, or null. Strict `json_schema` mode requires `required` to name every key in `properties`, so express it as a required nullable; the existing test named `every stage schema satisfies strict json_schema mode` enforces this. Carry the field through the stage's normaliser into `ConditionToResolve` in `types.ts`.

Add the analyte table to `resolution.ts`, keyed on observation code. Each entry names the codes that must all be in range, the condition it speaks to, whether the entry is confident enough to ever auto-close, and a sentence of reasoning. The draft below is written by a non-clinician and marks its own uncertainty; treat the `confident` flag as a claim to be reviewed, not a fact.

    vitamin_b12    requires vitamin_b12                confident
                   A B12 deficiency is the statement that B12 is low. A normal level ends it.

    vitamin_d_25oh requires vitamin_d_25oh             confident
                   Same shape: the deficiency is defined by the measurement.

    ferritin       requires ferritin AND hemoglobin    uncertain
                   Iron-deficiency anaemia needs both. Haemoglobin is what makes it anaemia and
                   ferritin is what makes it iron deficiency; either alone leaves half the
                   diagnosis unaddressed. Flagged because replete iron stores under active
                   supplementation may read as resolution when they are maintenance.

    tsh            deliberately excluded
                   Treated hypothyroidism has a normal TSH precisely because it is treated. This
                   is the same trap as dyslipidaemia and must not be added without a clinician.

    glucose,hba1c  deliberately excluded
                   Controlled diabetes is not resolved diabetes.

Three exclusions carry over from the corpus's own traps and must be commented as deliberate, or someone will helpfully add them: lipids do not resolve dyslipidaemia, because an in-range panel under management is control rather than cure; liver enzymes do not resolve non-alcoholic fatty liver disease, which is an imaging and histology diagnosis; and nothing in a biochemistry panel resolves chronic gastritis, which is endoscopic.

Note that the confidently-resolvable set is small — two entries, possibly three. That is not a gap in the draft; it is the honest size of the category, and it is why proposing rather than closing is what makes this feature worth building at all.

Then add the gate, evaluated in `resolution.ts` against the observations extracted from _this_ document, before anything is written. A resolution must satisfy all of: the cited `supporting_obs_code` is non-null and names an entry in the table; every observation code that entry requires is present among this document's extracted observations; and each of those is in range, decided numerically from `value_numeric` against `ref_range_low` and `ref_range_high` when the document printed a range, falling back to the extracted `status` only when it did not, and treating a missing or unparseable value as not in range rather than as passing.

A resolution failing any check is dropped, not written, and the drop is reported as a `StageRejection` with a fixed reason string naming the failing check — never the entity's content, since these strings reach logs. Distinguish the cases: `no supporting observation cited`, `analyte cannot resolve a condition`, `required observation absent from this document`, `supporting observation is not in range`.

Because this changes the reconcile schema and cassettes key on model and messages only, re-record deliberately at the end: `OPENROUTER_API_KEY=... npx tsx scripts/extraction-eval/run.ts --record`.

This milestone is done when the Deno suite passes; when unit tests prove that a resolution citing an out-of-range observation is dropped, that an analyte absent from the table is dropped, that a ferritin entry is not satisfied by ferritin alone, and that a resolution citing nothing is dropped; and when the corpus still reports zero wrongful resolutions. Expect `conditions_to_resolve` to still score 0%. That is correct — nothing has yet told the model it may resolve anything.

### Milestone 3 — Teach reconciliation the rule

Now make the resolution happen. Two prompt changes in `stages/reconcile.ts`.

Add the instruction, carrying the distinction rather than only the permission, or it will close everything in range. State that a condition whose definition is a specific substance being deficient is resolved when that exact substance is measured in this document and is inside its reference range, and that `supporting_obs_code` must name the observation relied on. Then state the three things that are not that, because they are what it will otherwise do: a condition managed rather than cured, where an in-range result shows control; a condition diagnosed by imaging or histology, which a blood test cannot exclude; and a condition whose defining measurement is not in this document, where silence is not evidence. Keep the existing instruction that absence of a mention is never evidence of resolution — the new rule is an exception carved narrowly into it, not a replacement.

Add one worked example drawn from nothing in the corpus. This matters and is easy to get wrong: an example built from case 001's own conditions would measure the model's memory of its prompt rather than its reading of the document, and the corpus would report a success it had not earned. The corpus holds a biochemistry and lipid panel, a renal ultrasound and a gastrointestinal biopsy, so use none of those. A vitamin D deficiency closed by an in-range 25-OH vitamin D, shown beside a hypothyroidism that is _not_ closed by an in-range TSH because it is treated rather than cured, carries the whole distinction and touches no case.

Re-record, then measure with `--repeat 3`. Do not read a single run. Budget roughly $0.18 per pass and $0.55 for three, and check the key's remaining weekly allowance first.

This milestone is done when case 001 reports `conditions_to_resolve` with one true positive and no false positives across all three passes, and the wrongful-resolution count is zero on every pass. If B12 closes but a second condition closes with it, the instruction is too broad — tighten it before proceeding and record what closed and why under Surprises & Discoveries.

### Milestone 4 — Let a person see the proposal and confirm it

After Milestone 1 a proposed closure is inert, and after Milestone 3 the pipeline produces them. This milestone makes them visible and actionable, which is what turns the safety mechanism from a blocker into a feature.

The data is already in place: `condition_records` carries `is_user_verified`, and `src/types/condition.ts` already exposes it, so this is presentation and one mutation rather than new modelling. Surface, on the condition detail page at `src/app/health/conditions/[id]/page.tsx`, that a document proposes this condition has resolved — showing the document, its date, the `source_anchor`, and the measurement behind it — with a control that sets `is_user_verified` on that condition record and re-runs the status recompute. Give the person the opposite action too: dismissing a proposal must be possible and must be recorded, because Milestone 5 needs rejections as much as confirmations.

Follow the repository's existing conventions for a mutation of this kind rather than inventing one; `src/components/conditions/condition-edit-dialog` and its test are the nearest model for the shape and for how such a component is tested.

This milestone is done when a proposed resolution appears on the condition page, when confirming it changes `current_status` to `resolved`, when dismissing it leaves the condition active and records the dismissal, and when a component test covers all three.

### Milestone 5 — Lock it in

The feature works at this point. This milestone stops it silently rotting and defines how the table grows.

Score the new field. `supporting_obs_code` is written into `ConditionToResolve` and compared against nothing, which is exactly the defect shape the predecessor plan spent a milestone eliminating: a field carried into the fixture and read by no one reads as coverage that does not exist. The harness already has the machinery — `scripts/extraction-eval/fixture-coverage.test.ts` fails the build when an `expected.json` key is neither a scored field nor a declared match key, reading both lists by importing them from `score.ts` so they cannot drift. Add `supporting_obs_code` to `ExpectedResolution` in `scripts/extraction-eval/types.ts`, carry it through `pipeline.ts`, and add it to the scored-field map in `score.ts`. Note that `conditions_to_resolve` currently declares no scored fields and is matched on `condition_id` alone, so this is the first field it scores.

Name the traps. Case 001's `meta.json` describes its four negative cases in prose, which is documentation rather than a test: the case scores a false positive if one of them closes, but nothing says which trap sprang or that these four were the point. Record a decision for each in `judgement_calls`, in the DECIDED form the file already uses, so a future reader confronted with a newly closing condition can tell a regression from a deliberate change.

Define the promotion path, which is the answer to how this table is curated over time. Write down — in the table's own comment, where whoever edits it will read it — that an entry marked uncertain may only ever propose, that promoting it to auto-close requires evidence from confirmations rather than an opinion, and what that evidence is. Pick a threshold and state it plainly, for example that a pair may be promoted once it has been confirmed by users a stated number of times with no dismissals, and that any dismissal returns it to proposal-only and is worth investigating. Add a way to see those counts, even if it is only a documented SQL query in the plan rather than a dashboard; a promotion rule nobody can evaluate is not a rule.

This milestone is done when `npx vitest run --project node scripts/extraction-eval` passes with `supporting_obs_code` scored, when deliberately adding an unread key to a `conditions_to_resolve` entry in any `expected.json` fails the suite naming that key and file, when case 001's `judgement_calls` records a decision for each of the four conditions that must not resolve, and when the promotion rule and the query that evaluates it are written down.

## Concrete Steps

Work the milestones in order. Milestone 1 is independent and should land first regardless of what happens to the rest, because it closes a live hole. Milestone 2 must precede Milestone 3: it is the floor that makes the instruction safe to turn on.

Before starting anything, get a baseline. From the repository root:

    npm ci
    npx tsx scripts/extraction-eval/run.ts

That replays committed cassettes and prints a report; save it. It should report three cases scored, zero failed, no wrongful resolutions, and `conditions_to_resolve` at 0% with one false negative. A cassette miss instead means the committed cassettes are stale and you must re-record before you have a baseline, which needs `OPENROUTER_API_KEY` and costs money.

Run the checks for the surface you touched. Edge-function changes need Deno:

    deno test --allow-env --allow-read --config supabase/functions/deno.json supabase/functions
    deno lint --config supabase/functions/deno.json supabase/functions
    deno check --config supabase/functions/deno.json supabase/functions/*/index.ts

Harness, script and web changes need the Node projects:

    npx vitest run

Everything needs the shared checks:

    npx tsc --noEmit -p tsconfig.json
    npx prettier --check .

After any prompt change, re-record before replaying and review the cassette diff before committing. After a schema change with no prompt change, re-record anyway — the cassette key will not have moved and the corpus will otherwise measure nothing.

Commit at each milestone. Each is independently shippable and independently revertible.

## Validation and Acceptance

Acceptance has two surfaces, and conflating them will mislead you.

The extraction surface is read off the report `just test-extraction` prints. Case 001's `conditions_to_resolve` shows one true positive and no false positives, where it shows one false negative today, and it holds on all three passes of `--live --repeat 3`. The four conditions that must not close still do not, on every pass — check the named identifiers rather than only the count, since the report lists invented resolutions individually and any identifier appearing there is a failure of this plan whatever the aggregate says.

The product surface is read by using the app. A document that proposes a resolution leaves the condition active until someone confirms it; confirming changes the status; dismissing does not. Before Milestone 4 this is verified by the repository tests from Milestone 1 rather than by clicking.

Throughout, the number to read first is the wrongful-resolution count at the top of the report. It is zero today and must be zero at the end. If it rises, stop and investigate before looking at anything else.

## Idempotence and Recovery

Every step here is safe to repeat. The eval can be run any number of times; replay costs nothing and changes nothing on disk except the report under `.artifacts/extraction-eval/`, which is gitignored.

Re-recording cassettes is idempotent in effect but not in content, because the model is not deterministic. If a recording run fails partway, the partial recording is kept rather than pruned; `flush({ prune: true })` is passed only for a case that ran end to end, precisely so a failed run cannot delete a good cassette and leave a corpus that no longer replays. Recover with `--record --case NNN`, which touches only that case.

Milestone 1 changes how a status is computed, not any stored status, so it is reversible by reverting the commit; no data migration is involved and no existing row is rewritten. Note the corollary: conditions already closed by an unverified machine resolution before this lands stay closed. If that matters, finding them is a separate query and a separate decision, and it should be its own piece of work rather than a silent bulk update inside this one.

If a milestone makes the corpus worse, revert that milestone's commit. Each is independent, and the baseline saved in the first concrete step is the evidence of what "worse" means.

## Interfaces and Dependencies

This plan adds no migration. It changes no table definition, no constraint and no column. Milestone 1 changes only the query inside `recomputeConditionCurrentStatus`.

It changes the reconcile stage's JSON schema by adding one property to `conditions_to_resolve` items, expressed as a required nullable because strict mode has no optional keys.

It changes `ConditionToResolve` in `supabase/functions/health-structure/types.ts` and the signature of the gate in `resolution.ts`, which must now receive the extracted observations to verify a citation against them. `processConditionsToResolve` currently takes the record id, the resolutions, the existing conditions and its dependencies; thread the document's extracted observations from `service.ts`, which already holds them.

The reconcile stage must remain blind to the document text — a deliberate design property stated in the comment above `runReconcileStage`. This plan gives it no new access: `supporting_obs_code` is a code drawn from the extracted entities it already receives.

Two request-shape constraints are fixed and must not be reintroduced. `temperature` must not be sent, because reasoning endpoints do not advertise it and `provider.require_parameters` is all-or-nothing, so asking for it leaves the router with no eligible endpoint and every call fails with a bare 404. Every schema's `required` array must be complete. Both have regression tests.

Live runs depend on OpenRouter and on the key's remaining weekly allowance, a separate control from the account balance. The default model is `openai/gpt-5.2:nitro`, overridable with `OPENROUTER_HEALTH_STRUCTURE_MODEL`.

## Artifacts and Notes

The report is written to `.artifacts/extraction-eval/report.md` and `report.json` on every run. The JSON carries per-dimension detail the Markdown summarises, including the identifier of every false positive and false negative, and the report prints per-case and total cost so the price of a measurement is visible rather than estimated.

Case directories are default-deny in `.gitignore`: only `input.md`, `expected.json` and `meta.json` are allowed in, so that image fixtures cannot be committed by accident. A redaction mistake in git history is permanent.

## Revision Notes

- 2026-08-09 — Created, with the mapping keyed on ICD codes and a design that auto-closed conditions behind a curated table.

- 2026-08-09 — Substantially revised after review, and the shape changed rather than the wording. Three things were wrong with the first version. It keyed the mapping on ICD codes, which cannot work: `conditions.code` is nullable and routinely null, ICD-10 is unbounded, and its formatting is inconsistent — the table is now keyed on the thirty-eight-entry observation catalogue instead. It auto-closed conditions, resting all safety on a table that is hard to curate and impossible to keep complete — resolutions now propose and a person confirms, which removes the risk structurally and lets the table start almost empty. And it never asked how the table stays true over time — curation is now bootstrapped from confirmations, with a stated promotion rule. A fourth problem surfaced while checking the first three and became Milestone 1: `recomputeConditionCurrentStatus` ignores `is_user_verified`, so an unconfirmed machine closure is authoritative today, which is a live defect independent of this feature. Milestone count went from three to five.

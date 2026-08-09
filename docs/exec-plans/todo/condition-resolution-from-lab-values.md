# Let a lab result close the condition it defines

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`docs/PLANS.md`](../../PLANS.md) from the repository root.

It follows [`health-extraction-defects-found-by-the-corpus.md`](./health-extraction-defects-found-by-the-corpus.md), whose six milestones are landed and whose final measurement exposed the defect below. That plan is checked in and is incorporated here by reference; you do not need to read it, because every fact this plan relies on is restated here.

## Purpose / Big Picture

A person has "Дефицит витамина B12" — vitamin B12 deficiency — recorded as an active condition on their chart. They have a blood test. The result comes back at 704 pg/mL against a printed reference range of 187–883, which is comfortably normal. The app reads the document, stores the result correctly, and leaves the condition marked active. Nothing closes it, nothing flags it, and nobody is told. The chart still says this person is B12 deficient.

This is not a flaky failure. Three consecutive live runs of the evaluation corpus produced the same answer: `conditions_to_resolve` scored 0%, stable, with one false negative every time. The pipeline is not occasionally missing this — it never does it.

The evidence needed is genuinely in front of the model. The reconciliation stage receives each extracted observation as name, code, value, unit and status, and this document's B12 row arrives with `obs_code: "vitamin_b12"` and `status: "normal"`. It has an active condition whose entire clinical meaning is that this exact analyte is low. It still returns an empty list.

The reason is that nothing ever told it this counts. The stage carries one strong instruction about resolutions — "Only report a resolution when the extracted entities positively support it. Absence of a mention is not evidence of resolution." — and no rule that says an analyte returning to its reference range is positive support for closing a deficiency named after that analyte. Faced with a conservative instruction and no permission, it declines. That is the correct behaviour for the rule it was given.

After this work, a lab value that returns to normal closes the condition defined by that value, and does so only when a deterministic check agrees. The four conditions on the same document that must **not** close still do not close.

You can see it working by running one command, `just test-extraction`, and reading the report.

## Why this is dangerous to get wrong

Closing a condition is a write. `processConditionsToResolve` in `supabase/functions/health-structure/resolution.ts` inserts a condition record with `status_in_record: "resolved"` and then calls `recomputeConditionCurrentStatus`, which changes what the person's chart says about them today. The row is marked `is_llm_extracted: true` and `is_user_verified: false`, so it is attributable, but the status has still changed.

The two mistakes are not symmetric. A missed resolution leaves a stale "active" row that a person or clinician can see and correct. A wrongful resolution silently ends a live entry in a medical record, and nothing afterwards prompts anyone to look at it again. Every design decision below resolves in favour of not closing when unsure, and the corpus report's wrongful-resolution count — printed at the top, currently zero — is the number to watch throughout. If it rises, stop.

## Progress

- [ ] Milestone 1 — Make the claim checkable (`supporting_obs_code`, the deterministic gate, the resolvable-condition table).
- [ ] Milestone 2 — Teach reconciliation the rule (instruction, off-corpus worked example, re-record, measure).
- [ ] Milestone 3 — Lock it in (score the new field, cover the four traps as named regressions).

## Surprises & Discoveries

Record new findings here as work proceeds. The entries below were established by reading the code and by three live runs of the corpus on 2026-08-09.

- Observation: The model has the evidence and declines to use it, so this is a prompt defect rather than a plumbing defect.
  Evidence: `buildExtractedSummary` in `supabase/functions/health-structure/stages/reconcile.ts` passes each observation as `{name, code, value, unit, status}`. The recorded extraction for case 001 emits `{"obs_code": "vitamin_b12", "value_numeric": 704, "ref_range_low": 187, "ref_range_high": 883, "status": "normal"}`. The recorded reconciliation for the same case returns `conditions_to_resolve: []` while correctly completing four checkups, one of which cites the B12 value in its reason text. It read the row and did not act on it.

- Observation: The failure is perfectly stable, which is unusual on this corpus and makes it cheap to verify a fix.
  Evidence: `--live --repeat 3` on 2026-08-09 reported `conditions_to_resolve` f1 at 0.0% with `fn` of 1.0 on every pass, marked `stable`. Most dimensions on this corpus swing between runs; this one does not. A single live run is therefore enough to tell whether the fix fired, though the acceptance below still asks for three because the four negative cases share the run.

- Observation: The obvious rule — "an analyte is normal, so close the condition" — would cause wrongful closures on the very same document.
  Evidence: case 001 carries five active conditions. Every lipid value in the document is inside its reference range, so a naive rule closes `Дислипидемия`. ALT, AST and GGT are all in range, so it also closes `Неалкогольная жировая болезнь печени`, which is diagnosed by imaging and histology and cannot be excluded by enzymes. The corpus requires all four non-B12 conditions to stay open. Any fix that cannot separate these is worse than the current miss.

- Observation: Reconciliation cannot see the canonical value, only the printed one, because it runs before the deterministic half.
  Evidence: the sequence in `stages/index.ts` is classify and extract concurrently, then reconcile; `service.ts` performs code resolution and unit conversion afterwards. So reconcile sees `704` and `пг/мл`, never `519.552 pmol/L`. This does not block the work — the reference range printed on the document is in the same units as the printed value, so in-range is decidable without conversion — but it rules out any design that depends on canonical units at this stage.

## Decision Log

- 2026-08-09 — The discriminator is "the condition is defined by the analyte", not "an analyte relevant to the condition is normal". Reason: this is the distinction case 001 was built around and states in its own `condition_reconciliation_intent` — an in-range value "for the exact analyte that defines the condition". A B12 deficiency _is_ the statement that B12 is low, so a normal B12 ends it. Dyslipidaemia is a chronic metabolic state under management, where an in-range panel is evidence of control; hepatic steatosis is diagnosed by imaging; iron-deficiency anaemia is not measured by this document at all. Only the first is a state whose definition the measurement settles.

- 2026-08-09 — The mapping from condition to defining analyte is an explicit, curated table in code, and conditions absent from it can never be closed by a lab value. Reason: this makes the safe outcome the default. A condition nobody has deliberately classified simply does not qualify, so adding a new condition type to the product cannot silently enable auto-closure of it. The table is small, reviewable in a diff, and each entry is a clinical decision with a name attached.

- 2026-08-09 — The table lives in code rather than in a database catalogue. Reason: it is policy about when the system may write to someone's record, not clinical vocabulary. The three existing catalogues are vocabulary and are world-readable reference data; `finding_type_catalog` is additionally world-writable, which the predecessor plan flagged as a data-isolation problem in its own right. Policy that governs writes should not live in a table any user can extend. A constant in `resolution.ts` is reviewed like code, because it is code.

- 2026-08-09 — The model must cite the observation it is relying on, and the citation is verified deterministically. Reason: this is the same shape that made entity grounding reliable elsewhere in this pipeline — `source_anchor` turned "the model says the document contains this" into a claim that could be checked against the document. `supporting_obs_code` turns "the model says this condition resolved" into a claim that can be checked against the extracted observations. An assertion that cannot be checked is not evidence.

- 2026-08-09 — The deterministic gate is a floor, not the whole discriminator, and this plan says so rather than implying otherwise. Reason: the gate rejects a resolution that cites nothing, cites an analyte absent from this document, or cites one that is out of range. It does **not** by itself distinguish dyslipidaemia from B12 deficiency, because a cited cholesterol value would pass all three of those checks. The curated table is what separates them. Both layers are needed and neither is sufficient; claiming the gate alone makes this safe would be wrong.

## Outcomes & Retrospective

To be completed as milestones land. For each, record what changed, what the corpus reported before and after, and anything that turned out differently from what this plan assumed. Record the wrongful-resolution count every time, including when it stays at zero.

## Context and Orientation

Every path below is relative to the repository root. If you have not worked in this repository before, read this section in full; the milestones assume it.

**The pipeline.** `supabase/functions/health-structure/` is a Supabase Edge Function running on Deno. It receives the OCR text of a medical document — a plain string already stored on the record, so this function never sees an image — and produces structured clinical data. Three model calls run in sequence, called stages, under `supabase/functions/health-structure/stages/`. The `classify` stage decides what kind of document this is and what date it describes. The `extract` stage pulls clinical entities out of the text and receives the code catalogues as vocabulary, but deliberately never receives the patient's history. The `reconcile` stage compares the extracted entities against the patient's existing record and reports which existing findings and conditions the document shows to have resolved, and which due checkups it completes; it receives the extracted entities and the patient record but deliberately never receives the document text. That blindness is a designed property, stated in the comment above `runReconcileStage`, and it must survive this work: reconcile may gain more signals derived from extraction, but never the document itself.

**The deterministic half.** After the stages finish, `service.ts` turns their output into database rows with no model involved, and `resolution.ts` applies resolutions to existing records. `processConditionsToResolve` is the function that writes `status_in_record: "resolved"`. Anything this plan adds by way of verification belongs in this half, because it must be testable without spending a request and must not itself be a thing the model can talk its way past.

**The catalogues.** Three reference tables define vocabulary: `observation_catalog` (38 analytes, including `vitamin_b12`, `vitamin_d_25oh`, `hemoglobin`, `ferritin`, `tsh`, `hba1c`, `glucose`), `finding_type_catalog` and `body_site_catalog`. The eval uses a pinned snapshot at `test/fixtures/extraction/shared/catalogs.json`, regenerated by `scripts/extraction-eval/dump-catalogs.ts`. It is pinned so an unrelated catalogue edit cannot silently move every score.

**The eval harness.** `scripts/extraction-eval/` runs the real pipeline against hand-checked documents and scores the result. `just test-extraction` replays recorded provider responses, called cassettes, so the default run is free, offline and deterministic. `--live` calls OpenRouter and costs money. `--record` implies `--live` and refreshes the cassettes. `--repeat N` runs each case N times and reports mean and spread, and refuses to run without `--live`, because replaying one recording N times reports a spread of zero that reads as stability. The report prints per-case and total cost.

Cassettes are keyed on a digest of the model and the messages only — not the whole request body. This matters concretely for this plan: **changing a JSON schema does not invalidate the cassettes on its own.** If you add a field to the reconcile schema and change no prompt text, the corpus will happily replay old recordings that cannot contain the new field, and will look healthy while measuring nothing. Milestone 1 changes the schema, so it must re-record explicitly rather than trusting invalidation to happen.

Each case is a directory under `test/fixtures/extraction/cases/` holding `input.md` (the OCR text), `expected.json` (the hand-checked correct answer) and `meta.json` (per-case patient state and prose explaining what the case tests). Read `test/fixtures/extraction/README.md` before touching the corpus. Its central rule is that expected files encode the **correct** answer, not the current answer, so a known defect shows as a failing expectation by design — which is exactly what `conditions_to_resolve` is doing today.

**The case this plan is about.** `001-biochem-lipid-ru` is a Russian biochemistry and lipid panel. Its `meta.json` sets up five active conditions and states, in `condition_reconciliation_intent`, that exactly one must resolve and four must not. The one is `00000000-0000-4000-9000-000000000001`, Дефицит витамина B12. The four are iron-deficiency anaemia (no haemoglobin, ferritin or blood count anywhere in this document), non-alcoholic fatty liver disease (normal enzymes do not exclude steatosis, which is an imaging diagnosis), dyslipidaemia (every lipid in range, but that is control rather than cure) and chronic gastritis (nothing in a biochemistry panel bears on it). The case was deliberately built as one positive against four traps, and it is the whole acceptance surface for this plan.

To run anything you need Node dependencies installed (`npm ci`) and, for live runs, `OPENROUTER_API_KEY` in the environment. Deno is needed for the edge-function tests. Note that the OpenRouter key carries a weekly spend limit separate from the account balance; if live calls return HTTP 403 with "Key limit exceeded (weekly limit)", the fix is to raise the key's weekly limit, not to add credit.

## Plan of Work

### Milestone 1 — Make the claim checkable

Nothing in this milestone changes what the model is asked to do. It changes what the system will accept from it, so that when Milestone 2 makes resolutions start happening, there is already a floor underneath them. At the end of this milestone a resolution that cites no supporting measurement, or cites one this document does not contain, or cites one that is out of range, is discarded before it can reach the database — and the discard is reported rather than silent.

Add a `supporting_obs_code` property to the `conditions_to_resolve` item schema in `RECONCILE_SCHEMA` in `stages/reconcile.ts`. It is the catalogue code of the observation whose value establishes the resolution, or null when the resolution rests on something other than a measurement. Remember that strict `json_schema` mode requires the `required` array to name every key in `properties`; an optional field is therefore expressed as a required nullable. There is a test named `every stage schema satisfies strict json_schema mode` that walks all three schemas and enforces this, so a forgotten entry fails before the provider ever sees the request.

Carry the field through the reconcile stage's normaliser into `ConditionToResolve` in `supabase/functions/health-structure/types.ts`, so it survives to the deterministic half.

Add the curated table. In `resolution.ts`, define a constant mapping an ICD code to the set of observation codes whose normal value settles that condition. Start it small and deliberate:

    E53.8  (other specified vitamin deficiency)  -> vitamin_b12
    E55.9  (vitamin D deficiency)                -> vitamin_d_25oh
    E61.1  (iron deficiency)                     -> ferritin, serum_iron
    D50.9  (iron deficiency anaemia)             -> hemoglobin AND ferritin
    E03.9  (hypothyroidism, unspecified)         -> tsh

Write the table so that a condition absent from it can never be resolved by a lab value at all. Deliberately absent, and worth a comment saying so and why: `E78.5` dyslipidaemia, because an in-range panel under management is control rather than resolution; `K76.0` non-alcoholic fatty liver disease, because it is an imaging and histology diagnosis that normal enzymes do not exclude; and `K29.5` chronic gastritis, because it is an endoscopic diagnosis. These three are not oversights and the comment must say they are not, or someone will helpfully add them.

Note the `D50.9` entry requires **both** analytes, not either. Anaemia is defined by the haemoglobin, and the iron studies are what make it the iron-deficiency kind; a normal ferritin alone does not establish that the anaemia has resolved. Model the table so an entry can demand all of its codes rather than any, because this distinction is the difference between a correct closure and a wrongful one.

Then add the gate. Before `processConditionsToResolve` writes anything, a resolution must satisfy all of the following, evaluated against the observations extracted from _this_ document:

1. The condition's ICD code appears in the table.
2. Every observation code the table demands for that condition is present among this document's extracted observations.
3. Each of those observations is in range. Decide this numerically from `value_numeric` against `ref_range_low` and `ref_range_high` when the document printed a range, since that is deterministic; fall back to the extracted `status` field only when no range was printed, and treat a missing or unparseable value as not in range rather than as passing.
4. If `supporting_obs_code` is non-null, it is one of the codes the table demands. A citation naming something else is a sign the model reasoned from the wrong measurement, and the resolution is discarded.

A resolution failing any of these is dropped and reported, not written. Report it the way the stages already report discarded entities, as a `StageRejection` with a fixed reason string naming the check that failed — never the entity's content, since these strings reach logs. Reasons should distinguish the cases, for example `condition not resolvable from a lab value`, `supporting observation absent from this document`, and `supporting observation is not in range`.

Because this milestone changes the reconcile schema and cassettes are keyed on model and messages only, the corpus will replay stale recordings that have no `supporting_obs_code`. Re-record deliberately at the end of this milestone: `OPENROUTER_API_KEY=... npx tsx scripts/extraction-eval/run.ts --record`.

This milestone is done when the Deno suite passes, when a unit test proves a resolution citing an out-of-range observation is dropped with the expected reason, when a unit test proves a resolution for an ICD code absent from the table is dropped, when a unit test proves `D50.9` is not resolved by a normal ferritin alone, and when the corpus still reports zero wrongful resolutions. Expect `conditions_to_resolve` to still score 0% at the end of this milestone. That is correct: nothing has yet told the model it may resolve anything.

### Milestone 2 — Teach reconciliation the rule

Now make the resolution actually happen. Two changes in `stages/reconcile.ts`, both to the prompt.

Add the instruction. It has to carry the distinction in the Decision Log, not merely the permission, or it will close everything in range. State that a condition whose definition is a specific substance being deficient or excessive is resolved when that exact substance is measured in this document and is inside its reference range, and that `supporting_obs_code` must name the observation relied on. Then state the three things that are not that, because they are what the model will otherwise do: a condition managed rather than cured, where an in-range result shows control and not resolution; a condition diagnosed by imaging or histology, which a blood test cannot exclude; and a condition whose defining measurement does not appear in this document at all, where silence is not evidence. Keep the existing instruction that absence of a mention is never evidence of resolution — this new rule is an exception carved narrowly into it, not a replacement for it.

Add one worked example, and draw it from nothing in the corpus. This matters and it is easy to get wrong: an example built from case 001's own conditions would measure the model's memory of its own prompt rather than its reading of the document, and the corpus would report a success it had not earned. The corpus holds a biochemistry and lipid panel, a renal ultrasound and a gastrointestinal biopsy, so use none of those. A vitamin D deficiency closed by an in-range 25-OH vitamin D, shown alongside a hypothyroidism that is _not_ closed by an in-range TSH because it is treated rather than cured, carries the whole distinction in one example and touches no corpus case.

Re-record, then measure with `--repeat 3`. Do not read a single run: this corpus has produced materially different answers to the same document, which is why the repeat flag exists. Budget roughly $0.18 per pass and $0.55 for a repeat of three, and check the key's remaining weekly allowance before starting.

This milestone is done when case 001 reports `conditions_to_resolve` with one true positive and no false positives, when that holds across all three passes, and when the wrongful-resolution count is still zero on every pass. If B12 closes but a second condition closes with it, the instruction is too broad — tighten it before proceeding, and record what closed and why in Surprises & Discoveries.

### Milestone 3 — Lock it in

The fix works at this point. This milestone stops it silently rotting.

Score the new field. `supporting_obs_code` is currently written into `ConditionToResolve` and compared against nothing, which is precisely the shape of defect the predecessor plan spent a milestone eliminating: a field carried into the fixture and read by no one reads as coverage that does not exist. The harness already has the machinery — `scripts/extraction-eval/fixture-coverage.test.ts` fails the build when an `expected.json` key is neither a scored field nor a declared match key, and it reads those lists by importing them from `score.ts` so they cannot drift. Add `supporting_obs_code` to `ExpectedResolution` in `scripts/extraction-eval/types.ts`, carry it through `pipeline.ts`, and add it to the scored-field map in `score.ts`. Note that `conditions_to_resolve` currently declares no scored fields at all and is matched on `condition_id` alone, so this is the first field it scores; the coverage test will tell you if you have wired it inconsistently.

Make the four traps explicit. Case 001's `meta.json` names them in prose today, which is documentation rather than a test — the case scores a false positive if one of them closes, but nothing says _which_ trap sprang or that these four in particular were the point. Add the reasoning to the case's `judgement_calls` in the same DECIDED form the file already uses for its other two entries, so a future reader confronted with a newly closing condition can tell a regression from a deliberate change. If a trap is worth stronger coverage than prose, the cheapest real improvement is a second Russian lab case built the same way — one positive against traps drawn from different condition categories — but that is corpus authorship and should be its own piece of work rather than being smuggled in here.

This milestone is done when `npx vitest run --project node scripts/extraction-eval` passes with `supporting_obs_code` scored, when deliberately adding an unread key to a `conditions_to_resolve` entry in any `expected.json` fails the suite naming that key and file, and when case 001's `judgement_calls` records a decision for each of the four conditions that must not resolve.

## Concrete Steps

Work the milestones in order. Milestone 1 must precede Milestone 2: it is the floor that makes Milestone 2 safe to turn on, and turning the instruction on first would mean measuring resolutions that nothing verifies.

Before starting anything, get a baseline to compare against. From the repository root:

    npm ci
    npx tsx scripts/extraction-eval/run.ts

That replays the committed cassettes and prints a report; save it. It should report three cases scored, zero failed, no wrongful resolutions, and `conditions_to_resolve` at 0% with one false negative. If it reports a cassette miss instead, the committed cassettes are stale relative to the current prompts and you must re-record before you have a baseline, which needs `OPENROUTER_API_KEY` and costs money.

For each milestone, make the change, then run the checks for the surface you touched. Edge-function changes need Deno:

    deno test --allow-env --allow-read --config supabase/functions/deno.json supabase/functions
    deno lint --config supabase/functions/deno.json supabase/functions
    deno check --config supabase/functions/deno.json supabase/functions/*/index.ts

Harness and script changes need the Node test project:

    npx vitest run --project node

Everything needs the shared checks:

    npx tsc --noEmit -p tsconfig.json
    npx prettier --check .

After any change to a prompt, re-record before replaying, and review the cassette diff before committing it. After a schema change with no prompt change, re-record anyway — the cassette key will not have moved and the corpus will otherwise measure nothing.

Commit at each milestone rather than at the end. Each is independently shippable and independently revertible.

## Validation and Acceptance

Acceptance is behavioural and is read off the report `just test-extraction` prints.

The headline is one line. Case 001's `conditions_to_resolve` shows one true positive and no false positives, where it shows one false negative today, and it holds on all three passes of `--live --repeat 3`.

Underneath it, the four conditions that must not close still do not close, on every pass. The report names invented condition resolutions individually, so check the names rather than only the count: seeing `conditions_to_resolve fp 0.0 stable` across three runs is the acceptance, and any named identifier appearing there is a failure of this plan regardless of what the aggregate f1 says.

Throughout, the number to read first is the wrongful-resolution count at the top of the report. It is zero today and must be zero at the end. A missed resolution leaves a stale row a person can correct; a wrongful one silently closes a live condition in someone's medical record. If that number rises, stop and investigate before looking at anything else.

For Milestone 1 specifically, the acceptance is that the gate rejects rather than that anything resolves. Construct the three rejection cases as unit tests against `resolution.ts` — an out-of-range supporting observation, an ICD code absent from the table, and a `D50.9` with only one of its two required analytes — and assert both that nothing is written and that the rejection reason names the failing check.

## Idempotence and Recovery

Every step here is safe to repeat. The eval can be run any number of times; replay costs nothing and changes nothing on disk except the report under `.artifacts/extraction-eval/`, which is gitignored.

Re-recording cassettes is idempotent in effect but not in content, because the model is not deterministic — recording twice gives two different valid recordings. If a recording run fails partway, the partial recording is kept rather than pruned; `flush({ prune: true })` is passed only for a case that ran end to end, precisely so a failed run cannot delete a good cassette and leave a corpus that no longer replays. If you find yourself with a corpus that will not replay, re-record the affected case with `--record --case NNN`, which touches only that case.

If a milestone makes the corpus worse, revert that milestone's commit. Each is independent, and the baseline report saved in the first concrete step is the evidence of what "worse" means.

## Interfaces and Dependencies

This plan changes no database schema and adds no migration.

It changes the reconcile stage's JSON schema by adding one property to `conditions_to_resolve` items. Strict `json_schema` mode requires `required` to name every key in `properties`, so express the optional field as a required nullable; the existing schema test enforces this.

It changes `ConditionToResolve` in `supabase/functions/health-structure/types.ts` and the signature of the gate in `resolution.ts`, which must now receive the extracted observations in order to verify a citation against them. `processConditionsToResolve` currently takes the record id, the resolutions, the existing conditions and its dependencies; it will need the document's extracted observations as well. Thread them from `service.ts`, which already holds them.

The reconcile stage must remain blind to the document text. That is a deliberate design property, not an oversight, and the comment above `runReconcileStage` says so. This plan gives it no new access to the document: `supporting_obs_code` is a code drawn from the extracted entities it already receives.

Two request-shape constraints are already fixed and must not be reintroduced. `temperature` must not be sent, because reasoning endpoints do not advertise it and `provider.require_parameters` is all-or-nothing, so asking for it leaves the router with no eligible endpoint and every call fails with a bare 404. Every schema's `required` array must be complete, as above. Both have regression tests.

Live runs depend on OpenRouter and on the key's remaining weekly allowance, which is a separate control from the account balance. The default model is `openai/gpt-5.2:nitro`, overridable with `OPENROUTER_HEALTH_STRUCTURE_MODEL`.

## Artifacts and Notes

The report is written to `.artifacts/extraction-eval/report.md` and `report.json` on every run. The JSON carries per-dimension detail the Markdown summarises, including the identifier of every false positive and false negative; when a table is hard to interpret, read the JSON. The report also prints per-case and total cost, so the price of a measurement is visible rather than estimated.

Case directories are default-deny in `.gitignore`: only `input.md`, `expected.json` and `meta.json` are allowed in. This is deliberate, so that image fixtures cannot be committed by accident — a redaction mistake in git history is permanent.

## Revision Notes

- 2026-08-09 — Created. Written after the six milestones of the predecessor plan landed and its final `--live --repeat 3` measurement showed `conditions_to_resolve` stable at 0% with one false negative on every pass. The defect was visible in that plan's own output but outside its scope, and is recorded there in the Milestone 5 outcome as a follow-up.

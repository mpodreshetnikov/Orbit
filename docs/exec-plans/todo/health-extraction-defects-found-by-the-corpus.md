# Fix the extraction defects the scored corpus found

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`docs/PLANS.md`](../../PLANS.md) from the repository root.

It is the successor to [`health-image-recognition-pipeline-hardening.md`](./health-image-recognition-pipeline-hardening.md), whose Milestone 8 built the scored regression corpus that found everything below. That plan is checked in and is incorporated here by reference; you do not need to read it to execute this one, because every fact this plan relies on is restated here.

## Purpose / Big Picture

A user photographs a lab printout or a pathology report. The app reads it, extracts the clinical facts, and writes them into that person's medical history. Today, on documents written in Russian, several of those facts arrive wrong in ways nobody sees.

The clearest one: a vitamin B12 result printed as `704 пг/мл` is stored as the number `704` labelled `pmol/L`. The correct stored value is `519.552 pmol/L`. Nothing failed, nothing was logged, and the review screen shows a normal-looking row. The number is 35% too high and is wearing a unit it was never converted into, and the same relabelling is applied to both ends of the reference range — so the value is wrong _and_ the range it is judged against is wrong.

A second one: a lipid panel line reading `Холестерин ЛПОНП` (VLDL cholesterol) is filed under `cholesterol_total`. That is not a missing value; it is one analyte's number written into a different analyte's history, and it is marked applied so the chart picks it up.

A third: a renal ultrasound sentence reading `ЛС не расширена` — "the pyelocaliceal system is **not** dilated" — was extracted as a positive finding on the patient's record. A statement that nothing is wrong became a record that something is.

After this work, a Russian-language document produces correctly converted values under the correct analytes, negated statements do not become findings, and an explicit "no stones present" can actually close a previously recorded stone instead of vanishing before the stage that would act on it. Equally important, the regression corpus that found these becomes able to detect its own blind spots, so the next class of defect is caught by the harness rather than by a reviewer noticing.

You can see all of it working by running one command, `just test-extraction`, and reading the report it prints.

## Progress

- [x] Milestone 1 — Transport limits that match real documents (`max_tokens`, per-stage timeout).
- [x] Milestone 2 — Make the harness able to audit itself (score `count`, fail on inert expected fields, support repeat runs).
- [x] Milestone 3 — Deterministic resolution writes the right row (unit normalisation, discriminating-token penalty, catalogue synonyms).
- [x] Milestone 4 — The extraction output contract (qualitative results, severity grading, condition naming).
- [x] Milestone 5 — Asserted absence: stop inventing it, start using it.
- [x] Milestone 6 — Corpus governance and the fixture-blind CI flag.

## Surprises & Discoveries

Record new findings here as work proceeds. The entries below are what the corpus found before this plan was written; each was confirmed by a live model run unless stated otherwise.

- Observation: Unit conversion never fires on a Russian document, and the failure is silent and directional.
  Evidence: `supabase/functions/health-structure/unit-conversion.ts:32-40` defines `getUnitConfig`, which reads `catalogEntry.accepted_units?.[unit]` — an exact string lookup. The `unit` it looks up is whatever the model put in `unit_text`, and `supabase/functions/health-structure/stages/extract.ts` instructs the model to record units "exactly as printed, in the document's own language". Every `accepted_units` key in the catalogue is Latin (`mg/dL`, `pg/mL`, `g/dL`, `ug/dL`, `ng/mL`, `mmol/mol`). A Russian report writes `пг/мл`, `ммоль/л`, `г/л`. The lookup misses, `convertValueWithConfig` returns the value unchanged (`unit-conversion.ts:47`), and `convertToCanonical` stamps the catalogue's canonical unit anyway (`:79`). For most analytes this is harmless arithmetic because `ммоль/л` and `mmol/L` are the same unit. For vitamin B12 it is not: the factor is 0.738 and the stored result is 35% high.

- Observation: Every non-trivial conversion in the catalogue is keyed on a US unit, so no Russian document can ever exercise one.
  Evidence: seventeen entries in `test/fixtures/extraction/shared/catalogs.json` carry a `factor_to_canonical` other than 1, and every one is keyed `mg/dL`, `g/dL`, `ug/dL`, `pg/mL` or `ng/mL`. The single formula conversion (`hba1c`, `mmol/mol` to `%`) is likewise US-keyed. `evaluateFormula` in `unit-conversion.ts` has never executed against a corpus case.

- Observation: The fuzzy code matcher rewards a shared prefix and ignores the token that distinguishes the analytes.
  Evidence: `supabase/functions/health-structure/code-resolution.ts:56-68` scores candidates with a Dice coefficient over character trigrams, and `:117` accepts the best candidate at or above `FUZZY_THRESHOLD = 0.62`. `Холестерин ЛПОНП` shares the long `холестерин` prefix with the `cholesterol_total` entry, which is enough to clear the threshold; the `ЛПОНП` token, which is the entire meaning of the line, contributes only a few trigrams and is never required to match anything.

- Observation: The same matcher cannot bridge a link that is semantic rather than lexical.
  Evidence: `Хронический активный гастрит` did not resolve to the `inflammation` catalogue entry, whose `name_ru` is `Воспаление`. The two strings share almost no trigrams, so no threshold setting reaches this. The catalogue entry has no `synonyms_ru`.

- Observation: The model emits things the extraction prompt never constrained, and each one becomes a row in someone's chart.
  Evidence: three separate live runs. `ЛС не расширена` became a finding (negation read as assertion). `Helicobacter pylori (+)` became a finding sited to `stomach` — a qualitative microbiology result turned into a structural finding, and because it occupied the stomach slot it displaced the real gastritis finding. Both `низкой степени (слабая дисплазия)` and `умеренной степени активности` produced `severity: "unknown"`, though the enum holds `mild` and `moderate`. Three conclusion sentences were returned verbatim as condition `name` values, for example `Тубулярная аденома восходящей ободочной толстой кишки с дисплазией эпителия низкой степени`.

- Observation: An explicit statement of absence cannot reach the stage that would act on it. This is structural, not a model failure.
  Evidence: the extraction stage emits entities that are **present**; a sentence like `Конкременты: нет` correctly produces no entity. The reconcile stage is then handed `buildExtractedSummary()` plus the patient record and, deliberately, not the document text (`supabase/functions/health-structure/stages/reconcile.ts`, `buildExtractedSummary` and the comment above `runReconcileStage`). So absence is filtered out one stage before the stage that would use it — and absence is the only kind of evidence that resolves a structural finding. The `findings_to_resolve` feature therefore cannot fire on the evidence it exists for.

- Observation: The stage client reserves the model's entire output budget on every call, so a low-credit account fails outright.
  Evidence: `supabase/functions/health-structure/stages/client.ts` sends no `max_tokens`. OpenRouter reserves the model's maximum output — 65,536 tokens for `openai/gpt-5.2` — against the account before dispatching. With credit remaining below that reservation every call returns HTTP 402 with the message "This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford …", while a small request on the same key still returns 200. Observed completions on real corpus documents peak around 4,000 tokens.

- Observation: The 60-second timeout is marginal for a real multi-section document.
  Evidence: `stages/client.ts` sets `DEFAULT_TIMEOUT_MS = 60_000`. The three-specimen histology case timed out on its first attempt and completed in 44 seconds on the second. The eval runs with `maxAttempts: 1` deliberately, so it reports the timeout rather than hiding it; production uses the same 60 seconds at the same high reasoning effort and would fail a longer report outright.

- Observation: The harness has now shipped the same class of bug three times, and caught it zero times.
  Evidence: `findings_to_resolve` was produced by reconcile, normalised in `scripts/extraction-eval/pipeline.ts`, written into every `expected.json` — and typed `unknown[]` and scored by nothing. Then every finding field (`site_code`, `laterality`, `size_mm`, `body_site_text`, `severity`) was carried into the fixture and compared against nothing. Then every condition field (`icd_code`, `status`) likewise. All three were found by an external reviewer. Nothing in the harness can tell you that a key in `expected.json` is read by no one, which is why the class keeps recurring.

- Observation: Single runs of this corpus are being over-read, because run-to-run variance is larger than most differences being discussed.
  Evidence: five live runs of the renal ultrasound case disagreed on observations (0, 3, 3, 2, 3), findings (3, 3, 3, 4, 2), conditions (1, 2, 2, 0, 2) and anchor rejections (0, 0, 0, 3, 2). Only one dimension was stable across all five. The harness has no way to run a case more than once, so there is no way to distinguish a real improvement from a resample.

- Observation: A change that touches only the corpus sets every CI impact flag to false.
  Evidence: `scripts/just/change-impact.cjs:28-57` computes `dbImpact`, `webImpact`, `extensionImpact`, `functionsImpact` and `docsOnly` from path prefixes. `test/fixtures/` matches none of them, and `isDocFile` does not classify it as a doc either, so a fixture-only change reports no impact at all. Any future gate hung on those flags would skip exactly the pull requests that edit the corpus.

- Observation: The catalogue's one formula conversion cannot be evaluated, and unit folding makes it reachable.
  Evidence: `hba1c` carries `formula_to_canonical` of `"percent = (mmol_per_mol * 0.09148) + 2.152"`, which describes the conversion rather than expressing it. `isSafeFormula` in `unit-conversion.ts` accepts only digits, `x` and arithmetic operators — correctly, since it evaluates the string — so `evaluateFormula` returned null on it every time. It had never fired, because the key is `mmol/mol` and no Russian document ever matched a Latin key. Folding `ммоль/моль` onto that key makes it reachable, and a null there stores no value at all — strictly worse than the unconverted number it would replace. Fixed on both sides: the migration rewrites it as `(x * 0.09148) + 2.152`, and `convertValueWithConfig` now falls back to the unconverted value rather than null, so the code no longer depends on the data being right.

- Observation: A qualifier means the opposite thing in the observation catalogue and the finding catalogue, and one shared matcher cannot treat them alike.
  Evidence: for an analyte, an unexplained qualifier changes identity — `Холестерин ЛПОНП` is not `Холестерин общий`, and `Билирубин прямой` and `Билирубин непрямой` are both distinct analytes from `Билирубин общий`, all three of which the corpus requires to stay uncoded. For a finding, a qualifier describes the same morphology — a `Хронический активный гастрит` is a gastritis is an inflammation, and `хронический` and `активный` say how long and how much, not what. A rule strict enough to keep `Билирубин прямой` uncoded also refuses `Хронический активный гастрит`. `resolveWithViews` therefore takes an explicit flag, set true for observations and false for finding types and body sites, rather than pretending one behaviour fits both.

- Observation: A catalogue synonym edit does not invalidate the cassettes, contrary to what this plan assumed.
  Evidence: `stages/extract.ts` builds its vocabulary from `code`, `ru` and `en` only — synonyms and `accepted_units` never reach the prompt, because they are used by the deterministic resolver downstream rather than by the model. A synonyms-only or units-only catalogue change therefore leaves the request messages byte-identical, and `cassetteKey` (which digests model and messages) does not move. Confirmed by replaying the corpus after regenerating the snapshot: three cases scored, zero cassette misses. Adding or renaming a catalogue _entry_ would still invalidate them.

## Decision Log

Record every decision that changes this plan, with the reason, so a reader restarting from only this file understands why the shape is what it is.

- 2026-08-07 — These fifteen defects are handed off as one plan with six milestones rather than six separate plans. Reason: they share one verification surface (`just test-extraction` and the corpus under `test/fixtures/extraction/`), one orientation, and one set of file references. Six self-contained plans would duplicate all of that. This matches the shape of the predecessor plan, which carried twenty-two defects across nine milestones.

- 2026-08-07 — The harness milestone is sequenced before the two model-behaviour milestones. Reason: run-to-run variance on this corpus is larger than the effect size of a prompt change, so without repeat-run support a prompt fix cannot be told apart from a resample. Fixing the measuring instrument first is not optional here.

- 2026-08-07 — Unit normalisation is chosen over adding Cyrillic keys to `accepted_units`. Reason: normalisation is one function in one file and it covers every catalogue entry including ones added later; Cyrillic keys would need adding to all thirty-eight observation entries and would need adding again to each new entry, with no failure signal when someone forgets.

- 2026-08-07 — Three items from the original list are deliberately **not** in this plan, and are recorded here so a reader does not assume they were forgotten. First, `finding_type_catalog` is global and world-writable (no `person_id`, and both the read and write RLS policies are unconditional), so one user's custom finding type enters every other user's extraction vocabulary; that is a data-isolation change with its own migration and belongs in its own plan. Second, the finding match key in the eval scorer degenerates for gastrointestinal documents, where there is no laterality; it is detected and reported today, which is honest, and changing the key is a scorer design decision rather than a defect fix. Third, a US-units English lab case is needed before any unit conversion factor can be exercised end to end; that is corpus authorship, not a fix.

## Outcomes & Retrospective

To be completed as milestones land. For each, record what was fixed, what the corpus score was before and after, and anything that turned out differently from what this plan assumed.

### Milestone 1 — landed 2026-08-07

Fixed: `stages/client.ts` now sends `max_tokens` (default 16,000, overridable per call via the new
`StageContext.maxTokens`) and `DEFAULT_TIMEOUT_MS` is 120,000 rather than 60,000. Two Deno tests
cover the default and the override; the request-shape test that guards `temperature`'s absence was
left alone and a separate one added beside it.

Corpus score: unchanged, as expected — this milestone touches transport only, not any answer.
A live run of all three cases completed with `3 scored, 0 failed` and no timeout, which is the
acceptance criterion. Replay before and after is byte-identical.

Turned out differently: **this milestone does not invalidate the cassettes.** The plan assumed it
would, because `cassetteKey`'s doc comment says it keys on "the full request body". It does not —
it keys on `{ model, messages }` only (`scripts/extraction-eval/cassette.ts`). No re-record was
needed. The comment has been corrected in place rather than the keying changed: excluding transport
knobs from the key is the right behaviour, since they do not change the answer and keying on them
would churn every recording whenever one was retuned.

That correction exposed a sharper point worth carrying into Milestone 5: `response_format` — which
carries each stage's JSON schema — is also outside the key. A schema change that leaves the prompt
text untouched will replay stale cassettes that cannot contain the new field, and the corpus will
look healthy while measuring nothing. Milestone 5 adds `asserted_absences` to the extract schema and
must re-record explicitly rather than trusting invalidation to happen on its own.

### Milestone 2 — landed 2026-08-07

Fixed all three items.

`count` is now carried through `pipeline.ts`, declared on `ExpectedFinding`, and scored in
`FINDING_FIELDS`. Case 002's two findings gained `count: 1`, as the plan required.

`scripts/extraction-eval/fixture-coverage.test.ts` now fails the build when a fixture carries a key
nothing reads. It imports the field arrays and a new `MATCH_KEYS` map from `score.ts` rather than
restating them, so it cannot drift from the scorer. A third assertion covers the case that produced
all three past regressions: a new array added to `CaseSnapshot` and to the fixtures must be declared
in both maps or the suite fails. Verified by adding `"morphology": "tubular"` to case 002 — the
suite failed naming `002-kidney-ultrasound-ru/expected.json -> findings[].morphology` — and passing
again on removal.

Worth recording: the coverage test found a live instance the moment it was written. Case 003 already
carried `count: 1` on all three findings, inert, exactly the class the test exists to catch. It was
scored in the same milestone rather than deleted, so the test's first find is also its first fix.

`--repeat N` is in `run.ts`, with a `renderVariance` section in `report.ts` reporting mean, range and
every individual run per dimension. It refuses a replay run and refuses `--record`, each with a
message saying why: replaying N times reports a spread of zero that reads as stability, and
recording keeps one answer per request so the cassettes would describe the last run while the report
describes all of them. Failures are now counted across every pass rather than the rendered one, since
a case that dies on run 2 of 3 is precisely what repeat runs exist to surface.

Corpus score: unchanged except that `count` now appears in the finding-field table at 5/5.

The live `--repeat 3 --case 002` run confirms the premise of the whole sequencing decision. Findings
f1 came out 80.0%, 100.0%, 50.0% on three runs of the same document — a 50-point swing with nothing
changed between them. Observations fp ran 2, 2, 4; checkups f1 ran 0%, 100%, 100%. Any single-run
reading of a Milestone 4 or 5 prompt change would have been noise. Nine dimensions did read `stable`,
which is itself useful: those can be compared across single runs.

### Milestone 3 — landed 2026-08-07

Corpus effect, replay, aggregate observation fields: `obs_code` 13/14 -> 14/14, `is_applied`
13/14 -> 14/14, `value_canonical` 13/14 -> 14/14, `unit_canonical` 12/14 -> 13/14. `Витамин В12`
now stores `519.552 pmol/L` rather than `704`, and `Холестерин ЛПОНП` is uncoded and unapplied
rather than filed under `cholesterol_total`. Wrongful resolutions unchanged at the replayed value.

Unit folding landed as planned, plus case and whitespace insensitivity, plus a fold of the Cyrillic
letters that are visually identical to Latin ones. The lookup stays exact after folding.

The token-matching work did **not** land as the plan described it, and the plan's version would have
been a regression. The plan proposed rejecting any candidate that cannot explain a query word of
three characters or more. Measured against the real catalogue, that rule broke three labels that
resolve correctly today — `Витамин В12`, `Железо сыворотки` — and left `Холестерин ЛПВП` and
`Холестерин ЛПНП` unresolved, which the corpus requires to resolve to `hdl_c` and `ldl_c`. Only
`ЛПОНП` is meant to stay uncoded. What shipped instead is a discriminating-token tier between
whole-string synonym matching and fuzzy scoring: when exactly one catalogue entry answers to a word
of the label, that entry wins. `лпвп` is a synonym of `hdl_c`, so the line resolves for the right
reason rather than by out-scoring `холестерин`; `лпонп` belongs to nobody, so nothing resolves.

Two smaller findings came out of building it, both recorded under Surprises.

Migration `20260807120000_inflammation_synonyms_and_hba1c_formula.sql` adds the `-ит` synonyms and
fixes the `hba1c` formula. It sets both columns rather than appending, so it is re-runnable. It has
**not** been applied to any database — this environment has no Supabase credentials, and applying a
migration to the live project is not this plan's call. The pinned corpus snapshot was updated by hand
to exactly the values the migration produces, verified field by field against the previous snapshot:
two semantic changes, nothing else.

The `inflammation` half of this milestone is correct but its corpus expectation still fails, for a
reason that belongs to Milestone 4. `Хронический активный гастрит` now resolves to `inflammation` in
isolation, but the model never emits that finding: it emits `Helicobacter pylori (+)` into the
stomach slot and displaces it. Case 003's `inflammation` finding-code expectation will pass when
Milestone 4 stops a qualitative result becoming a finding, not before.

### Milestone 4 — landed 2026-08-07

All three acceptance criteria met, measured on re-recorded cassettes.

`Helicobacter pylori (+)` no longer appears among case 003's invented findings. Severity field
accuracy went 3/5 to 5/5 aggregate — the plan asked for one-of-three to three-of-three on case 003
and got it. Condition names are now diagnoses rather than conclusion sentences: the false positives
read `Тубулярная аденома` and `Гиперпластический полип` instead of the full sentences, and
`Хронический активный гастрит` turned from a false negative into a true positive, taking case 003's
conditions f1 from 33.3% to 66.7%.

`finding_code` went 4/5 to 5/5, which is Milestone 3's `inflammation` synonym finally paying off.
It could not before: the model was filing `Helicobacter pylori (+)` into the stomach slot and
displacing the gastritis finding, so there was nothing there for the synonym to resolve. The two
milestones had to land together for either to show.

Worked examples deliberately avoid corpus content, per the plan's own rule — the new one is a
thyroid report, where the corpus holds a lipid panel, a renal ultrasound and a GI biopsy. A first
draft of this milestone used `Helicobacter pylori (+)` and case 003's adenoma sentence verbatim in
the instructions, which would have measured the model's memory of its prompt rather than its reading
of the document. Caught before recording.

Not attributable to this milestone, and recorded so a later reader does not go looking: case 002's
`body_site_text` (4/5 to 2/5) and `size_mm` (5/5 to 3/5) moved on the re-record. Both are resample
noise on a document whose findings dimension the repeat runs already showed swinging between 80% and
100% f1; nothing in this milestone touches anatomy or measurement. The `--repeat 3` run also had case
003 fail once with `OpenRouter returned invalid JSON content` — the eval runs `maxAttempts: 1`
deliberately, so a transient is reported rather than retried into a different sampled answer.

A regression this milestone caused and fixed: the prompt change flipped the model from supplying
`obs_code: "ggt"` to supplying null for the same row, and `Гамма-глутамилтранспептидаза` then failed
to resolve, because the catalogue lists every abbreviation for that enzyme and not the expanded name
a lab prints. The deterministic resolver exists so the pipeline does not depend on the model
supplying codes, and it cannot do that job with a vocabulary missing the printed form. The full
names are now in the migration alongside the `inflammation` ones.

### Milestone 5 — landed 2026-08-07

Both halves landed and both acceptance criteria are met. `findings_to_resolve` went from one false
negative to one true positive, zero false positives — 100% on the dimension that had been
structurally incapable of firing — and the wrongful-resolution banner still reports none. Case 002
no longer emits `ЛС не расширена` as a finding, and its findings dimension reached 100% on the
recording where its observations also did.

Case 003 is the regression guard and it holds: `без признаков дисплазии`, `кишечная метаплазия не
выявлена` and `атрофия не выявлена` now arrive as asserted absences rather than as findings, while
the present dysplasia, polyp and inflammation are all still reported.

The negation guard needed adjacency, not presence. The plan says "adjacent to the finding term" and
that turns out to be load-bearing rather than a detail: case 002's legitimate `гиперсигналы` finding
is anchored on `с обеих сторон единичные гиперсигналы 0,2 см, без эхотени`, where `без` negates the
acoustic shadow and not the hypersignals. A rule rejecting any anchor containing a negation would
have deleted a finding the corpus requires. The guard locates the finding term in the anchor and
looks two words either side of it, which covers `не расширена`, `метаплазия не выявлена` and
`без признаков дисплазии` alike. The same check runs in reverse on `asserted_absences`: an
"absence" whose own evidence denies nothing is a presence in the wrong array, and admitting it would
hand reconciliation grounds to close a finding the document reported as still there.

One thing the plan did not anticipate. The first recording emitted the absence correctly —
`{finding_code: "stone", site_code: "kidney", anchor: "Конкременты: нет"}` — and reconciliation
still declined, because the existing finding is on `kidney_right` and the instruction told it to
match sites strictly. That was too absolute: `Конкременты: нет` on a bilateral study means no stone
in either kidney, so an absence asserted for a whole organ has to cover its parts. The instruction
now says so, and says the reverse does not hold — an absence in one part is not evidence about
another, and an absence in a different organ is not evidence at all. That asymmetry is what keeps
the wrongful-resolution count at zero.

**Measurement is incomplete, and this is the one place a reader should not trust a single number.**
The `--repeat 3` run the plan calls for did not finish: the OpenRouter key hit its weekly spend
limit partway through and returned `403 Key limit exceeded (weekly limit)` for the remaining runs.
One full pass and parts of two others completed. What they show is `findings_to_resolve` f1 stable
at 100% with zero false positives and zero false negatives across every pass that ran, which is the
milestone's own criterion; the other dimensions moved as they always do on this corpus and should be
re-measured with a full `--repeat 3` once the key resets. The committed cassettes were recorded
before the limit was reached and replay clean.

### Milestone 6 — landed 2026-08-07

Both judgement calls in case 001 are decided and the reasoning is recorded in that case's
`judgement_calls`, which now says DECIDED rather than arguable — so a reviewer can tell a known
disagreement from a regression, which was the actual complaint.

`Глюкоза натощак` stays expected as completed. The argument that settled it was in the document all
along: the report never prints `натощак`, but it prints the glucose reference interval `4.10–5.90`,
and that is the fasting interval — a non-fasting range runs to roughly 7.8. So this is not only the
ordinary reading that a routine panel is drawn fasting; the document carries evidence. The pipeline
does not currently make this completion, which is a miss on its side rather than a wrong expectation.

`Дислипидемия` stays expected as unresolved. An in-range lipid panel in someone under management is
evidence of control, not resolution, and the opposite reading makes the pipeline willing to close a
chronic condition off one good day. That is the highest-harm error this corpus tracks. The live run
that closed it is what made this pressing; runs since Milestone 4 no longer do.

`fixturesImpact` added to `scripts/just/change-impact.cjs`, covering `test/fixtures/` and
`scripts/extraction-eval/`, with four cases in the existing test file — including one asserting a
corpus-only change is not `docsOnly`, since `docsOnly` is what a pipeline would use to skip work
entirely and a fixture change alters what the pipeline is measured against.

## Context and Orientation

You need to understand four pieces of this repository. Every path below is relative to the repository root.

**The pipeline.** `supabase/functions/health-structure/` is a Supabase Edge Function that runs on Deno. It takes the OCR text of a medical document — a plain string already stored on the record, so this function never sees an image — and produces structured clinical data. It runs as three model calls in sequence, called stages, under `supabase/functions/health-structure/stages/`. The `classify` stage decides what kind of document this is and what date it describes. The `extract` stage pulls clinical entities out of the document text, and receives the code catalogues as vocabulary but deliberately never receives the patient's history. The `reconcile` stage compares those entities against the patient's existing record and reports which existing findings and conditions the document shows to have resolved, and which due checkups it completes; it receives the extracted entities and the patient record but deliberately never receives the document text. `stages/client.ts` is the shared HTTP client all three use to call OpenRouter, which is a routing service that forwards to model providers.

**The deterministic half.** After the model stages finish, `supabase/functions/health-structure/service.ts` turns their output into database rows, and this half involves no model at all. `buildObservationRows`, `buildFindingRows` and `buildCheckupSuggestions` live there. Two modules do the real work: `code-resolution.ts` maps a printed label like `Гемоглобин` onto a catalogue code like `hemoglobin`, and `unit-conversion.ts` converts a value from the printed unit into the catalogue's canonical unit. When code resolution fails, the row is written with `is_applied: false`, and every history query filters on `is_applied = true` — so an unresolved row is invisible in the chart.

**The catalogues.** Three reference tables define the vocabulary: `observation_catalog` (38 analytes), `finding_type_catalog` (30 finding types such as `polyp`, `dysplasia`, `inflammation`) and `body_site_catalog` (75 anatomical sites). Each row carries a code, Russian and English names, and synonym arrays. Observation entries additionally carry `canonical_unit` and an `accepted_units` map from a printed unit string to a conversion rule. The eval corpus uses a pinned snapshot of all three at `test/fixtures/extraction/shared/catalogs.json`, regenerated by `scripts/extraction-eval/dump-catalogs.ts`; it is pinned rather than fetched so an unrelated catalogue edit cannot silently move every score.

**The eval harness.** `scripts/extraction-eval/` runs the real pipeline against hand-checked documents and scores the result. `just test-extraction` replays recorded provider responses, called cassettes, so the default run is free, offline and deterministic; `--live` calls OpenRouter and costs money; `--record` implies `--live` and refreshes the cassettes. Cassettes live under `test/fixtures/extraction/cassettes/` and are keyed on the whole request body, so editing a prompt correctly invalidates them and they must be re-recorded. Each case is a directory under `test/fixtures/extraction/cases/` holding `input.md` (the OCR text), `expected.json` (the hand-checked correct answer) and `meta.json` (per-case patient state, plus prose explaining what the case tests and which expectations are judgement calls). There are three cases today: `001-biochem-lipid-ru` (a Russian biochemistry and lipid panel), `002-kidney-ultrasound-ru` (a Russian renal ultrasound) and `003-histology-gi-biopsy-ru` (a Russian three-specimen histopathology report). `scripts/extraction-eval/score.ts` compares expected against actual and `report.ts` renders it. Read `test/fixtures/extraction/README.md` before touching the corpus; it states the conventions, including the central one — expected files encode the **correct** answer, not the current answer, so a known defect shows as a failing expectation by design.

To run anything you need Node dependencies installed (`npm ci`) and, for live runs, `OPENROUTER_API_KEY` in the environment. Deno is needed for the edge-function tests; the command is given in each milestone.

## Plan of Work

### Milestone 1 — Transport limits that match real documents

Two small changes in `supabase/functions/health-structure/stages/client.ts`, both in the request body built inside `callStageJson`.

Set an explicit `max_tokens` on the request. Without it OpenRouter reserves the model's full output capacity — 65,536 tokens — against the account's remaining credit before it dispatches anything, and refuses with HTTP 402 when the balance is below that reservation, even though the real completion costs a fraction of a cent. Choose 16,000: observed completions on the corpus peak around 4,000, so this is four times the largest real answer and still far below the reservation that trips the limit. Note that the client already treats a truncated answer as retryable — it throws `RetryableLlmError` when `finish_reason` is `length` — so if 16,000 ever proves too small the failure is a visible retry, not silent truncation.

Raise the timeout. `DEFAULT_TIMEOUT_MS` is currently 60,000 milliseconds and a real three-specimen histology report has already exceeded it once, completing in 44 seconds on retry. Raise it to 120,000. If you prefer a per-stage value, note that only `extract` carries a raised reasoning budget (`stages/index.ts` passes `"high"` for extraction and nothing for the other two), so extraction is the only slow stage and the only one that needs the larger value.

This milestone is done when the corpus runs live end to end without a timeout, and when a deliberately low-credit key no longer produces 402 on a request whose real cost is well within the remaining balance.

### Milestone 2 — Make the harness able to audit itself

Three changes in `scripts/extraction-eval/`, and this milestone comes before the model-behaviour work because it is what makes that work measurable.

**Score `count` on findings.** `service.ts:178` sets `count: item.count || 1` when building a finding row, so the field reaches the database, but the eval never compares it. Case 003 depends on this: its document says `Количество фрагментов: 2`, which is the number of tissue fragments the pathologist received and **not** the number of adenomas, and a model that copies it into `count` has misread the document. The fixture already expects `count: 1`, and nothing checks it. Carry `count` through `scripts/extraction-eval/pipeline.ts` where finding rows are mapped into the snapshot, add it to `ExpectedFinding` in `scripts/extraction-eval/types.ts`, and add it to `FINDING_FIELDS` in `score.ts`. You must also add `count: 1` to both findings in `test/fixtures/extraction/cases/002-kidney-ultrasound-ru/expected.json`, or that case will report two new mismatches — the expectation would be absent while the actual is 1. Be aware of what the assertion can and cannot prove: because the builder coerces a missing count to 1, an expectation of 1 cannot distinguish "the model said 1" from "the model said nothing", only "the model said 2". That is still the assertion worth having, because 2 is the failure mode.

**Fail the build when an expected field is inert.** This is the highest-value item in the plan, because it stops a class rather than an instance. Three times now a field has been threaded from the pipeline into `CaseSnapshot` into every `expected.json` and then read by nothing, and all three times an outside reviewer found it. Write a test — `scripts/extraction-eval/fixture-coverage.test.ts` is a reasonable home — that loads every `expected.json` under `test/fixtures/extraction/cases/`, walks the objects inside `observations`, `findings`, `conditions`, `findings_to_resolve` and `checkups_to_complete`, collects every key that appears, and asserts that each key is either listed in the corresponding scored-fields array in `score.ts` or is a declared match key. Export the field arrays and a small map of match keys from `score.ts` so the test reads them rather than restating them, otherwise the test drifts from the scorer and stops meaning anything. The failure message must name the key and the file, and say plainly that the field is written but never compared.

**Support repeat runs.** Add a `--repeat N` flag to `scripts/extraction-eval/run.ts` that runs each selected case N times and reports, per dimension, the mean alongside the spread. This only makes sense with `--live`, since replaying a cassette N times returns the same answer N times; make the flag reject a replay run with a clear message rather than silently producing N identical rows. The reason this is needed: five live runs of case 002 disagreed on observations, findings, conditions and anchor rejections, with only one dimension stable, so a single run of a changed prompt cannot be told apart from a resample of an unchanged one.

This milestone is done when `npx vitest run --project node scripts/extraction-eval` passes with the new tests, when deliberately adding an unread key to an `expected.json` makes the suite fail with a message naming that key, and when `just test-extraction --live --repeat 3 --case 002` prints a spread.

### Milestone 3 — Deterministic resolution writes the right row

Three changes, all in the half of the pipeline that runs after the model and involves no model at all, which means every one of them is unit-testable without spending a request.

**Normalise the unit before the lookup.** In `supabase/functions/health-structure/unit-conversion.ts`, `getUnitConfig` currently does `catalogEntry.accepted_units?.[unit]` where `unit` comes from `normalizeText`, which only trims. Introduce a unit-normalising step that maps the Cyrillic forms onto the Latin keys the catalogue uses, then look up the normalised form. At minimum handle the units the catalogue actually contains: `г/л` to `g/L`, `г/дл` to `g/dL`, `мг/дл` to `mg/dL`, `мкг/дл` to `ug/dL`, `пг/мл` to `pg/mL`, `нг/мл` to `ng/mL`, `ммоль/л` to `mmol/L`, `мкмоль/л` to `umol/L`, `ммоль/моль` to `mmol/mol`, `ед/л` and `Е/л` to `U/L`. Normalise case and strip spaces around the slash before matching, because printed forms vary. Keep the lookup exact after normalisation — do not make it fuzzy; a wrong unit is worse than an unconverted one, and the existing behaviour of passing the value through unchanged when no config matches is the safe fallback. Case 001 encodes the correct answer already: it expects `Витамин В12` to store `519.552` with `unit_canonical` `pmol/L`, and it currently fails on exactly that expectation, so this milestone is verified by that failure turning into a pass.

**Make the fuzzy matcher require the discriminating token.** In `supabase/functions/health-structure/code-resolution.ts`, `similarity` scores a Dice coefficient over character trigrams and `resolveWithViews` accepts the best candidate at or above `FUZZY_THRESHOLD = 0.62`. `Холестерин ЛПОНП` clears that against `cholesterol_total` purely on the shared `холестерин` prefix. Add a penalty for query tokens the candidate cannot explain: split the normalised query and the candidate into words, and if the query contains a word of three characters or more that appears in no name and no synonym of the candidate, reduce the score enough to drop it below the threshold. `ЛПОНП`, `ЛПВП` and `ЛПНП` are exactly such words. Verify against the real catalogue snapshot rather than a toy fixture, because the risk here is a regression that stops resolving something that resolves correctly today — write the test to assert both directions, that `Холестерин ЛПОНП` no longer resolves to `cholesterol_total`, and that `Гемоглобин`, `Глюкоза` and the other analytes case 001 resolves today still resolve.

**Give `inflammation` its Russian synonyms.** `Хронический активный гастрит` did not resolve to the `inflammation` entry, whose `name_ru` is `Воспаление`. No threshold reaches this, because the strings share almost no trigrams; the link is semantic. This is catalogue data, not code. Add `synonyms_ru` to the `inflammation` row covering the common `-ит` diagnoses — `гастрит`, `колит`, `эзофагит`, `дуоденит`, `цистит`, `панкреатит` — via a migration under `supabase/migrations/`, then regenerate the corpus snapshot with `npx tsx scripts/extraction-eval/dump-catalogs.ts` so the eval sees the same catalogue production does. Regenerating the snapshot invalidates every cassette, because the catalogue is part of the extraction prompt and cassettes are keyed on the request body; re-record with `OPENROUTER_API_KEY=… just test-extraction --record`.

This milestone is done when case 001's `value_canonical` and `unit_canonical` expectations for `Витамин В12` pass, when its `Холестерин ЛПОНП` expectations of a null code and `is_applied: false` pass, and when case 003's `inflammation` finding-code expectation passes.

### Milestone 4 — The extraction output contract

Three changes to the instructions and worked examples in `supabase/functions/health-structure/stages/extract.ts`. Each fixes a case where the model emits something the prompt never told it how to handle, and each is verified by an expectation that already exists in the corpus and currently fails.

**A qualitative result is not a finding.** `Helicobacter pylori (+)` was emitted as a finding sited to `stomach`, which additionally displaced the real gastritis finding from that site. Add an instruction stating that an entity with no morphology and no site of its own is not a finding, and that a qualitative positive or negative with no numeric value is neither a finding nor an observation. Note for the record that this leaves such results with nowhere to go; case 003's `meta.json` already records that as a schema question rather than a fixture one, and this plan does not resolve it.

**Map severity grading onto the enum.** Both `низкой степени (слабая дисплазия)` and `умеренной степени активности` produced `severity: "unknown"`. The enum already holds `mild`, `moderate`, `severe` and `unknown`; nothing tells the model how Russian grading maps onto it. Add the mapping to the instructions and show it in one worked example.

**A condition name is the diagnosis, not the sentence.** Three conclusion lines were returned verbatim as condition names, producing one true positive against three false positives and one false negative. Add an instruction that `name` carries the diagnosis alone, with the anatomy and the qualifiers going to their own fields, and add a worked example showing a long conclusion sentence reduced to a short condition name plus its ICD code. This is the same under-specification that `finding_type_text` had before it was given a naming rule, and it should be fixed the same way.

When you change any worked example, do not use content drawn from a corpus case. The corpus would then be measuring the model's memory of its own prompt rather than its reading of the document. The existing uncoded-finding example deliberately uses a gallbladder kink for exactly this reason.

Every change here invalidates all cassettes, so re-record and then measure with `--repeat` from Milestone 2. Do not read a single run as evidence: this corpus has produced five different answers to the same document.

### Milestone 5 — Asserted absence: stop inventing it, start using it

This is the largest design change in the plan, and it fixes two defects that are two halves of one story. Today a negated statement either wrongly becomes a positive finding, or it vanishes entirely — and the vanishing means a whole feature cannot work.

The renal ultrasound sentence `ЛС не расширена` became a finding: the pipeline recorded that the pyelocaliceal system _is_ dilated when the document said it is not. Meanwhile `Конкременты: нет` — an explicit statement that there are no stones, which is the strongest possible evidence for closing a previously recorded stone — correctly produces no entity, and therefore reaches nothing. The reconcile stage is asked which existing findings this document shows to have resolved, and is handed only entities that are present. Absence is filtered out one stage before the stage that would act on it.

Do both halves together, because they are the same schema and the same prompt section.

First, stop negations becoming findings. Add an instruction, and add a deterministic guard rather than relying on the instruction alone: every entity already carries a `source_anchor`, a short verbatim quote from the document that is separately validated as actually occurring in the text. Reject a finding whose anchor contains a negation marker — `не`, `нет`, `без`, `не выявлен`, `отсутству` — adjacent to the finding term. The check is cheap and reliable precisely because the anchor is grounded.

Second, give absence somewhere to go. Add an `asserted_absences` array to the extract stage's schema, holding the same shape a finding does — `finding_code`, `site_code`, `body_site_text`, `source_anchor`, `confidence` — grounded the same way. Carry it through the staged parse result, and include it in `buildExtractedSummary` in `stages/reconcile.ts` so the reconcile stage can see it. Reconcile stays blind to the document text; it gains exactly one new signal, which is the thing it needs and nothing more.

Then flip the corpus expectation. Case 002 currently expects the seeded right-kidney stone to resolve on `Конкременты: нет`, and that expectation cannot pass today. `test/fixtures/extraction/README.md` records this explicitly as the one place where the corpus deliberately breaks its own rule that an unreachable expectation means the case is wrong — the rule was suspended because applying it would have meant conceding that `findings_to_resolve` does not work. When this milestone lands, that expectation becomes reachable and the README note must be revised to say so.

Take care not to break what already works: case 003 has three negations sitting beside three positives (`без признаков дисплазии`, `кишечная метаплазия не выявлена`, `атрофия не выявлена`, against present dysplasia, polyp and inflammation), and all three currently hold. That case is the regression test for this milestone.

### Milestone 6 — Corpus governance and the fixture-blind CI flag

Two small pieces of housekeeping that make the corpus trustworthy enough to gate on later.

**Settle case 001's two judgement calls.** Both are recorded in `test/fixtures/extraction/cases/001-biochem-lipid-ru/meta.json` as arguable, and the pipeline has now disagreed with both in a live run. It closed `Дислипидемия` off a fully in-range lipid panel — the first time the report's headline "wrongful resolutions" number has been non-zero — and it did not complete the `Глюкоза натощак` checkup. The corpus currently says both are wrong while calling them arguable, which is the worst of both: a reviewer cannot tell a known disagreement from a regression. Decide each one, change the expectation or leave it, and either way record the decision and its reasoning in that file's `judgement_calls`. On dyslipidaemia specifically, the case's own note is worth weighing: an in-range panel under management is evidence of control rather than resolution, and the opposite reading lets the pipeline close chronic conditions off one good day.

**Make a fixture-only change visible to CI.** `scripts/just/change-impact.cjs` classifies changed files into `dbImpact`, `webImpact`, `extensionImpact`, `functionsImpact` and `docsOnly` by path prefix. `test/fixtures/` matches none of them and is not classified as a doc, so a change touching only the corpus reports no impact whatsoever. No gate depends on these flags today, which is why nothing has broken — but the moment one does, it will skip precisely the pull requests that change the corpus. Add a flag for it and a test alongside the existing `scripts/just/change-impact.test.ts`.

## Concrete Steps

Work the milestones in the order given. Milestone 1 is nearly free and removes an obstacle to running anything live. Milestone 2 must precede Milestones 4 and 5, because those change model behaviour and cannot be measured on this corpus without repeat runs.

Before starting anything, get a baseline you can compare against. From the repository root:

    npm ci
    npx tsx scripts/extraction-eval/run.ts

That replays the committed cassettes and prints a report; save it. If it reports a cassette miss, the committed cassettes are stale relative to the current prompts and you must re-record before you have a baseline, which needs `OPENROUTER_API_KEY` and costs money:

    OPENROUTER_API_KEY=... npx tsx scripts/extraction-eval/run.ts --record

For each milestone, make the change, then run the checks that apply to the surface you touched. Edge-function changes need Deno:

    deno test --allow-env --allow-read --config supabase/functions/deno.json supabase/functions
    deno lint --config supabase/functions/deno.json supabase/functions
    deno check --config supabase/functions/deno.json supabase/functions/*/index.ts

Harness and script changes need the Node test project:

    npx vitest run --project node

Everything needs the shared checks:

    npx tsc --noEmit -p tsconfig.json
    npx prettier --check .

After any change to a prompt, a catalogue or a fixture, the cassettes are invalid by design and must be re-recorded before the corpus can be replayed. Re-record, review what changed under `test/fixtures/extraction/cassettes/`, and commit it.

Commit at each milestone rather than at the end. Each milestone above is independently shippable and independently revertible.

## Validation and Acceptance

Acceptance for this plan is behavioural and is read off the report that `just test-extraction` prints. Below is what a human can check.

For Milestone 1, a live run of all three cases completes without a timeout, and a request against a key whose remaining credit is under a dollar succeeds rather than returning 402.

For Milestone 2, `npx vitest run --project node scripts/extraction-eval` passes. Deliberately add a key such as `"morphology": "tubular"` to one finding in any `expected.json`; the suite must fail and name that key and that file. Remove it and the suite passes again. `just test-extraction --live --repeat 3 --case 002` prints a spread per dimension, and the same command without `--live` refuses with a clear message.

For Milestone 3, the report's observation-field mismatch table no longer lists `Витамин В12` under `value_canonical`, because the stored value is now `519.552` rather than `704`. It no longer lists `Холестерин ЛПОНП` under `obs_code` or `is_applied`. The finding-field mismatch table no longer lists a null `finding_code` for the gastritis finding in case 003.

For Milestone 4, the report no longer lists `Helicobacter pylori (+)` among invented findings; case 003's severity field accuracy rises from one of three to three of three; and case 003's conditions dimension no longer shows conclusion sentences among its false positives. Measure each with `--repeat 3` and compare spreads, not single numbers.

For Milestone 5, case 002's `findings_to_resolve` shows one true positive where it currently shows one false negative, and the report's wrongful-resolution banner still reports none. Case 003's three negations still produce no findings. Case 002 no longer emits `ЛС не расширена` as a finding.

For Milestone 6, `meta.json` for case 001 records a decision for each judgement call, and `npx vitest run --project node scripts/just/change-impact.test.ts` covers the new flag.

Throughout, the number to read first is the wrongful-resolution count at the top of the report. A missed resolution leaves a stale row that a person can correct; a wrongful one silently closes a live condition or finding in someone's medical record. If that number rises, stop and investigate before looking at anything else.

## Idempotence and Recovery

Every step here is safe to repeat. The eval can be run any number of times; replay costs nothing and changes nothing on disk except the report under `.artifacts/extraction-eval/`, which is gitignored.

Re-recording cassettes is idempotent in effect but not in content, because the model is not deterministic — recording twice gives two different valid recordings. If a recording run fails partway, the partial recording is kept rather than pruned; `flush({ prune: true })` is passed only for a case that ran end to end, precisely so a failed run cannot delete a good cassette and leave a corpus that no longer replays. If you find yourself with a corpus that will not replay, the recovery is to re-record the affected case with `--record --case NNN`, which touches only that case.

The catalogue migration in Milestone 3 adds synonyms to an existing row and can be written to be re-runnable. Write it so that applying it twice leaves the same result; the safest form is to set the array rather than append to it.

If a milestone makes the corpus worse, revert that milestone's commit. Each is independent, and the corpus report from before the change is your evidence of what "worse" means — which is why the first concrete step is to save a baseline.

## Artifacts and Notes

The report is written to `.artifacts/extraction-eval/report.md` and `report.json` on every run. The JSON carries per-dimension detail the Markdown summarises, including the labels of every false positive and false negative; when a table is hard to interpret, read the JSON.

Cassettes under `test/fixtures/extraction/cassettes/` are recorded provider responses with the reasoning trace stripped, both because nothing reads it and because it contains an encrypted blob that secret scanners flag as a credential. Cassette files are named `<stage>-<request_hash>.json`; the field is called `request_hash` rather than `key` because a JSON field named `key` holding a hex string is exactly what `gitleaks` is built to catch.

Case directories are default-deny in `.gitignore`: only `input.md`, `expected.json` and `meta.json` are allowed in. This is deliberate, so that image fixtures cannot be committed by accident — a redaction mistake in git history is permanent.

## Interfaces and Dependencies

Nothing in this plan changes a database schema except the catalogue synonym migration in Milestone 3, which adds data to an existing column rather than altering any structure.

Milestone 5 changes the extract stage's JSON schema by adding an array. Note that strict `json_schema` mode requires the `required` array to name every key in `properties` — a schema that omits one is rejected outright with `invalid_json_schema`. An optional field is therefore expressed as a required nullable. There is a test named `every stage schema satisfies strict json_schema mode` that walks all three schemas and enforces this; if you add a property and forget to require it, that test fails before the provider ever sees it.

Milestone 5 also changes the shape passed from extraction to reconciliation. The reconcile stage must remain blind to the document text — that is a deliberate design property, not an oversight, and the comment above `runReconcileStage` says so. Adding `asserted_absences` gives it one more signal derived from extraction, which does not violate that property. Do not take the shortcut of passing the document through.

Live runs depend on OpenRouter and on the account's remaining credit. The default model is `openai/gpt-5.2:nitro`, overridable with `OPENROUTER_HEALTH_STRUCTURE_MODEL`. Two request-shape constraints are already fixed and must not be reintroduced: `temperature` must not be sent, because reasoning endpoints do not advertise it and `provider.require_parameters` is all-or-nothing, so asking for it leaves the router with no eligible endpoint and every call fails with a bare 404; and every schema's `required` array must be complete, as above. Both have regression tests.

## Revision Notes

- 2026-08-07 — Created. Fifteen defects handed off from a working session that built corpus cases 002 and 003 and ran the corpus live nine times. Three further items from that session are deliberately excluded and the reasons are in the Decision Log.

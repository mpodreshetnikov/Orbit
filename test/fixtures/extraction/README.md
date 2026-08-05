# Extraction eval corpus

Scored regression corpus for the health image recognition pipeline — Milestone 8 of
`docs/exec-plans/todo/health-image-recognition-pipeline-hardening.md`.

## Layout

```
test/fixtures/extraction/
  shared/
    checkup-items.json      # patient-state context shared by every case
    catalogs.json           # pinned observation / finding-type / body-site catalogues
  cases/
    NNN-slug/
      input.md              # the ocr_text handed to health-structure
      expected.json         # hand-checked expected extraction
      meta.json             # language, kind, per-case context overrides
  cassettes/
    NNN-slug/               # recorded provider responses, one file per stage
```

`health-structure` never sees the image — its input is the `ocr_text` string on the record. So the
bulk of the corpus is text in, JSON out, and needs no image files at all. Only the few cases that
exercise `health-ocr` carry an `input.png`, and those are gitignored (see below).

## Running it

`just test-extraction` (see `docs/QUALITY.md` for the full policy). Replays cassettes by default —
free, offline, deterministic. `--live` calls OpenRouter and costs money; `--record` implies
`--live` and refreshes the recordings.

**Cassettes have to be recorded once before replay works.** A fresh clone has none, so the first
`just test-extraction` reports a cassette miss per case and exits non-zero. That is the intended
behaviour: the alternative is silently falling back to a paid API call. Bootstrap with

```
OPENROUTER_API_KEY=... just test-extraction --record
```

then review and commit what lands under `cassettes/`.

Cassettes are keyed on the whole request body, so editing a prompt, a catalogue entry or a case
fixture correctly invalidates them — a recorded answer is only valid for the question that produced
it. Re-record when that happens rather than loosening the key.

### The catalogue snapshot

`shared/catalogs.json` is pinned rather than fetched because the catalogue _is_ the extract stage's
vocabulary and the table the deterministic resolver matches against. Fetching it live would let an
unrelated catalogue edit move every score with nothing in the diff to explain it. Regenerate with
`scripts/extraction-eval/dump-catalogs.ts` when the catalogue genuinely changes; ids in the
snapshot are synthetic and positional, since nothing here scores the `*_id` columns.

## Shared checkup items

`shared/checkup-items.json` is the `checkupItems` half of the reconcile stage's patient-state
context (`CheckupItemForContext`, `supabase/functions/health-structure/types.ts:138-143`).
Every case uses it unless its `meta.json` overrides `patient_state.checkupItems`.

Using one shared list across all cases is deliberate: it keeps `checkups_to_complete` scoring
comparable case to case, and it means a case that _should not_ complete any checkup is a real
negative — the model had 22 plausible candidates in front of it and picked none.

Note that reconcile is skipped entirely when the patient has no history at all
(`stages/reconcile.ts:79-85`), so a case with an empty context tests a different code path.

### Provenance and sanitisation

Sourced from the production `checkup_items` table, filtered exactly as
`fetchUpcomingOverdueCheckupItems` does (`health-structure/repository.ts:220-236`):
`status = 'active'` and `next_due_at is not null`, ordered by due date.

Changed on the way in:

- **`id`** — replaced with sequential synthetic UUIDs. Reconcile only requires that a returned
  `checkup_item_id` be one of the ids supplied in the prompt (validated at
  `stages/reconcile.ts:199-230`), so the real primary keys carry no signal and committing them
  would pin a fixture to production rows.
- **`next_due_at`** — two dates derived from actual immunisation dates (tick-borne encephalitis,
  Td) were rounded to the first of their month, matching the shape of the other entries. The
  relative spread across 2026–2035 is preserved, which is what reconcile actually reasons over.

Left verbatim:

- **`title`** — kept exactly as stored, including the `стобняк` / `столбняк` typo in the Td entry.
  Real titles carry real typos, and a matcher that only works on correctly spelled input is not
  the matcher we want to ship.
- **`category`** — kept as stored, including the two eye-exam items filed under `lab`. If those
  are corrected in production, regenerate this file rather than hand-editing it.

`person_id`, `schedule`, `why_text`, `why_links`, and `notes` are not fetched by the pipeline and
are not reproduced here.

## Existing conditions belong to the case, not to `shared/`

Unlike checkup items, `patient_state.existingConditions` is set per case in `meta.json`. Conditions
are what a document is asked to resolve, so they have to be chosen against that document's actual
content — a shared list would be either trivially unresolvable everywhere or wrong somewhere.

Each case should carry **one condition the document positively resolves** and **several it does
not**, because resolution is the asymmetric risk here. A missed resolution leaves a stale entry
someone can correct; a wrongful resolution silently closes a live condition in a patient's record.
The reconcile stage is told as much — _"Absence of a mention is not evidence of resolution"_ and
_"Empty is the correct and expected answer in most cases"_ (`stages/reconcile.ts:157-160`) — so the
negatives are testing an instruction that already exists, not an aspiration.

Pick negatives that are _tempting_, not merely unrelated. In case 001 the four negatives escalate:
an unrelated condition (gastritis), a condition whose analytes are absent but adjacent to one that
is present (iron-deficiency anaemia next to a normal B12), a condition whose usual lab markers are
all in range but which is diagnosed by other means (NAFLD with normal ALT/AST/GGT), and a condition
whose every marker is in range (dyslipidaemia). Only the last is genuinely arguable, and it is
recorded in that case's `judgement_calls`.

Note reconcile never sees the document — only extraction's output plus patient state
(`stages/reconcile.ts:86-89`). It does receive observations with name, code, value, unit and
status, which is what makes the B12 resolution reachable at all. If a case expects a resolution
that depends on document prose rather than an extracted entity, that expectation is unreachable by
construction and the case is wrong, not the pipeline.

## Dates

Where a document prints several dates, vary them. `record_date` is scored as an exact match, and a
case where collection, registration and printing all fall on one day cannot tell a correct answer
from a coincidence. Case 001 prints 06.03, 07.03 and 11.03; the expected value is the collection
date, per classify's instruction that `record_date` is "the date the document describes, not the
date it was scanned" (`stages/classify.ts:19-23`).

## Expected files encode the correct answer, not the current answer

Where the pipeline is known to be wrong, `expected.json` states what the pipeline _should_
produce. A corpus that encodes current behaviour cannot detect a regression away from correct,
only away from familiar.

### Known divergence: Cyrillic units never match `accepted_units`

Unit canonicalisation is an exact string lookup — `getUnitConfig` reads
`catalogEntry.accepted_units[unit]` (`health-structure/unit-conversion.ts:32-40`), where `unit`
is whatever the model put in `unit_text`. The extract stage explicitly instructs the model to
record units "exactly as printed, in the document's own language"
(`stages/extract.ts:285`), and `accepted_units` is keyed in Latin (`U/L`, `mmol/L`, `pg/mL`).
Nothing between the two normalises Cyrillic to Latin.

So for a Russian report every lookup misses, `config` is null, and
`convertValueWithConfig` returns the value unchanged (`unit-conversion.ts:47`) — while
`convertToCanonical` still stamps `unit_canonical` with the catalogue's canonical unit
(`:79`). The value is not converted but is relabelled as though it had been.

For most analytes this is harmless arithmetic: `ммоль/л` and `mmol/L` are the same unit, so
passing the value through unchanged happens to be right. **Витамин В12 is not harmless.** The
report is in `пг/мл`; canonical is `pmol/L`; the factor is 0.738. Case 001 expects
`519.552 pmol/L`. The pipeline today stores `704` labelled `pmol/L` — a 35% overstatement
carrying a unit it was never converted into, and the same silent relabel applies to
`ref_range_low_canonical` / `ref_range_high_canonical`.

Case 001 will therefore fail on `unit canonicalisation` until either `accepted_units` gains
Cyrillic keys or a normalisation step is added ahead of the lookup. That failure is the point.

A second, smaller trap in the same case: the report writes `Витамин В12` with a Cyrillic `В`,
while `synonyms_ru` holds `витамин b12` with a Latin `b`. Whether `vitamin_b12` resolves at all
depends on the fuzzy tier clearing `FUZZY_THRESHOLD` (`code-resolution.ts:24-36`).

## Images are not committed

Case directories are **default-deny** in `.gitignore`: everything under `cases/` is ignored, and
only `input.md`, `expected.json` and `meta.json` are allowed back in. Adding a new file type to a
case therefore requires an explicit, reviewable `.gitignore` change.

The first version of this rule was an extension allowlist, and it was wrong — it matched
`input.jpg` but not `input.JPG`, which is the default name from most cameras and scanners. An
allowlist has to anticipate every extension and every capitalisation of it; default-deny does not.

Image fixtures live in a private Supabase bucket and are pulled on demand. Keeping them out of git
history means a redaction mistake stays fixable; once a blob is in a pack, it is not.

Also note `input.md` is exempt from Prettier (`.prettierignore`). It stands in for OCR output and
must stay byte-exact — Prettier collapses the tab-delimited result tables to single spaces, which
destroys the column structure the extractor reads value, unit and reference range from, and which
Milestone 7 identifies as the origin of value-to-unit mispairing.

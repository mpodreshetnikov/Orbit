# Extraction eval corpus

Scored regression corpus for the health image recognition pipeline — Milestone 8 of
`docs/exec-plans/todo/health-image-recognition-pipeline-hardening.md`.

## Layout

```
test/fixtures/extraction/
  shared/
    checkup-items.json      # patient-state context shared by every case
  cases/
    NNN-slug/
      input.md              # the ocr_text handed to health-structure
      expected.json         # hand-checked expected extraction
      meta.json             # language, kind, per-case context overrides
```

`health-structure` never sees the image — its input is the `ocr_text` string on the record.
So the bulk of the corpus is text in, JSON out, and needs no image files at all. Only the few
cases that exercise `health-ocr` carry an `input.png`, and those are gitignored (see below).

## Shared checkup items

`shared/checkup-items.json` is the `checkupItems` half of the reconcile stage's patient-state
context (`CheckupItemForContext`, `supabase/functions/health-structure/types.ts:138-143`).
Every case uses it unless its `meta.json` overrides `patient_state.checkupItems`.

Using one shared list across all cases is deliberate: it keeps `checkups_to_complete` scoring
comparable case to case, and it means a case that *should not* complete any checkup is a real
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

## Images are not committed

`test/fixtures/extraction/**/*.{png,jpg,jpeg,webp,heic,pdf}` is gitignored. Image fixtures live in
a private Supabase bucket and are pulled on demand. Keeping them out of git history means a
redaction mistake stays fixable; once a file is in a pack, it is not.

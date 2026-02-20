# Health Clinical Data Lifecycle

## Intent

Describe how extracted and user-authored clinical data entities relate and evolve over time.

## Current Implementation In This Repo

### Core entities

- Record root: `medical_records`
- Attachments: `record_attachments`
- Observations:
  - catalog: `observation_catalog`
  - record-level facts: `record_observations`
  - longitudinal view via `use-observation-history.ts`
- Measurements:
  - manual/observed values in `measurements`
  - catalog in `measurement_catalog`
- Findings:
  - extracted findings in `record_findings`
  - type/site catalogs: `finding_type_catalog`, `body_site_catalog`
- Conditions:
  - persistent condition entity: `conditions`
  - mention history per record: `condition_records`
- Checkups:
  - planned items: `checkup_items`
  - completions/evidence links: `checkup_completions`

### Lifecycle pattern

1. Record is ingested and reviewed.
2. Structured extraction proposes observations/findings/conditions/checkup completions.
3. User verifies/edits extraction output.
4. Activation (`status = active`) makes record part of longitudinal timelines.
5. Condition and finding states evolve through subsequent records and explicit edits.

## Rules To Follow

1. Keep persistent entities and mention/history entities separate (for example `conditions` vs `condition_records`).
2. Preserve source anchors/confidence where extraction creates derived facts.
3. Keep catalog entities curated and reusable across records.
4. Prefer append/history models over destructive rewrites for longitudinal integrity.
5. Keep domain-specific linking explicit (`evidence_record_id`, condition links, etc.).

## Anti-Patterns To Avoid

- Flattening persistent condition state into one-off record mentions.
- Overwriting historical measurement/observation context.
- Coupling catalog maintenance to one specific record workflow.

## Tradeoffs

- Rich lifecycle modeling improves trend analysis but increases schema complexity.
- Extraction confidence metadata aids review but adds UI/model overhead.

## Known Gaps And Next Refactor Targets

- Improve modularization of condition/checkup/findings UI pages with clearer feature boundaries.
- Expand automated validation scenarios for cross-entity lifecycle regressions.

## References

- `src/hooks/use-conditions.ts`
- `src/hooks/use-checkups.ts`
- `src/hooks/use-finding-history.ts`
- `supabase/db/functions/get_person_conditions_with_history.sql`

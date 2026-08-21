---
id: T-0018
title: Log a one-off intake against an existing course over MCP instead of creating a duplicate medication
status: in-progress
kind: bug
priority: p1
depth: note
created: 2026-08-19
updated: 2026-08-21
owner: TBD
tags: [mcp, health, medications]
---

# Log a one-off intake against an existing course over MCP instead of creating a duplicate medication

## Context

The web UI already has this behaviour. A one-time intake (`kind: "one_time"` in
`src/components/medications/medication-form.tsx:296-313`) offers the person's existing courses in a
combobox and, when the typed name matches one exactly (trimmed, lower-cased) or one is picked from
the list, submits an `AddOneTimeToExistingPayload` instead of a new regimen. That payload goes to
`addOneTimeDoseToRegimen` (`src/hooks/use-regimens.ts:429`), which inserts one `med_dose_events` row
against the existing `regimen_id` and calls the `mark_dose_taken` RPC — the RPC that also decrements
inventory. A new regimen is created only when nothing matched.

The MCP server has none of that. Its medication tools are `list_medications`, `get_medication`,
`list_medication_doses`, `add_medication` and `update_medication`
(`src/lib/mcp/tools/medications.ts`); not one of them writes `med_dose_events`. So an agent told
"I took half an Atarax at 23:10" has only `add_medication`, which unconditionally calls
`createRegimen`. That is what happened in production on 2026-08-19: a second "Атаракс" regimen
(`one_off`, `for_days: 1`) appeared next to the real course, and the intake was generated under it
by `generate_med_dose_events_for_person_ids` (its `one_off` branch inserts the event already
`taken`). The stray regimen and its event were repaired by hand.

Two gaps caused it, and both live in the server rather than in any client's prompt: there is no way
to log a dose, and `add_medication` does not look at what already exists under the same name.

## Progress

- [x] 2026-08-19 — Repaired the production data by hand: dose event `2256a44f` re-pointed to the
      real course `ffe4f4a8`, the stray regimen `97eada49` soft-deleted.
- [x] 2026-08-19 — Added `log_dose`, backed by `logDose` in `src/lib/mcp/health/medications.ts`,
      which inserts the event and resolves it through `mark_dose_taken`/`mark_dose_skipped` and
      withdraws the event if that RPC fails.
- [x] 2026-08-19 — `add_medication` now calls `findRegimensByName` first and fails with every match
      unless `allow_duplicate: true`.
- [x] 2026-08-19 — `docs/design/domains/health/mcp-server.md` updated with both.
- [x] 2026-08-19 — Addressed the automated review: `log_dose` now resolves an already-planned dose
      in the same minute instead of colliding with
      `idx_med_dose_events_regimen_scheduled_minute`, reports the surviving event when both the RPC
      and the compensating withdrawal fail, and parses `taken_at` strictly (offset-bearing ISO, or a
      wall-clock time read in the caller's timezone) instead of through bare `new Date`.
- [x] 2026-08-21 — Carried the change into this repository after the migration recorded in
      `T-0016`, renumbered from `T-0017`, which this registry had already assigned to the
      dependency-vulnerability backlog.
- [x] 2026-08-21 — Addressed the review on this repository's PR: the compensating withdrawal now
      hard-deletes instead of stamping `deleted_at` (a soft-deleted `scheduled` row still occupies
      the unique index and would make the intake permanently unrecordable), a corrected amount is
      restored onto the planned event when the RPC then fails, and `localDateTimeUtc` rejects
      calendar dates that `Date.parse` would roll forward.
- [ ] Confirm against the deployed MCP server that "I took half an X tonight" reaches `log_dose`
      instead of creating a second medication.

Verified here: `npx vitest run` (226 files, 1656 tests, all passing), `npx tsc --noEmit`,
`npx eslint src shared --max-warnings=0`, `npx prettier --check .`, and the coverage ratchet
(`src/**` lines 86.89%, branches 75.99%). The Deno half of `test-unit-coverage` and `test-e2e` were
not run — neither `deno` nor the Supabase CLI exists in this environment, and the change touches no
Edge Function and no UI flow.

## Decision Log

- Decision: Put the rule in the MCP server rather than in an agent skill.
  Rationale: A skill is advice one client may or may not follow, and this MCP is reachable from
  clients that never load this repository's skills. A server-side guard holds for every caller.
  Date/Author: 2026-08-19, agreed with the repository owner.

- Decision: Refuse on any exact name match, not only on a `one_off` schedule, and always return the
  full list of matching courses.
  Rationale: Titration is recorded as successive courses under one name (Золофт has four), so a
  match is not proof of a mistake — but it is always something the caller should see before
  creating another row. Failing with the candidates costs one round-trip and turns a silent
  duplicate into a decision. `allow_duplicate: true` keeps the legitimate case reachable.
  Date/Author: 2026-08-19, agreed with the repository owner.

- Decision: Match names the way the form does — trimmed and lower-cased equality — rather than
  fuzzily.
  Rationale: The UI's matcher is the behaviour the user already knows. A looser match (substring,
  edit distance) would collide "Магний" with "Магний B6", which are different medications.
  Date/Author: 2026-08-19.

- Decision: Resolve an unresolved dose event in the same minute rather than always inserting a new
  one, and convert an offset-less `taken_at` through the caller's timezone rather than refusing it.
  Rationale: `idx_med_dose_events_regimen_scheduled_minute` uniquely indexes scheduled and sent
  events per regimen per minute, so "I took my 22:00 pill" at 22:00 would have failed on a
  duplicate key; resolving the planned event is also the truthful record. On the timestamp, bare
  `new Date` reads an offset-less string in the server's zone (UTC in production) and accepts
  non-ISO input like `"0"`, so the stated contract was not enforced. Both were raised by the
  automated review and confirmed against the migration and the parser.
  Date/Author: 2026-08-19.

- Decision: Withdraw a failed insert with a hard delete rather than a `deleted_at` stamp.
  Rationale: `idx_med_dose_events_regimen_scheduled_minute` is predicated on `status` alone, so a
  soft-deleted `scheduled` row keeps holding its regimen's minute while every reader — including
  `findPlannedDoseInSameMinute` — hides it. The retry could neither resolve the tombstone nor
  insert past it, so a single RPC outage would make that intake unrecordable for good. The row is
  seconds old and was never resolved, so soft-deletion protects no history. Raised by the automated
  review and confirmed against the migration.
  Date/Author: 2026-08-21.

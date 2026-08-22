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

- [x] 2026-08-19 — Repaired the production data by hand: the stray dose event was re-pointed to the
      real course and the duplicate regimen soft-deleted. Row identifiers are deliberately not
      recorded here; see the Decision Log.
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
- [x] 2026-08-21 — Addressed an adversarial review of the ported PR, which found the change was not
      yet safe for medical data. `log_dose` is now idempotent (the same-minute probe considers every
      status, and an already-resolved dose is reported or corrected in place rather than
      duplicated); a lost RPC response no longer destroys a committed intake, because the row is
      re-read before anything is withdrawn; the timezone is read rather than persisted, so logging
      history no longer re-times the household's reminders; the duplicate guard only blocks courses
      that are still running; amendments keep the active ingredients and the slot's unit; and the
      two reads that swallowed their errors now report them.
- [x] 2026-08-21 — Exercised both behaviours against the deployed connector, after the merge of
      PR #8 deployed at 16:18Z. Both passed writing nothing to the health record: - `log_dose`, aimed at a minute that already held a resolved intake, returned
      `already_recorded: true` with the existing event handed back untouched. Re-reading the
      course afterwards showed the same `updated_at` and the same number of dose events and
      inventory transactions as before the call. On the code as first written this would have
      inserted a second intake and a second `decrement`. - `add_medication`, for a name whose course is still running, refused — naming the running
      course and listing the finished courses of that name separately as context. Nothing was
      created.
      The insert branch — a genuinely new intake at a free minute — was deliberately not exercised,
      because doing so means writing an intake that did not happen into a real medical record. It
      shares every step with the exercised path up to the probe's branch.
- [ ] Confirm that a natural-language request reaches `log_dose` rather than some other tool. The
      two checks above establish that each tool behaves correctly when called, which is not the
      same claim: a client could still route "I took half an X tonight" to `add_medication`, be
      refused by the guard, and leave the intake unrecorded. Observing the routing needs the
      connector to record which tool ran — `T-0019`.

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

- Decision: Probe the target minute at every status, not just the ones the unique index covers.
  Rationale: `idx_med_dose_events_regimen_scheduled_minute` answers "may another unresolved row go
  here", which is not the same question as "is this intake already recorded". Reusing its predicate
  meant a dose the person had already ticked in the app was invisible to the probe _and_ unblocked
  by the index, so telling the assistant about it wrote a second intake and a second inventory
  decrement — on the most ordinary sequence there is. `snoozed` was the same, and additionally left
  a reminder armed for a dose already taken. `mark_dose_taken` accepts `skipped` and
  `mark_dose_skipped` accepts `taken` precisely so a resolution can be amended in place.
  Date/Author: 2026-08-21, from the adversarial review.

- Decision: Re-read the dose event before withdrawing it, and never withdraw one that cannot be read.
  Rationale: `supabase.rpc` reports a lost response exactly like a rejected call, and the RPC is
  plpgsql and commits atomically. Deleting unconditionally on error therefore destroyed committed
  intakes: the row went, its `decrement` survived as an orphan (`event_id` is ON DELETE SET NULL),
  stock stayed reduced, and the caller — told it had failed — decremented again on retry. An
  unresolved event is a reminder too many; a deleted one may be a medical record too few, so when
  the state cannot be established nothing is touched and the response says so.
  Date/Author: 2026-08-21, from the adversarial review.

- Decision: Read the timezone preference in `log_dose` and `list_medication_doses` instead of
  resolving it.
  Rationale: `resolveTimezone` upserts `user_preferences.checkup_notification_timezone`, which
  `run_med_event_generation_for_all_users` and both reminder digests run on. A timezone passed to
  interpret one timestamp therefore re-timed every future dose event and checkup reminder in the
  household — silently, and in direct contradiction of this tool's own contract that logging an
  intake does not change the plan. `list_medication_doses` had the same defect while declaring
  itself read-only. `readTimezonePreference` is the read half, split out; the resolving variant
  stays where it belongs, on the tools that really are re-timing the plan.
  Date/Author: 2026-08-21. The `log_dose` half came from the adversarial review; the
  `list_medication_doses` half was found while fixing it and is pre-existing.

- Decision: Only `active` and `paused` courses block `add_medication`.
  Rationale: The guard as first written refused a new course whenever any course of that name
  existed, including one finished a year ago — and every remedy its message offered was wrong for
  that case: `log_dose` would file today's intake against the old course, `update_medication` would
  overwrite the record of what that course actually was, and `allow_duplicate`'s own description
  told a compliant model not to use it for the same medication. A re-prescription is ordinary, so
  the guard now blocks only what is still running, while still showing the finished courses as
  context. It is also what the web form does: `medication-form.tsx` name-matches for one-off intakes
  only and has never blocked a new course.
  Date/Author: 2026-08-21, from the adversarial review.

- Decision: Test `logDose` against a fake that enforces the database's constraints.
  Rationale: The shared FIFO stub answers whatever a test queued, in call order, regardless of the
  query — it models neither the partial unique index nor the RPCs' status preconditions, so the
  suite was green while every defect above was live. `src/lib/mcp/health/dose-events-fake.ts` holds
  rows instead: filters apply, the index rejects a second unresolved row in the same regimen-minute,
  the RPCs follow `supabase/db/functions/mark_dose_*.sql` including inventory, and a delete nulls
  the transaction's `event_id` as the FK does. Reverting the fixes makes ten of its tests fail,
  which is the property the old tests lacked.
  Date/Author: 2026-08-21.

- Decision: Leave the concurrent double-decrement in `mark_dose_taken` to `T-0020` rather than
  fixing it here.
  Rationale: The review noted that the RPC's status guard takes no row lock, so two simultaneous
  calls both pass it and both write a `decrement`. It is real, but it predates this work and lives
  in SQL, which this change does not touch; and the fake used here is single-threaded, so nothing in
  this suite could show a fix worked. Claiming it as covered would repeat the mistake the review had
  just found elsewhere in this PR.
  Date/Author: 2026-08-21.

- Decision: Close the task without exercising `log_dose`'s insert branch against production.
  Rationale: The two checks that were run cover what the task exists for — the path that produced
  the incident is closed (`add_medication` refuses while a course runs) and the path that should
  have been taken works (`log_dose` resolves against the existing course). Exercising the insert
  branch would mean recording an intake nobody took, in the medical record of a real person, to
  turn a checkbox green. A fabricated entry is worse than an unexercised branch, and that branch is
  covered by the constraint-enforcing fake.
  Date/Author: 2026-08-21.

- Decision: Note that neither check can prove `log_dose` was the tool the model chose.
  Rationale: The verification reads the resulting data and the tool's own response. With no
  telemetry on the connector (`T-0019`), a call that reached some other tool and happened to leave
  the same data behind would look identical. This is the same blind spot that made the original
  incident take a manual dig through `created_at` columns to reconstruct.
  Date/Author: 2026-08-21.

- Decision: Keep this task open rather than closing it on the two checks above.
  Rationale: The remaining acceptance item is that a natural-language request _reaches_ `log_dose`.
  What was verified is that `log_dose` and `add_medication` each behave correctly when called,
  which does not establish routing — a client could still pick `add_medication`, be refused, and
  leave the intake unrecorded, which is a worse outcome than the duplicate this task started from.
  `docs/tasks/README.md` defines `done` as delivered _and verified_, and makes it terminal, so
  closing on partial evidence would have been unwound only by opening a second task. Raised by the
  automated review on PR #9.
  Date/Author: 2026-08-21.

- Decision: Record verification evidence without medication names, dose amounts, row identifiers or
  counts.
  Rationale: This repository is public (`T-0016`), and git history is durable — the same reason the
  publication work removed the owner's identity from the tree rather than editing it forward. The
  first draft of the evidence above named two real medications, an active dose, several row ids and
  the exact number of a person's dose events. None of that was needed to say what the checks
  established. Identifiers from the 2026-08-19 repair were removed from this file for the same
  reason; they remain in the history of PR #8, which is a separate question for the repository
  owner. Raised by the automated review on PR #9.
  Date/Author: 2026-08-21.

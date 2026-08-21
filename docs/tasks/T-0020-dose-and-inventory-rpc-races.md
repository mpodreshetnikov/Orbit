---
id: T-0020
title: Make the dose and inventory RPCs safe under concurrency — unguarded transitions and lost updates
status: open
kind: bug
priority: p2
depth: note
created: 2026-08-21
updated: 2026-08-21
owner: TBD
tags: [database, health, medications, concurrency]
exit: "Two concurrent calls that resolve the same dose event produce exactly one inventory transaction and one status change, a concurrent inventory write cannot lose another's change to `med_regimens.inventory`, and a pgTAP test drives both races and fails without the fix"
---

# Make the dose and inventory RPCs safe under concurrency — unguarded transitions and lost updates

## Context

Every RPC that resolves a dose reads the row, decides from what it read, and then writes — with no lock
between the two. `mark_dose_taken` (`supabase/db/functions/mark_dose_taken.sql:27-31`) selects the
event `WHERE status IN ('scheduled','sent','snoozed','skipped')`, returns early if that finds
nothing, and only afterwards updates the status and inserts the `decrement`. The `SELECT` takes no
`FOR UPDATE`, so under Postgres's default READ COMMITTED two concurrent calls for the same event
both pass the guard. The second blocks on the `UPDATE`, but its predicate is only `id = ...` — the
status is not re-checked — so it proceeds. **One dose swallowed, two `decrement` rows, stock down by
two.** The refill digest then fires early, on a count that is simply wrong.

There is a second, wider race in the same functions. Stock lives in a jsonb column, and the update
is a read-modify-write in application memory:

```sql
SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
v_inv := jsonb_set(v_inv, '{current_amount}', ...);
UPDATE public.med_regimens SET inventory = v_inv WHERE id = v_event.regimen_id;
```

Nothing locks the regimen row, and the whole `inventory` object is written back. Two writers that
interleave lose one of the two changes, and because the write is whole-object rather than
field-level, a concurrent edit to any _other_ field of `inventory` — a refill through
`update_regimen_inventory`, a threshold change — is silently discarded too.

The same shape appears in `mark_dose_skipped.sql:24-52`, `undo_dose_intake.sql`,
`update_regimen_inventory.sql` and `update_dose_event_resolution_details.sql`.

This is reachable from three directions today, so it is not theoretical: the web UI
(`src/hooks/use-regimens.ts`), the push-notification action route
(`src/app/api/notifications/medication-action/route.ts`, where a reminder can be actioned from two
devices or double-tapped), and now the MCP connector (`src/lib/mcp/health/medications.ts`). It is
_older_ than any of the MCP work — `T-0018` only widened who can trigger it.

Found during the adversarial review of `T-0018`'s pull request, and deliberately left unfixed there:
the fix belongs in SQL, `T-0018` touches no migration, and the fake that suite uses is
single-threaded, so nothing in it could demonstrate the fix worked. Claiming it as covered would
have been the same mistake the review had just found elsewhere in that PR.

## Progress

- [ ] Take the row locks the decisions depend on: `SELECT ... FOR UPDATE` on the dose event before
      the status guard, and on `med_regimens` before the inventory read-modify-write.
- [ ] Re-check the status in the `UPDATE` predicate as well, so a transition cannot be applied twice
      even if the guard is passed twice.
- [ ] Decide whether `med_inventory_transactions` should carry a uniqueness constraint that makes a
      double `decrement` for one event impossible at the storage layer, rather than only unlikely.
- [ ] Apply the same treatment to `mark_dose_skipped`, `undo_dose_intake`,
      `update_regimen_inventory` and `update_dose_event_resolution_details`.
- [ ] Consider whether whole-object jsonb writes to `med_regimens.inventory` should become
      field-level `jsonb_set` in SQL, so an unrelated concurrent edit is not lost.
- [ ] Add a pgTAP test that drives both races (two sessions, one dose event) and fails without the
      fix — the property `T-0018`'s suite could not have.

## Decision Log

- Decision: Track separately from `T-0018` rather than folding it in.
  Rationale: `T-0018`'s exit is that a one-off intake over MCP reaches the right course; this one's
  is that the RPCs underneath are safe when called twice at once. Satisfying either leaves the other
  untouched. The fix is also in a different layer — SQL migrations and pgTAP — from anything
  `T-0018` touches, and it predates that work.
  Date/Author: 2026-08-21, raised by the repository owner after the adversarial review of the
  `T-0018` pull request.

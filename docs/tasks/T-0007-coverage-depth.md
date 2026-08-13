---
id: T-0007
title: Raise runtime coverage depth in the web and DB surfaces
status: open
kind: debt
priority: p2
depth: note
created: 2026-02-21
updated: 2026-02-21
owner: TBD
tags: [coverage, testing, web, db]
exit: "`coverage/combined-summary.json` shows sustained improvement and `db-coverage-summary.json` mapping above 50%/50%"
---

# Raise runtime coverage depth in the web and DB surfaces

## Context

Runtime coverage is now visible per surface, but depth remains low in the web and DB surfaces.
Visibility was the first half of the problem and is solved; the numbers it exposes are the second
half and are not.

Coverage commands are registered in `AGENTS.md` as `coverage-report`, `coverage-check` and
`db-coverage-report`. The scoring policy that consumes these numbers lives in `docs/QUALITY.md`.

Migrated from the former `docs/exec-plans/tech-debt-tracker.md` on 2026-08-13.

## Progress

- [ ] Raise web surface coverage depth.
- [ ] Raise DB surface coverage depth to above 50%/50% mapping.

## Decision Log

- Decision: Track this as a `debt` task with an explicit exit condition rather than as an open-ended
  quality goal.
  Rationale: The original tracker row already carried an exit criterion, and the registry requires
  one for `kind: debt`. Preserving it keeps the debt falsifiable — it can be closed by measurement
  rather than by opinion.
  Date/Author: 2026-08-13, task registry migration.

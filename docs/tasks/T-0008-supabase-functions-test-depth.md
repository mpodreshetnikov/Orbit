---
id: T-0008
title: Cover success and negative branches in Supabase Edge Function tests
status: done
kind: debt
priority: p2
depth: note
created: 2026-02-21
updated: 2026-02-21
owner: Codex
tags: [supabase, functions, testing, coverage]
exit: "Handler/service/adaptor suites cover success and negative branches with mocked internet calls, and per-function Deno coverage is at least 75% lines and branches"
---

# Cover success and negative branches in Supabase Edge Function tests

## Context

All five live Supabase Edge Functions had handler tests, but those tests mostly covered fast-fail and
guard paths — the branches that reject bad input — rather than the paths that do the actual work.
A function could therefore be badly broken in its success path and still show green.

The refactor that repaid this debt is recorded as `T-0002`.

Migrated from the former `docs/exec-plans/tech-debt-tracker.md` on 2026-08-13, where it was marked
`Resolved`.

## Progress

- [x] (2026-03-02) Handler, service and adaptor suites cover success and negative branches with
      mocked internet calls, and per-function Deno coverage reaches the threshold. Delivered by
      `T-0002`.

## Decision Log

- Decision: Carry this over as a `done` task rather than dropping it during migration.
  Rationale: The tracker recorded it as `Resolved`, and that outcome is history worth keeping — it
  records that the gap was real, who closed it, and what "closed" meant. Deleting resolved debt
  makes a tracker look like it never had problems.
  Date/Author: 2026-08-13, task registry migration.

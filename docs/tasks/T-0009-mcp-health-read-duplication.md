---
id: T-0009
title: Give health query logic one definition shared by hooks and MCP tools
status: open
kind: debt
priority: p2
depth: note
created: 2026-08-09
updated: 2026-08-09
owner: TBD
tags: [mcp, health, duplication]
exit: "Query logic for measurements, records, observations, findings, conditions and checkups has one definition each, consumed by both the hooks and the MCP tools"
---

# Give health query logic one definition shared by hooks and MCP tools

## Context

Health query logic is written twice: client hooks in `src/hooks/*` and server-side equivalents in
`src/lib/mcp/health/*`.

This was deliberate. The hooks are `"use client"` and bound to the browser Supabase client and React
Query, so sharing them would have meant refactoring roughly 8.6k lines of UI code inside the same
change that introduced the MCP server (`T-0003`). The genuinely runtime-agnostic pieces —
`regimen-mappers`, `regenerate-dose-events`, `measurement-order` and `measurement-trend` — are
already shared, so the drift risk is confined to the `.from().select()` chains.

That bound is what makes this debt rather than a defect: the two copies can diverge silently, and
nothing in the build would notice.

Migrated from the former `docs/exec-plans/tech-debt-tracker.md` on 2026-08-13.

## Progress

- [ ] Unify the `.from().select()` chains for measurements, records, observations, findings,
      conditions and checkups behind one definition each.

## Decision Log

- Decision: Accept the duplication at the time `T-0003` shipped, and track it as debt instead of
  blocking that change on a UI refactor.
  Rationale: Sharing the query logic required decoupling roughly 8.6k lines of client code from
  React Query and the browser client. Doing that inside the MCP change would have made a
  security-sensitive change much harder to review. The runtime-agnostic helpers were shared
  immediately, which confines the divergence risk to the query chains themselves.
  Date/Author: 2026-08-09, carried over from the tech debt tracker.

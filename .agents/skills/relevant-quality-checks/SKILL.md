---
name: relevant-quality-checks
description: Apply repository quality checks for tasks that change files by following canonical policy in docs/QUALITY.md. Use when implementing, refactoring, or fixing code, DB SQL, functions, scripts, CI config, tests, or security-sensitive logic. Enforce stage-based and final-gate execution from docs/QUALITY.md, and report exact check outcomes.
---

# Relevant Quality Checks

Use this skill whenever a task edits repository files.

## Required Workflow

1. Detect task impact from changed files (`git status --porcelain`, `git diff --name-only`).
2. Read and follow `docs/QUALITY.md`:
   - `Stage-Based Execution Cadence`
   - `Change-Type Check Matrix`
   - `How To Check Quality (Execution + Validation)`
3. At each task stage that changed files, run required scoped checks for that stage.
4. At final task stage with non-doc changes, run final gates required by `docs/QUALITY.md`.
5. MUST fix quality failures and rerun checks until green.
6. A failure can be named `blocked` ONLY for an external blocker that the agent cannot resolve directly.
7. Nothing can be named `blocked` until the agent has tried to fix it.
8. If a check remains `blocked`, always provide a concrete reason explaining why it is an external blocker.
9. Use command IDs in communication (`ci`, `db-test`) and map to concrete commands via `AGENTS.md`.

## Final Report Contract

Include this checklist in the final task response:

- `ran`: command IDs executed.
- `passed`: command IDs that succeeded.
- `failed`: command IDs that failed with brief cause.
- `blocked`: command IDs still blocked after attempted fixes, with explicit external blocker reason.

---
id: T-0011
title: Unify work tracking into a single task registry with an agent skill
status: done
kind: chore
priority: p1
depth: note
created: 2026-08-13
updated: 2026-08-13
owner: TBD
tags: [docs, tooling, agents, process]
---

# Unify work tracking into a single task registry with an agent skill

## Context

Work was tracked in three disconnected places — `docs/exec-plans/todo|done/` for large ExecPlans,
`docs/exec-plans/tech-debt-tracker.md` for debt, and nowhere at all for small tasks, ideas, and the
reasoning behind decisions taken outside a plan. `docs/ARCHITECTURE.md` already recorded the split as
gap `ARCH-G06`.

This task unifies all three into `docs/tasks/`, one file per unit of work, and adds the tooling and
agent skill that keep it honest. The full reasoning, the alternatives weighed, and the accepted costs
are recorded in `decisions/ADR-0001-unified-task-registry.md`.

Scope of the change:

- `docs/tasks/README.md` as canonical policy for where work lives and how it moves.
- Six ExecPlans and four tech-debt rows migrated into tasks `T-0001` through `T-0010`, with
  `git mv` so history follows the files.
- `tasks-check` and `tasks-index` commands, wired into `quality` so CI enforces the schema.
- `agent-skills-sync` and `agent-skills-check`, which mirror `.agents/skills` into `.claude/skills`
  and fail when the two drift.
- A `task-registry` skill in `.agents/skills/`, so an agent applies the workflow rather than merely
  being able to read about it.

## Progress

- [x] (2026-08-13) Canonical policy written to `docs/tasks/README.md`.
- [x] (2026-08-13) Six ExecPlans migrated with `git mv`; headings in `T-0003` normalised to the
      canonical section names and relative links to `docs/PLANS.md` repointed.
- [x] (2026-08-13) Four tech-debt rows migrated to `T-0007` through `T-0010`, preserving owner and
      exit criteria; `docs/exec-plans/` retired.
- [x] (2026-08-13) `ADR-0001` records the decision and its accepted costs.
- [x] (2026-08-13) Registry validator and index generator implemented with unit tests.
- [x] (2026-08-13) `task-registry` skill authored in `.agents/skills/` with templates and decision
      guidance, and mirrored into `.claude/skills/`.
- [x] (2026-08-13) Skill sync script implemented with tests. Repairing the mirror copied 37 files:
      the five skills that existed only in `.agents`, the reference and agent subdirectories missing
      from two more, and the new skill.
- [x] (2026-08-13) `AGENTS.md`, `docs/PLANS.md` and `docs/ARCHITECTURE.md` updated to the new
      layout; `ARCH-G06` marked resolved.
- [x] (2026-08-13) Local gates run: `tasks-check`, `agent-skills-check`, `format-check`, `lint`,
      `types`, and the new unit tests.
- [x] (2026-08-13) Merged `main` after `#25` landed a new ExecPlan and a new tech-debt row while
      this change was in review. Both migrated in the same shape as the rest: the plan became
      `T-0013` and the debt row became `T-0014`, and `docs/exec-plans/` is retired again. This is
      the migration working as intended rather than a one-off — anything still arriving in the old
      layout gets converted on the way in.

## Decision Log

- Decision: Make status a front matter field and never move task files between directories.
  Rationale: The repository is worked on across many parallel `claude/*` branches. Directory-based
  status means every status change is a `git mv`, which breaks inbound links, churns rename history,
  and conflicts when two branches move the same file. A front matter field is a one-line edit that
  merges cleanly. The cost is that status is no longer visible from `ls`, which the generated
  `INDEX.md` repays.
  Date/Author: 2026-08-13.

- Decision: Fold ExecPlans into the registry as a `depth` rather than keeping them as a parallel
  system.
  Rationale: Two systems means two places to look and two things to keep in sync, which is exactly
  the drift `ARCH-G06` describes. Making `execplan` a depth keeps one spine while preserving
  everything `docs/PLANS.md` requires of a large plan — the validator enforces the heavier section
  set for that depth.
  Date/Author: 2026-08-13.

- Decision: Write a minimal YAML front matter parser instead of adding a YAML dependency.
  Rationale: The repository has no YAML parser in `package.json`, and adding a runtime dependency to
  a documentation-lint script is a poor trade. The schema only uses scalars and inline lists. The
  parser rejects anything it does not understand rather than guessing, so a mis-parse surfaces as a
  validation failure instead of silently wrong data in the index.
  Date/Author: 2026-08-13.

- Decision: Generate `INDEX.md` with Prettier-compatible column padding rather than adding it to
  `.prettierignore`.
  Rationale: The repository does exempt generated files from formatting, so the exemption was
  available. But an exempt file drifts invisibly, and the index is the file agents read first.
  Padding each column to its widest cell is what Prettier does anyway, so matching it costs a few
  lines in the renderer and keeps the file under the same gate as everything else.
  Date/Author: 2026-08-13.

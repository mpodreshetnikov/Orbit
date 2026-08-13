---
id: T-0015
title: Give the task-registry skill the authoring, lifecycle and deduplication practice it lacked
status: done
kind: docs
priority: p2
depth: note
created: 2026-08-13
updated: 2026-08-13
owner: TBD
tags: [agents, skills, process, tasks]
---

# Give the task-registry skill the authoring, lifecycle and deduplication practice it lacked

## Context

As shipped in `T-0011`, `.agents/skills/task-registry/SKILL.md` described the _mechanics_ of the
registry — which fields exist, which commands to run, which sections a depth requires — and almost
none of the _judgement_. An agent following it could produce a schema-valid task that was useless:
a title naming an activity rather than an outcome, a Context grounded in nothing, no falsifiable
end, and no check that three other tasks already covered the same ground.

That gap has a specific cost. `tasks-check` validates shape, so a badly formed task passes CI and
lands on the board looking exactly as authoritative as a good one. The registry then degrades in the
way trackers usually do: overlapping entries nobody reconciles, `in-progress` items that stalled
months ago, and debt whose exit condition is a sentence nobody can evaluate.

This task adds the practice the schema cannot enforce, in three reference files plus a condensed
form in the skill body itself.

## Progress

- [x] (2026-08-13) `references/authoring-tasks.md` — what a good task looks like, the five Ready
      Checkpoints, grounding a request in the code before asking anything, the vague-idea pipeline
      with a worked example, which questions are worth the user's attention, and six anti-patterns.
- [x] (2026-08-13) `references/lifecycle-and-checks.md` — the state machine, the allowed transitions
      with their preconditions, per-transition checklists, `kind` and `depth` changes, why `done` is
      terminal, and routine sanity checks over the board.
- [x] (2026-08-13) `references/relationships.md` — searching on three axes before creating, the
      overlap classification table, avoiding two `in-progress` tasks over the same files, splitting,
      superseding, keeping cross-references honest, and reconciling registry-versus-code drift.
- [x] (2026-08-13) `SKILL.md` — Ready Checkpoints, the transition table, and the duplication test
      inlined in condensed form; trigger description widened to fire on authoring and status
      changes; references section updated.
- [x] (2026-08-13) `docs/tasks/README.md` — the terminal-`done` rule and the `kind`-change guardrail
      added, since those are policy rather than workflow.
- [x] (2026-08-13) Mirrored into `.claude/skills/`; `tasks-check`, `agent-skills-check`,
      `format-check`, `lint`, `types` and the unit lane all green.

## Decision Log

- Decision: Put the detail in `references/` and keep only condensed checkpoints and the transition
  table in `SKILL.md`.
  Rationale: `SKILL.md` is loaded in full every time the skill triggers, while `references/` files
  are read on demand. Inlining all three topics would roughly quadruple the always-loaded body for
  material that matters at a few specific moments. The split keeps the fast path cheap while making
  the depth available exactly when an agent is authoring or moving a task. This matches how
  `issue-investigation` and `full-stack-traceability` are already organised in this repo.
  Date/Author: 2026-08-13.

- Decision: Use the real `T-0013` near-duplicate as the worked example rather than a synthetic one.
  Rationale: The example teaches the most valuable behaviour in the whole skill — that the correct
  output of "the import is slow, do something" is usually _not a new task_, because `T-0013` already
  covers it. A synthetic example would have demonstrated the mechanics without the discomfort of
  concluding "create nothing", which is precisely the conclusion agents avoid. Using real ids also
  means the example stays checkable against the tree.
  Date/Author: 2026-08-13.

- Decision: Define duplicate-versus-separate by the exit condition, not by subject matter.
  Rationale: Subject overlap is a bad test — `T-0013` and `T-0014` share the money domain and some
  files yet fail independently, so merging them would have hidden the debt behind a plan whose
  milestones never mention it. Asking "would satisfying one exit also satisfy the other" gives a
  mechanical answer that does not depend on how the two happen to be worded.
  Date/Author: 2026-08-13.

- Decision: Make `done` terminal and forbid reopening, recording the rule in
  `docs/tasks/README.md` rather than only in the skill.
  Rationale: Reopening rewrites the record of what was believed delivered and when, which is the
  evidence needed to diagnose a regression. A successor task referencing the original preserves
  both. This is policy about the lifecycle, so the canonical statement belongs in the README under
  the repository's DRY rule, with the skill carrying the applied checklist.
  Date/Author: 2026-08-13.

- Decision: Write the new material in English, though the request was in Russian.
  Rationale: All eighteen other skills in `.agents/skills/`, `AGENTS.md` and every file under `docs/`
  except `T-0013` are English, and the skill is read by agents alongside those documents. A
  Russian-language skill would be the only one, and mixed-language instruction files make it harder
  to keep terminology consistent with the schema's English enums. Easy to revisit if a
  Russian-language house style is adopted.
  Date/Author: 2026-08-13.

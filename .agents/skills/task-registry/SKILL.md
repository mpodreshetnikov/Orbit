---
name: task-registry
description: Track and shape work in the repository task registry under docs/tasks — tasks, ideas, bugs, tech debt, and the reasoning behind decisions. Use at the start of any non-trivial task to find existing work and prior decisions, while working to record progress and decisions, and at the end to close the task out. Also use when writing or refining a task, turning a vague idea or feature request into an executable one, deciding whether something is a duplicate of existing work, changing a task's status, capturing an idea for later, recording tech debt, writing or updating an ExecPlan, or answering what is currently open, in progress, or already decided.
---

# Task Registry

All work in this repository is tracked as one Markdown file per unit of work under `docs/tasks/`.
Canonical policy — the full schema, lifecycle and rationale — is `docs/tasks/README.md`. This skill
is the workflow and the judgement to apply on top of it.

## Mandatory Trigger

Apply this skill whenever a task:

- starts any work beyond a trivial one-line change,
- writes, refines, or accepts a task, idea or feature request,
- makes a decision that was not forced,
- discovers debt, a defect, or an idea worth keeping,
- changes any task's status,
- writes or updates an ExecPlan,
- or asks what is open, in progress, or already settled.

Trivial changes — a typo, a formatting fix — do not need a task. Work whose reasoning should outlive
it does.

## Required Workflow

### 1. Orient before touching code

1. Read `docs/tasks/INDEX.md`. It is generated, one screen, and lists every task with status.
2. Search `docs/tasks/` for the subject on three axes — domain noun, file path, tag — including
   `done` and `dropped` tasks. See `references/relationships.md`.
3. If a task already covers the work, use it. If a Decision Log or an ADR already settled the
   question, follow it — or append a superseding decision explaining why it no longer holds. Never
   silently re-litigate a recorded decision.

### 2. Claim or create

- Existing task: set `status: in-progress` and update `updated` **before** editing code, so a
  parallel agent sees the claim.
- New task: take the highest `T-` number, add one, and create `docs/tasks/T-NNNN-<slug>.md` from
  `references/task-template.md`. It must pass the Ready Checkpoints below.
- Capturing an idea rather than starting it: create the file with `status: idea` and stop. That is
  the cheap path, and it is the point of the registry.

### 3. Work

- Append a UTC-dated checkbox to `## Progress` at every stopping point. Split a partly done step
  into what is done and what remains rather than leaving it ambiguous.
- Append to `## Decision Log` as decisions are made, not afterwards from memory.
- Keep `updated` current.

### 4. Close

1. Set the final status against the checks in `references/lifecycle-and-checks.md`.
2. For `depth: execplan`, fill `## Outcomes & Retrospective`.
3. Update tasks that reference this one or are unblocked by it.
4. Run `tasks-index`, then `tasks-check`, and fix anything reported.

## Ready Checkpoints

Before a task leaves `idea` for `open`, all five must hold. Detail and worked examples in
`references/authoring-tasks.md`.

1. **Outcome** — the title states a change in the world, not an activity. `Let users revoke
   connected MCP clients from settings`, not `Fix MCP stuff` or `Investigate revoke`.
2. **Grounding** — Context names at least one real path, symbol or table that exists in the tree
   right now.
3. **Observable** — there is a way to see it is done that a human could perform. For `kind: debt`
   this is the mandatory `exit` field.
4. **Bounded** — not open-ended. "Raise coverage" fails; "DB mapping above 50%" passes.
5. **Non-overlapping** — the registry was searched and nothing already covers this.

Ground the request in the code **before** asking the user anything: search the registry, search the
code for the named surface, check `git log` for the area, check `ARCH-Gxx` gaps in
`docs/ARCHITECTURE.md`, and check `docs/tasks/decisions/`. Most ambiguity dissolves on contact with
the tree.

Then ask only what genuinely changes the work — an observable outcome when none is implied, a scope
boundary against an obvious neighbour, a constraint you cannot see. Batch the questions, propose a
default for each, and record the answers in Context or the Decision Log. Do not ask about
implementation details you should decide, anything discoverable in the code, or whether to create
the task.

## Status Transitions

Anything not listed is not a transition. Full per-transition checklists in
`references/lifecycle-and-checks.md`.

| From → To | Requires |
| --- | --- |
| `idea` → `open` | All five Ready Checkpoints |
| `open` → `in-progress` | Overlap re-checked; no other `in-progress` task owns the same files |
| `in-progress` → `blocked` | A fix was **attempted**, and `blocked_by` names a concrete external blocker |
| `blocked` → `in-progress` | Progress records what unblocked it |
| `in-progress` → `done` | Acceptance actually observed, evidence stated, Progress final, referencing tasks updated |
| `in-progress` → `open` | Progress splits what shipped from what remains |
| any → `dropped` | Decision Log entry saying why; `superseded_by` if replaced |

**`done` is terminal.** If the work regressed or proved incomplete, create a new task referencing the
old one. Never reopen — the old record of what was believed done is the evidence needed to
understand the regression.

**Never change `kind` to escape a gate.** Flipping `debt` → `chore` to avoid writing an `exit`
condition removes the only thing that made the debt closeable.

## Avoiding Duplication

The test for duplicate versus separate is the **exit condition**, not the subject: if satisfying one
task's exit would also satisfy the other's, they are duplicates — add to the existing task instead of
creating one. Shared domain and even shared files are not enough to merge two tasks.

Two `in-progress` tasks must not own the same files. If they would, sequence them and say so in
Progress, narrow one so the file sets are disjoint, or fold them into one.

When you close a task, `grep -rn "T-NNNN" docs/tasks/` and update whatever referenced it. Stale
cross-references are worse than none. See `references/relationships.md`.

## Front Matter At A Glance

Required on every task: `id`, `title`, `status`, `kind`, `priority`, `depth`, `created`, `updated`,
`owner`. Optional: `tags`, `superseded_by`.

- `status`: `idea`, `open`, `in-progress`, `blocked`, `done`, `dropped`
- `kind`: `feature`, `bug`, `debt`, `chore`, `spike`, `docs`
- `priority`: `p0`, `p1`, `p2`, `p3`
- `depth`: `note` (Context, Progress, Decision Log) or `execplan` (must satisfy `docs/PLANS.md`)

Conditionally required, and enforced: `exit` when `kind: debt`, `blocked_by` when `status: blocked`.

## Recording Decisions

Record a decision whenever a choice was not forced — a library picked over an alternative, a shape
rejected, a shortcut deliberately taken. Use the `docs/PLANS.md` format:

    - Decision: …
      Rationale: …
      Date/Author: …

Decision Logs are append-only. Correct a past decision by appending one that supersedes it, never by
editing the original — the old reasoning is the evidence for why the new one was needed.

Promote a decision to an ADR under `docs/tasks/decisions/` when it constrains work beyond its own
task. See `references/decision-records.md`.

## Guardrails

- Never delete a task file. `dropped` with a reason is history; deletion is amnesia.
- Never hand-edit `docs/tasks/INDEX.md`. It is generated; run `tasks-index`.
- Never move a task file to express status. Status is front matter; files stay put.
- Never write `blocked` without a concrete external blocker, and never before attempting a fix.
- Never record `done` for work that was not verified. Say what was run and what it showed.
- Never create a task without searching the registry first.
- Do not create a second tracker. If something has no place in the schema, extend
  `docs/tasks/README.md` and the validator rather than starting a parallel list.

## Final Report Contract

When a task touched the registry, state in the final response:

- `task`: the task id worked in.
- `status`: its status now.
- `decisions`: count of Decision Log entries added, and any ADR created.
- `checks`: result of `tasks-check`.

## References

- `docs/tasks/README.md`: canonical schema, lifecycle, and rationale.
- `docs/PLANS.md`: how to write an ExecPlan body, required for `depth: execplan`.
- `references/authoring-tasks.md`: what a good task looks like, grounding in code, turning a vague
  idea into a task with a worked example, what to ask the user, anti-patterns.
- `references/lifecycle-and-checks.md`: the state machine, per-transition checklists, changing
  `kind` and `depth`, reopening, routine sanity checks.
- `references/relationships.md`: searching before creating, resolving overlap, splitting,
  superseding, keeping cross-references honest, registry-versus-code drift.
- `references/task-template.md`: copy-paste templates for both depths.
- `references/decision-records.md`: when a decision becomes an ADR, and the ADR template.

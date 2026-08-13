# Task Registry

This document is the canonical policy for how work is tracked in this repository. Every unit of
work — a feature, a bug, a piece of debt, a chore, a spike, or a raw idea — is one Markdown file
under `docs/tasks/`. There is no second place to look.

`docs/PLANS.md` remains canonical for _how to write_ the body of a large plan. This document is
canonical for _where work lives, what its metadata means, and how it moves_.

## Why A Registry

An agent starting a task needs three answers before it writes a line of code: is someone already
doing this, has this already been decided, and what did we learn last time. Commit messages and pull
request threads cannot answer those questions — they are ordered by time, not by subject, and they
are invisible to a fresh agent with only a working tree. The registry answers all three from files
in the repo, so a stateless agent can recover full context by reading.

## Layout

    docs/tasks/
      README.md                  canonical policy (this file)
      INDEX.md                   generated board — never edit by hand
      T-0001-<slug>.md           one file per unit of work
      decisions/
        ADR-0001-<slug>.md       decisions that outlive any single task

Task files never move. Status lives in front matter, so changing status is a one-line edit rather
than a `git mv`. That keeps inbound links stable and keeps `git log --follow` unnecessary.

## Front Matter Schema

Every task file starts with a YAML front matter block. Fields:

| Field           | Required               | Value                                                           |
| --------------- | ---------------------- | --------------------------------------------------------------- |
| `id`            | yes                    | `T-` plus four digits. Unique. Must match the filename prefix.  |
| `title`         | yes                    | Short imperative sentence. No trailing period.                  |
| `status`        | yes                    | `idea`, `open`, `in-progress`, `blocked`, `done`, or `dropped`. |
| `kind`          | yes                    | `feature`, `bug`, `debt`, `chore`, `spike`, or `docs`.          |
| `priority`      | yes                    | `p0`, `p1`, `p2`, or `p3`.                                      |
| `depth`         | yes                    | `note` or `execplan`. Decides which body sections are required. |
| `created`       | yes                    | `YYYY-MM-DD`.                                                   |
| `updated`       | yes                    | `YYYY-MM-DD`. Never earlier than `created`.                     |
| `owner`         | yes                    | Name or `TBD`.                                                  |
| `tags`          | no                     | List of lowercase slugs, for grep and for the index.            |
| `exit`          | when `kind: debt`      | The condition under which the debt is considered repaid.        |
| `blocked_by`    | when `status: blocked` | Concrete external blocker. Never a vague "waiting".             |
| `superseded_by` | no                     | Task id that replaced this one.                                 |

`exit` and `blocked_by` are conditionally required on purpose. Debt without an exit condition is a
complaint, and a blocked task without a named blocker is an excuse — the same rule the
`relevant-quality-checks` skill applies to quality gates.

## Status Lifecycle

- `idea` — captured, not yet accepted. Cheap to write, and the point of the registry: ideas stop
  evaporating into chat logs.
- `open` — accepted, not started.
- `in-progress` — actively being worked. Set this _before_ editing code, so a parallel agent sees it.
- `blocked` — cannot proceed for a named external reason in `blocked_by`.
- `done` — delivered and verified.
- `dropped` — deliberately not doing it. Record why in the Decision Log.

Never delete a task file. `dropped` with a reason is history; deletion is amnesia.

`done` is terminal. If the work regressed or turned out to be incomplete, create a new task whose
Context references the old one and says what it missed — never move a task back out of `done`. The
old record of what was believed delivered, and when, is exactly the evidence needed to understand the
regression, and editing it away destroys that. The single exception is correcting an error in the
record itself, which is done by appending a Decision Log entry noting the correction.

`kind` may change when the nature of the work genuinely changes — a `bug` deliberately deferred
becomes `debt`, a `spike` that answered its question hands off to a `feature`. It must never be
changed to escape a gate: flipping `debt` to `chore` to avoid writing an `exit` condition removes the
only thing that made the debt closeable, and the validator's silence is not agreement.

The `task-registry` skill carries the per-transition checklists an agent applies on top of these
rules.

## Depth: Note Or ExecPlan

`depth` picks how much structure the body owes.

`note` is the default and fits most work. Required sections:

    ## Context
    ## Progress
    ## Decision Log

`execplan` is for multi-hour features and significant refactors, where a novice agent must be able
to restart from the file alone. The body must satisfy `docs/PLANS.md` in full. Required sections:

    ## Purpose / Big Picture
    ## Progress
    ## Surprises & Discoveries
    ## Decision Log
    ## Outcomes & Retrospective

`docs/PLANS.md` describes further sections — `Context and Orientation`, `Plan of Work`,
`Concrete Steps`, `Validation and Acceptance`, `Idempotence and Recovery`, `Artifacts and Notes`,
`Interfaces and Dependencies` — that a good ExecPlan also carries. Those are strongly recommended
and not machine-enforced, because a plan mid-draft should not fail the build.

Promote a `note` to an `execplan` by adding the missing sections and changing `depth`. That is the
only supported direction; an ExecPlan never shrinks back to a note, because its history matters.

## Recording Decisions

Decisions are the part that agents most often lose, so they get their own rules.

Record a decision in the task's `## Decision Log` whenever a choice was not forced — a library
picked over an alternative, a shape rejected, a shortcut deliberately taken. Use this format, which
matches `docs/PLANS.md`:

    - Decision: …
      Rationale: …
      Date/Author: …

Decision Log entries are append-only. Correct a past decision by appending a new entry that
supersedes it, never by editing the old one. The old reasoning is the evidence for why the new one
was needed.

Promote a decision to an Architecture Decision Record under `docs/tasks/decisions/` when it
constrains work beyond its own task — a convention every future contributor must follow, a
dependency the repo now depends on, or a boundary that must not be crossed. ADRs use the same front
matter shape with an `ADR-` prefix and carry `## Context`, `## Decision`, and `## Consequences`.
Link the ADR from the originating task.

## How Agents Use This

At the start of a task:

1. Read `docs/tasks/INDEX.md`. It is one screen and shows every open item.
2. Grep `docs/tasks/` for the subject before starting. If a task exists, work in it. If a decision
   already settled the question, follow it or write a superseding decision — do not silently
   re-litigate it.
3. If nothing matches, create a task file and set `status: in-progress` before editing code.

While working, append to `## Progress` at every stopping point with a UTC-dated checkbox, and append
to `## Decision Log` as decisions are made. Keep `updated` current.

At the end, set the final status, fill `## Outcomes & Retrospective` for an ExecPlan, run
`tasks-index` to regenerate the board, and run `tasks-check`.

The `task-registry` skill in `.agents/skills/task-registry/` carries this workflow in the form an
agent applies directly.

## Allocating Ids

Take the highest existing `T-` number and add one. Two branches created in parallel can pick the
same id; `tasks-check` fails on duplicates at merge time, and the branch merging second renumbers.
Ids are never reused, including by dropped tasks.

## Commands

Command ids are registered in `AGENTS.md`:

- `tasks-index` — regenerate `docs/tasks/INDEX.md` from the task files.
- `tasks-check` — validate front matter, ids, required sections, and index freshness. Runs inside
  `quality`, so it gates CI.
- `quality-tasks` — the static checks that apply when a change touches nothing outside
  `docs/tasks/`: the registry, the skill mirror, and formatting.

CI detects a change confined to this directory and runs `quality-tasks` in place of the full gate,
skipping the build, end-to-end, unit and coverage lanes. Editing a task is therefore cheap. Note the
consequence: a change that touches one file outside `docs/tasks/` takes the full path, so a task
update bundled into a code change is gated exactly as the code is.

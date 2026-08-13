---
id: ADR-0001
title: Track all work in one file-per-task registry under docs/tasks
status: accepted
date: 2026-08-13
tasks: [T-0011]
---

# Track all work in one file-per-task registry under docs/tasks

## Context

Work in this repository was tracked in three places that did not know about each other.
`docs/exec-plans/todo|done/` held large ExecPlans governed by `docs/PLANS.md`.
`docs/exec-plans/tech-debt-tracker.md` held a Markdown table of debt. Everything else — small fixes,
ideas, and the reasoning behind decisions taken outside a plan — was tracked nowhere, and survived
only in commit messages and pull request threads.

That last category is the expensive one. A fresh agent starts with a working tree and nothing else.
It cannot read a pull request thread, so a decision recorded only there is a decision that will be
re-litigated, and an idea mentioned only there is an idea that is lost. Decision Logs did exist, but
only _inside_ ExecPlans, so a decision made outside a plan had no home at all.

`docs/ARCHITECTURE.md` had already recorded this as gap `ARCH-G06`: "Documentation map drift in
rules/plans locations… `AGENTS.md` references `docs/PLANS.md/` while planning content is split across
`docs/PLANS.md` and `docs/exec-plans/`."

Two properties of how this repository is actually worked on shaped the answer. Development happens
on many parallel `claude/*` branches, so any single shared file that every task must edit becomes a
merge-conflict magnet. And plans here are large — several exceed five hundred lines — so an agent
cannot afford to read every plan just to learn what is currently open.

## Decision

All work lives in `docs/tasks/`, one Markdown file per unit of work, named `T-NNNN-<slug>.md`, with
metadata in YAML front matter and status recorded there rather than by directory. Files never move.
`docs/tasks/INDEX.md` is generated from the front matter and is the cheap read that answers "what is
open right now".

ExecPlans are not a separate system. They are a `depth` of task: `depth: execplan` means the body
must satisfy `docs/PLANS.md`, and `depth: note` means it needs only Context, Progress and a Decision
Log. `docs/PLANS.md` stays canonical for how to write an ExecPlan body; it is no longer canonical for
where plans live.

Decisions are recorded in each task's append-only `## Decision Log`, and promoted to an ADR under
`docs/tasks/decisions/` when they constrain work beyond their own task.

`scripts/just/tasks-check.cjs` validates the schema, ids, required sections and index freshness, and
runs inside `quality`, so CI enforces it.

## Consequences

A stateless agent can now recover the full state of the project by reading `docs/tasks/INDEX.md` and
then grepping `docs/tasks/`, and it can find out why something was done without reading git history.
Ideas and small tasks have a home, which is the gap that previously leaked most.

Status changes are a one-line front matter edit rather than a `git mv`, so links stay valid and
history stays readable. Because each task is its own file, two agents working in parallel do not
conflict — except on `INDEX.md`, which is generated and therefore safe to regenerate on either side
of a conflict rather than merged by hand.

The costs are real and accepted. Sequential ids can collide when two branches allocate at once; the
validator catches duplicates at merge and the second branch renumbers. `docs/exec-plans/` is gone,
so links to those paths from outside the repository break — the content moved with `git mv`, so
history follows the files. And every unit of work now costs one file, which is heavier than a line in
a table for genuinely trivial changes; the guidance is that trivial changes do not need a task at
all, only work whose reasoning should outlive it.

`ARCH-G06` is resolved by this change.

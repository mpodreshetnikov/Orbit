# Task Templates

Copy the block that matches the depth, save it as `docs/tasks/T-NNNN-<slug>.md`, then run
`tasks-index`. Templates are shown as indented blocks so they can be copied without fence nesting.

The slug is lowercase words joined by dashes and should read like the title, not restate the id.

## Note Depth

The default. Use it for anything a competent contributor could pick up from a paragraph of context.

    ---
    id: T-0012
    title: Short imperative title with no trailing period
    status: open
    kind: feature
    priority: p2
    depth: note
    created: 2026-08-13
    updated: 2026-08-13
    owner: TBD
    tags: [area, subsystem]
    ---

    # Short imperative title with no trailing period

    ## Context

    What is true today, why this matters, and what someone can do afterwards that they cannot do
    now. Name files by full repository-relative path. Assume the reader has the working tree and
    nothing else.

    ## Progress

    - [ ] First concrete step.

    ## Decision Log

    - Decision: …
      Rationale: …
      Date/Author: …

## Debt

Same as note depth, plus a required `exit` — the condition under which the debt is repaid. Debt
without a falsifiable exit condition is a complaint, and the validator rejects it.

    ---
    id: T-0013
    title: Short imperative title
    status: open
    kind: debt
    priority: p2
    depth: note
    created: 2026-08-13
    updated: 2026-08-13
    owner: TBD
    tags: [area]
    exit: "The measurable condition under which this debt is considered repaid"
    ---

## Blocked

A blocked task requires `blocked_by` naming a concrete external blocker. "Waiting" is not a blocker,
and nothing may be called blocked before a fix has been attempted.

    status: blocked
    blocked_by: "Upstream provider returns 500 on the batch endpoint; ticket ACME-4821 open"

## ExecPlan Depth

For multi-hour features and significant refactors, where a novice holding only the working tree and
this one file must be able to deliver the work. The body must satisfy `docs/PLANS.md` in full — read
that file before writing one.

The validator enforces the five sections below. `docs/PLANS.md` describes further sections —
`Context and Orientation`, `Plan of Work`, `Concrete Steps`, `Validation and Acceptance`,
`Idempotence and Recovery`, `Artifacts and Notes`, `Interfaces and Dependencies` — that a good
ExecPlan also carries; they are strongly recommended and not machine-enforced, so a plan mid-draft
does not fail the build.

    ---
    id: T-0014
    title: Short action-oriented description
    status: in-progress
    kind: feature
    priority: p1
    depth: execplan
    created: 2026-08-13
    updated: 2026-08-13
    owner: TBD
    tags: [area]
    ---

    # Short action-oriented description

    This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
    `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

    This document must be maintained in accordance with [`docs/PLANS.md`](../PLANS.md) from the
    repository root.

    ## Purpose / Big Picture

    What someone gains after this change and how they can see it working.

    ## Progress

    - [x] (2026-08-13) Example completed step.
    - [ ] Example incomplete step.

    ## Surprises & Discoveries

    - Observation: …
      Evidence: …

    ## Decision Log

    - Decision: …
      Rationale: …
      Date/Author: …

    ## Outcomes & Retrospective

    What was achieved, what remains, and lessons learned, compared against the original purpose.

    ## Context and Orientation

    ## Plan of Work

    ## Concrete Steps

    ## Validation and Acceptance

    ## Idempotence and Recovery

    ## Artifacts and Notes

    ## Interfaces and Dependencies

## Promoting A Note To An ExecPlan

Add the missing sections and change `depth` to `execplan`. This is the only supported direction. An
ExecPlan never shrinks back to a note, because its accumulated history is the reason it is valuable.

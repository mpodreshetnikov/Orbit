# Decision Records

Most decisions belong in the originating task's `## Decision Log`. A few outgrow it and become an
Architecture Decision Record under `docs/tasks/decisions/`.

## Which One

Keep it in the task's Decision Log when the decision explains that task and nothing else — why a
particular query shape was chosen, why a shortcut was taken here, why an alternative was rejected
for this feature.

Promote it to an ADR when the decision constrains work beyond its own task:

- it establishes a convention future contributors must follow,
- it commits the repository to a dependency, a boundary, or a data shape,
- it forbids something that would otherwise look reasonable,
- or a future contributor would waste real time rediscovering why the obvious approach fails.

The test is whether someone who never reads the originating task still needs to know. If yes, write
the ADR. Link it from the task, and keep the task's Decision Log entry as a one-line pointer rather
than a copy — the same DRY rule `AGENTS.md` applies to policy text.

## Writing One

Take the highest `ADR-` number and add one. Save as
`docs/tasks/decisions/ADR-NNNN-<slug>.md`. `tasks-check` validates the schema, and every id in
`tasks` must exist.

    ---
    id: ADR-0002
    title: Short statement of the decision, not the problem
    status: accepted
    date: 2026-08-13
    tasks: [T-0014]
    ---

    # Short statement of the decision, not the problem

    ## Context

    What forces made this decision necessary. State the constraints honestly, including the ones
    that made the obvious alternative unattractive. Someone reading this in a year has no memory of
    the discussion.

    ## Decision

    What was decided, in the present tense and as an instruction: "All X live in Y", not "we thought
    it might be good to put X in Y".

    ## Consequences

    What follows — the good and the costs. Name the costs explicitly and say they were accepted.
    An ADR that lists only benefits is marketing, and the next contributor will not trust it.

`status` is `proposed`, `accepted`, or `superseded`.

## Superseding

Never edit an accepted ADR's Context or Decision to reflect a new choice. Write a new ADR, set the
old one's `status` to `superseded`, and add `supersedes: [ADR-0001]` to the new one. The original
reasoning is the evidence for why the change was needed; overwriting it destroys that.

Title the new record after what is now true, not after the change: "Task ids are date-prefixed", not
"Change task id format".

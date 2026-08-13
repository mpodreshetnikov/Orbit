# Lifecycle And Transition Checks

Which status changes are legitimate, and what must be true before each one. `tasks-check` enforces
the schema; this file covers the part it cannot see.

## The State Machine

              ┌──────────────────────────────┐
              │                              ▼
    idea ──► open ──► in-progress ──► done   │
      │        │         │   ▲               │
      │        │         ▼   │               │
      │        │      blocked┘               │
      │        │         │                   │
      ▼        ▼         ▼                   │
    dropped ◄──────────────────────────────  ┘
              (done ──► dropped is not a transition; see Reopening)

Every arrow below is allowed. Anything not listed is not — in particular nothing leaves `done`.

| From → To | Means | Must be true first |
| --- | --- | --- |
| `idea` → `open` | Accepted for work | All five Ready Checkpoints in `authoring-tasks.md` |
| `idea` → `dropped` | Considered, declined | Decision Log entry saying why |
| `open` → `in-progress` | Claimed | Registry searched for overlap; no other `in-progress` task owns the same files |
| `open` → `dropped` | No longer wanted | Decision Log entry; `superseded_by` if something replaced it |
| `in-progress` → `blocked` | Cannot proceed | `blocked_by` names a concrete external thing, **and** a fix was attempted first |
| `blocked` → `in-progress` | Unblocked | Progress records what unblocked it; `blocked_by` removed |
| `blocked` → `dropped` | Blocker is permanent | Decision Log entry naming the blocker as permanent |
| `in-progress` → `done` | Delivered | The Done checklist below, in full |
| `in-progress` → `open` | Released without finishing | Progress splits what is done from what remains; `status` back to `open` so someone else can claim it |

## Per-Transition Checks

### → `open`

- Title is an outcome, not an activity.
- Context names at least one real path or symbol that exists in the tree.
- `exit` is present and falsifiable when `kind: debt`.
- No existing task already covers it (`relationships.md`).

### → `in-progress`

Set this **before** editing code — the claim is the point.

- Re-read the task: it may have been written weeks ago against a different tree.
- Re-check overlap. Another agent may have claimed the same surface since the task was filed.
- Re-check the Decision Log and any linked ADR — the constraints may have changed under it.
- Update `updated`.

### → `blocked`

`blocked` is the most abused status, so it has the strictest bar.

- A fix was **attempted**. Nothing may be called blocked before trying.
- The blocker is **external** — something you cannot resolve. Waiting on your own next step is not
  blocked, it is in progress.
- `blocked_by` names it concretely, with a ticket, error or dependency. "Waiting on upstream" is not
  a blocker; "provider returns 500 on the batch endpoint, ticket ACME-4821" is.
- Progress records what was tried, so the next person does not repeat it.

This mirrors the rule the `relevant-quality-checks` skill applies to failing gates.

### → `done`

The strictest transition, because a wrong `done` is a lie the board keeps telling.

1. **Acceptance observed.** The outcome in Context was actually exercised — commands run, output
   seen. Not "the code looks right".
2. **Evidence stated.** Progress says what was run and what it showed. If something could not be
   verified, say that instead of implying it passed.
3. **Progress is final.** No unchecked box that silently did not happen. Split partly-done items
   into what shipped and what remains, and move the remainder to a new task rather than leaving it
   checked.
4. **Decision Log complete.** Every non-forced choice made along the way is recorded, and anything
   with repo-wide reach is promoted to an ADR.
5. **`Outcomes & Retrospective` filled**, for `depth: execplan`.
6. **Related tasks updated.** Anything referencing this one, or unblocked by it, is touched too —
   see `relationships.md`.
7. **`tasks-index` run, `tasks-check` green.**

### → `dropped`

- Decision Log says why, in enough detail that nobody re-proposes it next quarter.
- `superseded_by` set if another task replaces it.
- The file stays. Deleting it destroys the reason.

## Reopening

**A `done` task is never reopened.** If the work regressed or proved incomplete, create a new task
whose Context references the old one and says what the old one missed. The old task's record of what
was believed done, and when, is exactly the evidence needed to understand the regression — editing it
away destroys that.

The one exception is correcting an error in the record itself: a wrong date, a typo, a Progress line
that misstates what happened. Correct it, and append a Decision Log entry noting the correction.

## Changing `kind`

`kind` rarely changes, and when it does it is usually a signal worth recording.

| Change | Legitimate when | Requires |
| --- | --- | --- |
| `bug` → `debt` | The defect is real but deliberately not being fixed now | An `exit` condition, and a Decision Log entry explaining the deferral |
| `spike` → `feature`/`bug` | The spike answered its question and the real work is now known | Usually a **new** task carrying the finding, leaving the spike `done` |
| `chore` → `debt` | The cleanup turned out to have a correctness consequence | An `exit` condition |
| `feature` → `spike` | Feasibility turned out to be unknown | Scope narrowed to the question being answered |

Never change `kind` to escape a gate. Flipping `debt` → `chore` to avoid writing an `exit` condition
removes the only thing that made the debt closeable, and the validator's silence is not agreement.

## Changing `depth`

`note` → `execplan` is the only supported direction: add the sections `docs/PLANS.md` requires and
change the field. Do this when the work grows past what a paragraph of context can carry — typically
when it needs milestones a novice could follow independently.

An `execplan` never shrinks back to a `note`. Its accumulated Surprises, Decision Log and Outcomes
are the reason it is valuable, and the heavier section set is what keeps them.

## Routine Sanity Checks

Cheap, and worth doing whenever you touch the registry:

- `tasks-check` — schema, ids, sections, cross-references, index freshness.
- Scan `INDEX.md` for tasks stuck `in-progress` with an old `updated` date. Either the work stalled
  or someone forgot to close it; both need action.
- Scan for `blocked` tasks whose blocker has since resolved.
- Check that `p0`/`p1` items are genuinely the most urgent. Priority inflation makes the field
  useless.

# Keeping Tasks Consistent With Each Other

A registry of twenty tasks that overlap is worse than no registry: it looks authoritative while
telling you the wrong thing. This file covers finding overlap before it happens, resolving it when it
does, and keeping tasks that reference each other honest.

## Search Before You Create

Creating a task without searching is the single most expensive mistake here, because the duplicate is
usually discovered only after someone has done half the work twice.

Search on three axes — any one alone misses cases:

- **By domain noun**, the word the code uses:
  `grep -ril "mcp_oauth\|money-import\|health-structure" docs/tasks/`
- **By file path** the work will touch. A task's Context names paths, so the path is greppable:
  `grep -rn "supabase/functions/money-categorize" docs/tasks/`
- **By tag and by eye.** Read `INDEX.md` — it is one screen. Tags cluster what the other two axes
  phrase differently.

Include `done` and `dropped` tasks in the search. A `done` task that describes exactly your problem
means either it regressed (new bug task, referencing the old) or you are about to redo it. A
`dropped` task means someone already decided not to — read why before overriding them.

## Resolving Overlap

Once you find a related task, classify the relationship before writing anything:

| Relationship | Signal | Do |
| --- | --- | --- |
| **Duplicate** | Same outcome, same surface | Do not create. Add the new information to the existing task |
| **Subset** | Your outcome is one part of theirs | Add it to their Progress. Split it out only if it ships and reviews independently |
| **Superset** | Their outcome is one part of yours | Create yours; reference theirs; decide whether theirs folds in or stays separate |
| **Sibling** | Same surface, different outcomes | Two tasks. Cross-reference in Context, because they will conflict in the same files |
| **Successor** | Yours replaces their approach | Create yours; set `superseded_by` on theirs; state in yours what changed |
| **Unrelated** | Shared vocabulary only | Nothing. Do not link tasks just because they share a word |

The judgement call is Duplicate versus Sibling. The test is the **exit condition**, not the subject
matter: if satisfying one task's exit would also satisfy the other's, they are duplicates. `T-0013`
(get receipt data in) and `T-0014` (is the categoriser's output correct) share the money domain and
even some files, and are siblings — closing either leaves the other's exit unmet.

## Do Not Let Two In-Progress Tasks Own The Same Files

Two agents claiming the same surface on different branches produces a merge conflict at best and
silently reverted work at worst.

Before moving a task to `in-progress`, check `INDEX.md` for other `in-progress` tasks and read their
Context for overlapping paths. If they overlap:

- Sequence them: leave yours `open` and note in Progress that it waits on the other task, naming it.
  This is not `blocked` — nothing external is blocking it, it is a deliberate ordering.
- Or narrow yours so the file sets are disjoint, and say so in Context.
- Or, if they cannot be separated, fold them into one task.

Record which you chose. The next agent should not have to rediscover that these two overlap.

## Splitting

Split when the Progress list contains items that ship independently and would be reviewed
separately — that is the same signal as "this should be more than one pull request".

- Keep the original as the umbrella when the pieces genuinely belong together; it stays `open` until
  the last child closes, and its Progress links the children.
- Drop the original with a pointer when the pieces have nothing to do with each other after all.

Do not split merely because a task is long. An ExecPlan with eleven milestones is one task with
eleven milestones — `T-0013` is exactly that.

## Superseding

When a task replaces another, set `superseded_by: T-NNNN` on the old one and move it to `dropped`
(or `done`, if it partly shipped). `tasks-check` verifies the target exists, so the pointer cannot
rot.

Say in the **new** task what the old one got wrong or missed. A pointer with no explanation tells the
next reader that the old approach was abandoned but not why, which is the part they need.

Never edit the old task's Context to describe the new approach. The old reasoning is the evidence for
why the change was needed.

## Keeping References Honest

Links between tasks go stale silently, which is worse than no link. Three moments to check:

1. **When you close a task**, grep for its id: `grep -rn "T-0013" docs/tasks/`. Anything referencing
   it may now be wrong, unblocked, or complete. Update those tasks in the same change.
2. **When a decision changes what another task must do**, append to *that* task's Decision Log a
   short entry pointing at the source. Do not leave a task carrying a plan that a decision elsewhere
   has already invalidated.
3. **When you write an ADR**, list every task it constrains in its `tasks:` field. The validator
   checks each id exists, so the linkage stays resolvable. Keep the task-side note to a pointer
   rather than a copy — the DRY rule in `AGENTS.md` applies to decisions too.

## When The Registry Contradicts The Code

The code is the truth; the registry is a claim about it. When they disagree:

- Task says `open`, but the work is already in `main` → verify it really satisfies the stated
  outcome, then close it with evidence. Do not close on resemblance alone.
- Task says `done`, but the behaviour is missing → new bug task referencing the old one. Never
  reopen; see `lifecycle-and-checks.md`.
- Task describes files that no longer exist → the work was overtaken. Update Context to today's
  tree, or drop it with a Decision Log entry saying the ground moved.

Fix the drift when you find it, in the same change. A registry nobody corrects becomes a registry
nobody trusts, and then it is just files.

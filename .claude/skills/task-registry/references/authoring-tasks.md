# Authoring A Task

How to turn an intent into a task file someone else can execute. Schema lives in
`docs/tasks/README.md`; this is about the judgement the schema cannot enforce.

## What A Good Task Looks Like

A task is executable when a competent contributor who was not in the conversation can read it and
know what to change, and know when to stop.

**Title** — the outcome, in the imperative, naming the thing the codebase calls it.

    good: Let users revoke connected MCP clients from settings
    good: Score money categorization quality against a corpus instead of only its plumbing
    bad:  Fix MCP stuff                    (which stuff, fixed how, done when?)
    bad:  Investigate slow import          (an activity, not an outcome)
    bad:  Improve error handling           (unfalsifiable — never done)
    bad:  Add revokeGrant() to grants.ts   (a solution; the outcome may not need that function)

Prefer the vocabulary the code uses. `mcp_oauth_grants`, `money-import`, `health-structure` are what
a future agent will grep for, so put them in the title or the tags.

Name a solution in the title only when the solution is the decision — "Replace X with Y" is a fine
title when replacing X is the point rather than an implementation detail.

**Context** answers four things, in prose:

1. What is true today, naming files by full repository-relative path.
2. What someone can do afterwards that they cannot do now.
3. How to see it working — the observable, not the internal attribute.
4. What is deliberately out of scope, when a reader would otherwise assume it is in.

**Progress** starts as the concrete steps you can already name. It is fine for the list to be
incomplete; it is not fine for it to be aspirational filler like "implement the feature".

## Ready Checkpoints

Before a task leaves `idea` for `open`, all five must hold. If one fails, the task is not ready —
fix it or leave it as an `idea` and say so.

1. **Outcome** — the title states a change in the world, not an activity.
2. **Grounding** — Context names at least one real path, symbol or table that exists in the tree
   right now. A task that names nothing concrete has not been researched yet.
3. **Observable** — there is a way to see it is done that a human could perform. For debt, this is
   the `exit` field and it is mandatory.
4. **Bounded** — the work is not open-ended. "Raise coverage" is not bounded; "DB mapping above
   50%" is.
5. **Non-overlapping** — the registry has been searched and no existing task already covers this.
   See `relationships.md`.

## Ground It In The Code First

Do this before asking the user anything. Most ambiguity dissolves on contact with the tree, and
questions you could have answered yourself waste the user's attention.

- **Search the registry.** `grep -ril "<domain noun>" docs/tasks/` and read `INDEX.md`. Include
  `done` tasks: something already delivered may have regressed, which is a new bug task referencing
  the old one, not a reopen.
- **Search the code** for the surface named in the request. Does it already exist? Is the defect
  already fixed on `main`? Is the "missing" feature actually present and broken?
- **Check `git log`** for the area. Recently touched code often means the problem is already known,
  or that a fix was attempted and reverted for a reason worth finding.
- **Check `docs/ARCHITECTURE.md` gaps** (`ARCH-Gxx`). A known gap gives the task a home and a name
  the rest of the repo already uses.
- **Check `docs/tasks/decisions/`.** If an ADR forbids the obvious approach, the task must either
  respect it or open by arguing against it — never quietly ignore it.

Write what you found into Context. The research is most of the task's value.

## Turning A Vague Idea Into A Task

The pipeline, in order:

1. **Capture verbatim first.** Write the user's own words into the file as `status: idea` before
   interpreting them. Interpretation loses information, and the raw phrasing is evidence of what was
   actually wanted.
2. **Ground it** as above.
3. **Restate as an outcome.** "X is slow" becomes "X completes without the user abandoning it".
4. **Find the falsifiable end.** If you cannot state a condition under which this is finished, the
   task is not a task yet — it is a symptom. Say so.
5. **Pick `kind` and `depth`.** Only now, because the research decides both.
6. **Ask the user** what genuinely remains open. Usually little.

### Worked Example

Request: *"импорт тормозит, надо что-то сделать"* — "the import is slow, we should do something."

Grounding, before writing anything:

    grep -ril "import" docs/tasks/          -> T-0004, T-0013
    read docs/tasks/T-0013-money-receipt-backfill-and-unattended-import.md

`T-0013` already says the Chrome extension is run by hand, tries to pull the whole history in one
pass, hits the bank's rate limit, and the user abandons the import midway — and its Milestones 5, 6
and 8 cover truncation detection, amortised monthly backfill, and self-start on a natural visit.

So the correct output is **not** a new task. The right moves, in order of preference:

- If the request is already covered: say so, point at `T-0013`, and add nothing. The registry did
  its job.
- If the request adds a fact `T-0013` lacks (say, slowness on a surface its Context never mentions):
  append that fact to `T-0013`'s Context or Progress, not a new file.
- Only if the residue is a genuinely separate failure with its own exit condition does it become a
  new task — and its Context must reference `T-0013` and say how the two differ.

The failure mode this avoids is creating `T-0015 "Speed up money import"` next to `T-0013`, so that
two tasks describe one problem, neither is complete, and whoever picks one up does half the work.

## Asking The User

Ask only when different answers lead to materially different work. Anything you can settle by
reading the tree, settle by reading the tree.

Worth asking:

- **Observable outcome**, when nothing in the request implies one: "how will you know this is
  done?" Without it the task can never be closed honestly.
- **Scope boundary**, when the request sits next to an obvious neighbour: "does this include X, or
  is X separate?"
- **A constraint you cannot see**: "is there an approach already ruled out here?"
- **Priority**, only when it changes what happens next — not as a reflex.

Not worth asking: implementation details you should decide, naming, anything in the code, or
"should I create this task?" Create it.

When you do ask, batch the questions into one exchange, propose a default for each, and record the
answer in Context or the Decision Log — otherwise the next agent asks again.

## Anti-Patterns

- **The symptom task.** "Something is wrong with X." Ground it or leave it as an `idea` with the raw
  report; do not dress it up as `open`.
- **The container task.** "Money module improvements." Not bounded, never closes, and hides its
  contents from the board. Split it.
- **The solution-shaped title** for an undecided solution. It freezes a choice before the research
  and makes the real outcome invisible on the board.
- **Filler Progress.** Steps restating the title teach nothing and hide that no research happened.
- **Silent re-litigation.** Writing a task whose Context contradicts an existing Decision Log
  entry without acknowledging it. Argue against the decision explicitly, or follow it.
- **Debt without an exit.** Rejected by `tasks-check`, and rightly: it is a complaint.

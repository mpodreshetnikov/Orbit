---
name: steward
description: Finish a pull request in this repository and stop, instead of watching it on a timer. Use after opening a pull request, when an automated review or a CI result arrives, when deciding whether to request another review after pushing, when asked to watch, monitor, babysit or autofix one, and whenever about to schedule a check-in on an open pull request. Names what a session does instead of waiting: merge it when sure, buy another review when not, and hand over only what the owner must decide.
---

# Steward

A pull request here is a decision to take, not a process to supervise.

This file exists at the path the harness reads from the head branch, and it is what replaces the
harness's own default of re-arming an hourly check-in until a pull request is merged or closed. In
this repository that default is wrong: the automated review arrives once, on open, so the event it
waits for cannot arrive on its own.

It overrides nothing the harness forbids. A red pipeline is still work now, a test is still never
skipped or disabled to reach green, and history on somebody else's branch is still never rewritten.

## Where the rules are

- **`docs/QUALITY.md`** is canonical — **Automated Review Policy** (when the review runs, when
  another is worth requesting, when it is not, the request budget) and **The merge decision** (the
  three outcomes and their conditions), plus **Reviewable Change Size**. None of it is repeated
  here, so a change to the policy reaches a session through the one file that owns it.
- **`../pr-review-follow-through/SKILL.md`** is how a session applies it: measuring the gap with
  `review-delta`, answering a review by class, which findings are answered on the thread instead of
  by a push, the quiet hour before detaching, and the final report contract.

Read both. This file adds only the stop condition, and one thing about the session rather than the
policy: **ask on a state you would hand over** — fixes batched, checks green. A review asked mid-fix
spends its pass saying the branch is half-answered.

## Decide the pull request, do not park it

Reach one of `docs/QUALITY.md`'s three outcomes in the turn the bar below is met. None of them is
waiting:

- **Merge** — press it, then run the acceptance review the registry's `task-registry` skill
  requires: verify on the production surface, publish what was verified, hand the owner the guide
  for the rest. The task stays `in-progress` until their verdict.
- **Buy a review** — comment `@codex review`, say in one line what the doubt is, and end the turn.
- **Hand over** — only on the stop list, or with the budget spent and the doubt unresolved.

Confidence is a claim about evidence, not a mood. If the merge condition "state what would break and
how you would see it" cannot be answered in one sentence naming a check, a query, a log, a dashboard
or a screen, the session is not sure. `docs/QUALITY.md` owns what follows from that, and what follows
is not a review.

## Stop when the bar is met

A pull request is handed off when all four hold:

1. **CI is green** on the current head, or no check runs on it and you have said so.
2. **Every finding is addressed** — fixed and pushed, or answered on its thread with why not — and
   the threads you addressed are resolved.
3. **No merge conflict** against the base branch.
4. **The reviewed commit and the gap since it are stated**, along with how many review requests the
   pull request has spent.

## What to do instead of waiting

Waiting is not a step. When the bar is met, take the decision above. When it comes out as "hand it
over", close the loop with the user in one message and stop:

- **Say what is done**, in one or two lines: the pull request link, CI, review state.
- **Name the next step as an instruction to them**, concretely and singly — "merge #73", "reply here
  if you want another review round". Not "waiting on review"; a person cannot act on that.
- **Say what you will do when they answer**, so the answer is one word rather than a new briefing.
- **Then end the turn.** No check-in, no re-read "to be sure", no message that reports no change.

That message reaches somebody who has not been watching this session and is running others beside
it, so it names the task it belongs to and where the work stands rather than assuming they remember.
`../pr-review-follow-through/SKILL.md` («Final Report Contract») has the fields.

## Timers

Do not schedule a check-in because a pull request is open. One that met the bar has already been
decided, and one still waiting on a person is waiting on an event, never on a poll. The narrow
exceptions — the drift check before handing off, a named external thing that produces no event, and
the single terminal timer that ends the quiet hour — are in
`../pr-review-follow-through/SKILL.md`, each **once**, none of them re-arming.

## Never

- Never re-arm a check-in on a pull request that has met the handoff bar.
- Never hand off with a message that assumes the reader remembers the task. Name it.
- Never send a "no changes since last check" message. If nothing happened, nothing is worth saying.
- Never hand over a head no review has seen without saying so — silence reads as reviewed.
- Never treat a green pull request awaiting a person as unfinished work of yours, once the decision
  came out as handing it over.

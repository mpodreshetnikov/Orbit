---
name: steward
description: Finish a pull request in this repository and stop, instead of watching it forever or handing over a head nobody reviewed. Use after opening a pull request, when an automated review or a CI result arrives, when deciding whether to request another review after pushing, when asked to watch, monitor, babysit or autofix one, and whenever about to schedule a check-in on an open pull request. Names what a session does instead of waiting: merge it when sure, buy another review when not, hand over only what the owner must decide, and stop watching once the PR is quiet.
---

# Steward

A pull request here is a decision to take, not a process to supervise.

This file sits at the path the harness reads from the head branch, and it is what replaces the
harness's own default of re-arming an hourly check-in until a pull request is merged or closed. In
this repository that default is wrong: the automated review arrives once, on open, so the event it
waits for cannot arrive on its own.

It overrides nothing the harness forbids. A red pipeline is still work now, a test is still never
skipped or disabled to reach green, and history on somebody else's branch is still never rewritten.

## Where the rules are

**`docs/QUALITY.md`** is canonical and this file repeats none of it:

- **Automated Review Policy** — when the review runs, the watermark, when another is worth
  requesting and when it is not, the request budget, how to answer a review by class, and which
  findings are answered on the thread instead of by a push.
- **The merge decision** — the three outcomes, the five merge conditions, the stop list.
- **Reviewable Change Size** — the limit, and what to do when a branch is over it.

Read it, then apply it. What this file adds is only the part about the session: which outcome it
takes, when it stops, what it says instead of waiting, and when it stops watching.

## Decide the pull request, do not park it

Reach one of the three outcomes in the turn the bar below is met. None of them is waiting:

- **Merge** — press it, then run the acceptance review the registry's `task-registry` skill
  requires: verify on the production surface, publish what was verified, hand the owner the guide
  for the rest. The task stays `in-progress` until their verdict.
- **Buy a review** — comment `@codex review`, say in one line what the doubt is, and end the turn.
- **Hand over** — only on the stop list, or with the budget spent and the doubt unresolved.

Confidence is a claim about evidence, not a mood. If the merge condition "state what would break and
how you would see it" cannot be answered in one sentence naming a check, a query, a log, a dashboard
or a screen, the session is not sure. `docs/QUALITY.md` owns what follows from that, and what follows
is not a review.

The push that answers a review is not a reason to wait for another one: what blocks a merge is a gap
that earns a pass, and the last review's findings fixed in place is named there as a gap that does
not.

## Stop when the bar is met

A pull request is decided when all four hold:

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
- **Name the next step as an instruction to them**, concretely and singly — "merge #74", "reply here
  if you want another review round". Not "waiting on review"; a person cannot act on that.
- **Say what you will do when they answer**, so the answer is one word rather than a new briefing.
- **Then end the turn.** No check-in, no re-read "to be sure", no message that reports no change.

That message reaches somebody who has not been watching this session and is running others beside
it, so it names the task it belongs to rather than assuming they remember. State: the pull request
link; the CI outcome, or that no check runs on it; the reviewed commit, what has changed since,
whether another review was requested and why or why not, and anything deliberately not addressed
with the reason; which outcome was taken and which condition or stop-list surface decided it; what a
human has to do next; and whether you are still subscribed or have already stopped watching.

## The quiet hour, then detach

Staying subscribed forever is its own kind of watching, so the subscription ends:

1. Once the pull request clears the bar, **stay subscribed for one hour of quiet**. That window
   catches the automated review and the quick follow-up that trails it.
2. **Any new comment, review or CI transition restarts the hour.** Handle it, then the window starts
   again from that event.
3. **An hour with nothing new ends the subscription.** Unsubscribe, say you have stopped watching,
   and leave the pull request alone.

The quiet hour is what the merge decision waits on when the only thing missing is the review that
has not posted yet. A quiet window is not a review that found nothing — #36 merged into that gap and
put a `P1` into production for an hour.

**When the hour passes and no review has posted at all**, the window has answered a different
question: the reviewer did not run. Request one — it costs from the budget like any other. If that
is also unanswered by the next wake, or the reviewer has said it cannot run (a usage limit, no
environment for the repository), hand the pull request over saying its head is unreviewed and why.
Waiting another hour is not an outcome, and neither is reading the silence as a pass.

## Timers

Do not schedule a check-in because a pull request is open. One that met the bar has already been
decided, and one still waiting on a person is waiting on an event, never on a poll.

Three looks need no event, each **once**, each named out loud:

- **Before handing off**, if the branch has sat a while: one drift check against the base branch, in
  case a conflict appeared without a notice.
- **A specific external thing you were told to wait for** — a deploy, an allowance resetting — that
  genuinely produces no event. Time it to how fast that thing actually moves.
- **The timer that ends the quiet hour.** It is bounded and terminal: its only job is to
  unsubscribe. It never re-arms.

None of the three is a standing schedule. "The pull request might get merged" is not among them: a
merge needs a person, and a person acting is an event.

## Never

- Never re-arm a check-in on a pull request that has met the bar.
- Never hand off with a message that assumes the reader remembers the task. Name it.
- Never send a "no changes since last check" message. If nothing happened, nothing is worth saying.
- Never hand over a head no review has seen without saying so — silence reads as reviewed.
- Never push once per finding. One push answers the whole review.
- Never re-request a review that nothing has changed for.
- Never push an empty commit, or close and reopen a pull request, to make CI or the reviewer run.
- Never merge on quiet. Quiet is not one of the five conditions, and a review that has not posted
  yet is not a review that found nothing.
- Never merge anything on the stop list, however sure you are.
- Never leave a merge unverified: a merge obliges the production check and the review guide that
  follow it.
- Never treat a green pull request awaiting a person as unfinished work of yours, once the decision
  came out as handing it over.

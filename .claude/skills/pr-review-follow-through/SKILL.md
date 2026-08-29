---
name: pr-review-follow-through
description: Finish a pull request and stop, instead of watching it forever. Use after opening a PR, when asked to watch, monitor, babysit or autofix one, when an automated reviewer posts findings, and whenever deciding whether to check a PR again. Defines what "done with this PR" means, why the automated review arrives once rather than continuously, and the narrow cases that justify looking again.
---

# PR Review Follow-Through

A pull request is finished work handed to a human, not a process to supervise. This skill says when
to stop.

## The Review Arrives Once

The automated reviewer on this repository runs on a **trigger**, not a schedule: a PR being opened,
a draft marked ready, or someone commenting `@codex review`. It posts its findings, and that is the
whole review. Nothing further arrives on its own.

So there is nothing to poll for. An agent that re-checks a PR every hour after the review landed is
asking a question whose answer cannot change without a human acting first — and when a human does
act, the event wakes the session anyway.

## Done With This PR

A PR is handed off when all four hold:

1. **CI is green**, or the repository runs no check on it and you have said so.
2. **Every automated finding is addressed** — fixed and pushed, or answered on its thread with why
   not — and the threads you addressed are resolved.
3. **No merge conflict** against the base branch.
4. **You have said what is left for a human**: review, approval, merge.

At that point say so once and stop. Do not schedule a check-in, do not re-read the PR "to be sure",
and do not send a status message that reports no change. Silence is the correct output of a PR that
is waiting on somebody else.

## Waking Up Again

Events wake the session on their own: a comment, a review, a push, a CI transition, a
merge-conflict notice. When one arrives, handle it under the same bar as above, then return to
silence. One wake, one round of work, one stop.

Two narrow cases justify looking without an event, each **once**:

- **Before handing off**, if the branch has sat for a while: one drift check against the base
  branch, because a conflict that appeared while you were working may not have produced a notice.
- **A specific external thing you were told to wait for** — a deploy, a release, an allowance
  resetting — where the change genuinely produces no event. Time the check to how fast that thing
  actually moves, and say what you are waiting for.

Neither is a standing schedule. "The PR might get merged" is not one of these: a merge needs a
human, and a human acting is an event.

## The Quiet Hour, Then Detach

Staying subscribed forever is its own kind of watching. So the subscription has an end:

1. Once the PR clears the handoff bar, **stay subscribed for one hour of quiet**. That window
   catches the automated review and the quick follow-up that tends to trail it.
2. **Any new comment, review or CI transition restarts the hour.** Handle it, then the window
   starts again from that event.
3. **An hour with nothing new ends the subscription.** Unsubscribe, say you have stopped watching,
   and leave the PR alone.

After that the PR moves only on the owner's word. Their approval is what unblocks the merge, and
the merge is theirs to make or to ask for explicitly — never merge a PR because it looks ready and
has been quiet. Do not re-subscribe, re-check, or nudge on your own; if they pick it back up, they
will say so, and that is the event.

The one scheduled wake-up this permits — the timer that ends the quiet hour — is bounded and
terminal: its only job is to unsubscribe. It is not a check-in, it never re-arms itself, and it is
the only timer a finished PR may have.

## Never

- Never poll a PR on a timer because it is open. Open and waiting is its normal state. The single
  timer that ends the quiet hour is not polling — it stops the watching rather than continuing it.
- Never merge a PR that has gone quiet, however ready it looks. Quiet is not approval.
- Never push an empty commit, or close and reopen a PR, to make CI or the reviewer run again.
- Never re-request a review that nothing has changed for.
- Never send a "no changes since last check" message. If nothing happened, nothing is worth saying.
- Never treat a green PR awaiting human review as unfinished work of yours. It is finished work
  waiting on somebody who is not you.

## Final Report Contract

When handing off a PR, state:

- `pr`: the link.
- `checks`: CI outcome, or that the repository runs none on this PR.
- `review`: findings addressed, and anything deliberately not addressed with the reason.
- `waiting_on`: what a human has to do next.
- `watching`: that the session stays subscribed until an hour of quiet passes, or that it has
  already unsubscribed and stopped.

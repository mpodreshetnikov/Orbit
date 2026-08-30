---
name: pr-review-follow-through
description: Finish a pull request and stop, instead of watching it forever or answering it one finding at a time. Use after opening a PR, when an automated reviewer posts findings, when asked to watch, monitor, babysit or autofix one, and whenever deciding whether to push again or check again. Defines how to answer a review round, how many rounds a PR may spend, and what "done with this PR" means.
---

# PR Review Follow-Through

A pull request is finished work handed to a human, not a process to supervise. This skill says how
to answer the reviewer, and when to stop.

Canonical policy — the round budget, the class rule, the reviewable size limit — is
`docs/QUALITY.md` under **Automated Review Policy** and **Reviewable Change Size**. This is how to
apply it.

## One Push Is One Review Round

The automated reviewer runs on a **`New commits` trigger**. Every push to an open pull request buys
a fresh review, and those reviews spend the same allowance as the security review lane beside them.
A branch that pushes twenty times spends twenty rounds and starves the lane that reads the next
branch for leaked credentials and personal data.

So the round is the unit of cost, and pushing is what spends it. Nothing arrives on its own between
pushes: there is still nothing to poll for.

## Answering A Round

Three rules, applied in order, on every round.

### 1. Fix the class, not the finding

A finding is one instance of a rule. Find the rule, then fix it everywhere in the change it reaches
— in the same push.

- "Bound the notes rendered into the text response" is not about notes. It is *every unbounded value
  rendered into a text response*, and it also covers the ingredients, the slots, the units and the
  intervals. Answering only the named field is what turned one rule into seven rounds on PR #20.
- The reviewer named one occurrence because it read one file. Before pushing, re-read the whole
  diff for other occurrences of the same class and fix those too.
- A fix that changes a **shape** — the column a value is read from, the order rows are selected in,
  the key a lookup uses — is applied at every reader of that shape in the same push. Nine of #20's
  findings were the previous round's fix leaking into a reader it had not updated, four of them at
  `P1`. A fix that creates the next round's finding has not saved a round.

### 2. One push per round

Batch every finding from a round into a single push, together with the class sweep above and the
checks that prove it. Pushing per finding starts a fresh round against a half-answered review, which
is exactly how a five-finding round becomes five rounds.

### 3. Three rounds, then hand it over

**Three automatic rounds per pull request.** After the third, stop pushing. Report to the owner:
what is fixed, what is still open, and what another round would cost. Further rounds are bought
deliberately with an explicit `@codex review`, not spent by default.

The budget is per pull request. Rebasing does not reset it, reopening does not reset it, and a round
that produced no finding still counts — it was still a review.

If the third round arrives with the branch still visibly unfinished, that is the signal the change
is too large to review in one pass, not a reason to spend a fourth. Say so and propose the split.

### What still gets answered outside the budget

Not every finding needs a push. Answer on the thread instead, and it costs no round at all:

- A finding that is **real but not this branch's** — pre-existing on the base, or in code the diff
  does not touch. Record it as a task and say where, rather than widening the pull request.
- A finding whose **premise does not hold**. Say which part, with the evidence.
- A finding you are **deliberately not taking**. Say why on its thread.

Resolve the threads you addressed either way.

## Done With This PR

A PR is handed off when all four hold:

1. **CI is green**, or the repository runs no check on it and you have said so.
2. **Every finding is addressed** — fixed and pushed, or answered on its thread with why not — and
   the threads you addressed are resolved.
3. **No merge conflict** against the base branch.
4. **You have said what is left for a human**: review, approval, merge — and how many rounds the
   pull request has spent.

At that point say so once and stop. Do not schedule a check-in, do not re-read the PR "to be sure",
and do not send a status message that reports no change. Silence is the correct output of a PR that
is waiting on somebody else.

## Waking Up Again

Events wake the session on their own: a comment, a review, a push, a CI transition, a merge-conflict
notice. When one arrives, handle it under the same bar as above, then return to silence. One wake,
one round of work, one stop.

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

After that the PR moves only on the owner's word. Their approval is what unblocks the merge, and the
merge is theirs to make or to ask for explicitly — never merge a PR because it looks ready and has
been quiet. Do not re-subscribe, re-check, or nudge on your own; if they pick it back up, they will
say so, and that is the event.

The one scheduled wake-up this permits — the timer that ends the quiet hour — is bounded and
terminal: its only job is to unsubscribe. It is not a check-in, it never re-arms itself, and it is
the only timer a finished PR may have.

## Never

- Never push once per finding. One push answers the whole round.
- Never spend a fourth automatic round without the owner asking for it.
- Never fix only the field a finding names when the rule reaches further. The next round will find
  the rest, at full price.
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
- `review`: rounds spent out of the budget, findings addressed, and anything deliberately not
  addressed with the reason.
- `waiting_on`: what a human has to do next.
- `watching`: that the session stays subscribed until an hour of quiet passes, or that it has
  already unsubscribed and stopped.

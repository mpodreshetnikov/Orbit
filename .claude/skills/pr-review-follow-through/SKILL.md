---
name: pr-review-follow-through
description: Finish a pull request and stop, instead of watching it forever or handing over a head nobody reviewed. Use after opening a PR, when an automated reviewer posts findings, when deciding whether to ask for another review after pushing more work, when asked to watch, monitor, babysit or autofix one, and whenever deciding whether to push or check again. The automated review arrives once on open; this defines when to request another, how to answer one, and what "done with this PR" means.
---

# PR Review Follow-Through

A pull request is finished work handed to a human, not a process to supervise. This skill says how
to answer the reviewer, and when to stop.

Canonical policy — the round budget, the class rule, the reviewable size limit — is
`docs/QUALITY.md` under **Automated Review Policy** and **Reviewable Change Size**. This is how to
apply it.

## The Review Arrives Once, On Open

The automated reviewer runs when a pull request is **opened**, and not again unless asked with an
`@codex review` comment. It reads one commit and names it — `Reviewed commit` in the review body,
and the `Commit` column of its summary comment. Everything pushed after that is unreviewed.

So the risk is no longer burning rounds. It is handing over a branch whose head no reviewer has
seen: the opening review read your first commit, and eight pushes of real work landed behind it.

Treat that commit as a **watermark**, and carry it: when you hand the pull request over, say which
commit was reviewed and what has changed since.

## Asking For Another Review

Canonical policy is `docs/QUALITY.md` under **Automated Review Policy**. Applied:

### 1. Measure the gap

    just review-delta <reviewed-commit>

It reports the reviewable lines added since that commit and whether any of it landed on a sensitive
surface — migrations, `supabase/db`, edge functions, the OAuth and auth routes, the deploy
workflows, the scraping connector, and recorded fixtures. Fixtures are on that list *because* they
are excluded from the line count: nobody reads them in sequence, which is how #18 put thirteen
phone numbers and ten personal messages into one the leak scan had cleared.

### 2. Add the judgement the script cannot make

Request a review, whatever the script said, when the work since the watermark **changed a shape**
other code reads — the column a value comes from, the order rows are selected in, the key a lookup
uses, a signature. That is the class that produced nine of #20's findings and four of its six
`P1`s, every one of them the previous fix leaking into a reader it had not updated.

Do **not** request one when the change is only the last review's findings fixed in place, only
docs, comments, formatting or test names, only a clean base merge, or when nothing has been pushed
since the watermark. A review of a change it has already seen returns findings you have already
answered.

### 3. Ask on a finished state, and at most twice

Comment `@codex review` once the branch is in a state you would hand over: fixes batched, checks
green. A review asked for mid-fix reads a half-answered branch and spends its pass saying so.

**At most two requested reviews beyond the opening one.** After the second, hand the pull request
to its owner with what is unreviewed and why another pass looked worthwhile. The budget is per pull
request; rebasing and reopening do not reset it, and a request that returned no finding still spent
one.

## Answering A Review

### Fix the class, not the finding

A finding is one instance of a rule. Find the rule, then fix it everywhere in the change it reaches
— in the same push.

- "Bound the notes rendered into the text response" is not about notes. It is *every unbounded value
  rendered into a text response*, and it also covers the ingredients, the slots, the units and the
  intervals. Answering only the named field is what turned one rule into seven rounds on #20; date
  validation took five more.
- The reviewer named one occurrence because it read one file. Before pushing, re-read the whole diff
  for other occurrences of the same class and fix those too.

### Some findings are answered on the thread, not by a push

These cost nothing and still close the finding:

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

- Never push once per finding. One push answers the whole review.
- Never hand over a branch whose head is unreviewed without saying so. Silence reads as reviewed.
- Never request a review for a change the last one already saw, and never a third beyond the
  opening one without the owner asking.
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
- `review`: the reviewed commit, what has changed since it, whether another review was requested
  and why or why not, findings addressed, and anything deliberately not addressed with the reason.
- `waiting_on`: what a human has to do next.
- `watching`: that the session stays subscribed until an hour of quiet passes, or that it has
  already unsubscribed and stopped.

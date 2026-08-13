---
id: T-0014
title: Score money categorization quality against a corpus instead of only its plumbing
status: open
kind: debt
priority: p2
depth: note
created: 2026-08-13
updated: 2026-08-13
owner: TBD
tags: [money, categorization, llm, testing]
exit: "A scored corpus of real merchant names and receipt line titles with expected canonical categories runs via a `test-money-categorization` command, replays cassettes by default, reports per-category accuracy, and is required before any prompt or model change"
---

# Score money categorization quality against a corpus instead of only its plumbing

## Context

The LLM categorizer — `supabase/functions/money-categorize/openrouter-categorize.ts` and its
`service.ts` — has plumbing tests only: malformed envelopes, timeouts, abort-to-timeout mapping, and
one batching case, all against a faked `fetchFn`. Nothing measures whether the categories it returns
are actually correct. A prompt edit or a model swap therefore changes real categorisation with no
signal at all.

The Health domain already solved this problem. `scripts/extraction-eval/` provides cassettes, a
corpus, scoring and a report, with fixtures under `test/fixtures/extraction/` and a
`test-extraction` run deliberately kept outside the CI gate because it can call a paid provider.
Money has no equivalent corpus and no cassettes.

Migrated from the former `docs/exec-plans/tech-debt-tracker.md`, where this row was added on
2026-08-13 while `T-0011` was in review. Captured here rather than in the tracker because that file
was retired by the task registry.

## Progress

- [ ] Build a corpus of real merchant names and receipt line titles with expected canonical
      categories.
- [ ] Record cassettes so the run replays without calling a paid provider by default.
- [ ] Add a `test-money-categorization` command that reports per-category accuracy.
- [ ] Require the scored run before any prompt or model change.

## Decision Log

- Decision: Track this as `debt` rather than folding it into `T-0013`.
  Rationale: `T-0013` is about receipt compositions, transaction identity and unattended import —
  getting the data in. This is about whether the categoriser's output is right once the data is
  there. They touch the same domain but fail independently, and bundling them would hide this behind
  a plan whose milestones do not mention it.
  Date/Author: 2026-08-13, carried over from the tech debt tracker.

- Decision: Follow the `scripts/extraction-eval/` shape rather than inventing a second one, and keep
  the scored run outside the CI gate.
  Rationale: The Health corpus already settled the hard questions — cassette replay by default so
  the default path costs nothing, scoring separated from pass/fail, and the run excluded from CI
  because a live run calls a paid provider. Reusing that shape means one mental model for quality
  corpora in this repo. `test-extraction` is the working precedent.
  Date/Author: 2026-08-13.

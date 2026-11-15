# Money categorization eval corpus

Scored regression corpus for OpenRouter money LLM categorization (`money-categorize`).
Follow-up to `T-0014` / `T-261115-l7n` — mirrors `test/fixtures/extraction/`.

## Layout

```
test/fixtures/money-categorization/
  shared/
    categories.json     # pinned canonical candidate categories (stable seed ids)
  cases/
    NNN-slug/
      input.json        # synthetic merchant / line title + context
      expected.json     # hand label: category_id + canonical_system_key (or null)
      meta.json         # language, kind, judgement notes
  cassettes/
    NNN-slug/           # recorded provider responses (synthetic bootstrap)
```

All case content is **synthetic**. Do not copy production merchants, person ids, or real
transaction payloads into this tree.

## Running it

`just test-money-categorization` (see `docs/QUALITY.md`). Replays cassettes by default —
free, offline, deterministic. `--live` calls OpenRouter and costs money; `--record` implies
`--live` and refreshes the recordings.

Synthetic cassettes are committed so a fresh clone replays without an API key. They encode the
hand labels (harness plumbing proof). A live/`--record` run measures real model quality and
replaces the synthetic answers.

Bootstrap / refresh synthetic cassettes after changing prompts or fixtures:

```
npx tsx scripts/money-categorization-eval/write-synthetic-cassettes.ts
```

## Size

The initial corpus is **10 cases**: clear positives across food, transport, utilities, shopping,
entertainment, health, income, transfers; one deliberate abstention; one multi-line receipt with
siblings. Small on purpose — same posture as extraction-eval's three cases — enough to exercise
scoring and cassette replay without claiming production coverage.

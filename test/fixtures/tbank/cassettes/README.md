# Recorded T-Bank connector sessions

Each subdirectory is one recorded case and holds a `cassette.json`:

```json
{
  "name": "synthetic-month",
  "entries": [{ "url": "...", "status": 200, "body": { "payload": [] } }]
}
```

Recording against a live bank is the one manual step in the connector's test story: every
request carries a `sessionid` scraped from an authorised page, and signing in cannot be
automated. Until a human records a fresh case, committed fixtures here are **synthetic** —
hand-built envelopes shaped like the bank's API, with no live account data.

Replay goes through `createCassettePlayer` in
`browserExtension/src/connectors/cassette-replay.ts` (test harness only; not packaged into the
extension zip). Matching ignores `sessionid`, `start`, `end`, and `wuid`.

## Synthetic case

`synthetic-month/` covers the paths the connector walks for a short window: one operations
range, one detail call, one shopping receipt, and one tranche-offers call (including a redacted
`wuid`). `tbank-web.contract.test.ts` replays it through the production extractor and requires
zero misses.

## Recording a live cassette later

Use `just extension-debug-live tbank_web 10`, scrub the capture, and commit under a new
subdirectory. Live recordings must pass the repository leak scan before commit.

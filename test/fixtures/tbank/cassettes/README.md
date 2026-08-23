# Recorded T-Bank connector sessions

Each subdirectory is one recorded case and holds a `cassette.json`:

```json
{
  "name": "dense-month",
  "entries": [{ "url": "...", "status": 200, "body": { "payload": [] } }]
}
```

Recording is the one manual step in the connector's test story, and it stays manual: every
request to the bank's API carries a `sessionid` scraped from a live authorised page, and
signing in cannot be automated. Trying to would make CI a source of both false failures and
risk to the account.

To record:

1. `just extension-debug-live tbank_web 10` — pass the bank's sign-in when it appears.
2. Run the captured artifacts through `scripts/extension/cassette-scrub.ts`. A raw recording
   holds a live session id, card and account numbers and the account holder's name; none of
   that may be committed.
3. Put the scrubbed result here and run `test-unit-ext`. `cassette-scrub.test.ts` re-scans
   every committed cassette for anything that still looks like a secret.

Re-record when the bank changes its responses — `tbank-web.contract.test.ts` is what tells you
that has happened, by failing rather than silently mapping fewer operations.

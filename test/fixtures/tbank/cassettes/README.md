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

## Recording from the browser console (no checkout needed)

The person who can sign in to the bank is not necessarily the person with a checkout, and
asking them to clone the repository, install node and run a build before they can spend fifteen
minutes recording is most of the reason no cassette existed for so long. This route needs
nothing but their signed-in browser:

1. Build the snippet once, from any checkout:
   `npx tsx scripts/extension/build-cassette-recorder.ts .tmp/cassette-recorder.js`
2. Hand them that one file. On <https://www.tbank.ru/mybank/operations/>, signed in and with
   the operations list loaded, they open DevTools → Console, paste it and press Enter. Chrome
   asks them to type `allow pasting` first.
3. It records, scrubs **in the browser**, and downloads `cassette.json`. Defaults are the last
   30 days and up to 25 receipts; `orbitRecordCassette({ windowDays: 60, maxReceipts: 40 })`
   re-runs with other bounds.
4. **Check the totals it prints against the bank's own screen** before passing the file on. The
   console shows a table of Moscow calendar months with an operation count and the income and
   expense sums per currency. A recording can look complete and be short — a truncated range
   loses its remainder in silence, and nothing inside the file says so. The totals are the only
   cheap way to find out, and they are why the summary is written into the cassette.
5. Put the file in a subdirectory here and run `test-unit-node` and `test-unit-ext`.

The snippet refuses to download a recording that still trips `findCassetteLeaks`, so a scrubber
miss surfaces as a console error rather than as a file someone might pass on. Its endpoint
discovery, range walk, truncation splitting and receipt key are mirrored from `tbank-web.ts`,
because a cassette recorded against URLs the connector never asks for replays as a wall of
misses while looking like a real recording — and the replay matches an operations request on
origin and path alone, handing entries back in recorded order, so the recorded _sequence_ has to
be the connector's sequence too. That is why a capped range is split here exactly as the
connector splits it.

Once the totals have been checked once by hand, they stop being a one-off: `tbank-web.contract.test.ts`
replays the cassette and must reproduce them, so a mapper that later starts dropping operations
or reading an amount differently fails instead of quietly reporting less.

## Recording from a checkout

1. `just extension-debug-live tbank_web 10` — pass the bank's sign-in when it appears.
2. Run the captured artifacts through `scripts/extension/cassette-scrub.ts`. A raw recording
   holds a live session id, card and account numbers and the account holder's name; none of
   that may be committed.
3. Put the scrubbed result here and run `test-unit-ext`. `cassette-scrub.test.ts` re-scans
   every committed cassette for anything that still looks like a secret.

Re-record when the bank changes its responses — `tbank-web.contract.test.ts` is what tells you
that has happened, by failing rather than silently mapping fewer operations.

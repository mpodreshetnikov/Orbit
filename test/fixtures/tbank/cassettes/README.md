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
3. It records, scrubs **in the browser**, and downloads `cassette.json`. By default it records
   whole Moscow calendar months — this one and the previous one — and up to 50 receipts, the
   connector's own per-run budget;
   `orbitRecordCassette({ wholeMonths: 3 })` or `orbitRecordCassette({ windowDays: 45 })` re-run
   with other bounds. Months rather than a rolling day window because a window of days lines up
   with no month the bank shows, and a fragment of a month compared against the bank's figure
   for it reports a loss that never happened.
4. **Check the totals it prints against the bank's own screen** before passing the file on. The
   console shows a table of Moscow calendar months with an operation count and the income and
   expense sums per currency. Only rows marked `complete` are comparable — a month the window
   does not cover end to end is short by design, and the flag is what tells the two apart. A recording can look complete and be short — a truncated range
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

## What the first real recording settled

`dense-month/` is that recording: two whole Moscow months of one live account, 402 operations
across nine range requests, two of which came back capped and were split, none left unresolved.
Three things came out of reconciling it against the bank's own screen, and all three are now
asserted rather than remembered.

**The totals had to be computed the bank's way.** The first comparison was over on both sides at
once — by 5575.00 in July and 4068.00 in August — which is the signature of a sign convention,
not of a missing operation. Each amount was exactly that month's `PAY`/`Credit` operations:
refunds of purchases, which the bank subtracts from the month's spending rather than adding to
its income. With that convention the recording lands within a kopeck of the four displayed
figures, and the kopeck is the bank's own rounding.

**A gateway error is not a receipt.** One receipt request came back 504. Counting it would have
claimed enrichment the cassette cannot replay, and nothing in the summary would have suggested
re-recording. Non-200 responses are excluded and warned about now, as throttled ones already
were.

**The leak scan cannot rest on the field list alone.** The delivered file carried thirteen
counterparty phone numbers under `pointer`, a transfer field added to the scrubber minutes after
that snippet was built — and the scan reported it clean, because eleven digits is two short of
the long-digit rule. The field was named and the scan now recognises a phone number wherever it
appears. The general lesson is the reason the scan exists separately from the scrubber: the
field list will always lag some field, and the scan is what stops the lag reaching the
repository.

Re-record when the bank changes its responses — `tbank-web.contract.test.ts` is what tells you
that has happened, by failing rather than silently mapping fewer operations.

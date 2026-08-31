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
its income. With that convention the recording lands on the four displayed figures — to within
a rouble, not a kopeck. The bank displays whole roubles, and all four differences fall in [0, 1)
in the direction truncation would put them. A missing or mis-signed amount under a rouble would
still hide; what this comparison catches is a convention error, which is what it caught.

**A gateway error is not a receipt.** One receipt request came back 504. Counting it would have
claimed enrichment the cassette cannot replay, and nothing in the summary would have suggested
re-recording. Non-200 responses are excluded and warned about now, as throttled ones already
were.

**The bank does not paginate anywhere near `SUSPECTED_PAGE_LIMIT`.** `tbank-web.ts` still carries
a TODO to re-derive that constant from the first recorded cassette. This is that cassette, and
the answer is that it cannot be derived. Two fortnight ranges came back with 104 and 106
operations — above the threshold of 100, so both were split — and each pair of halves summed
exactly to its parent, 49+55 and 65+41. Neither response was capped. Nine responses, nine
distinct lengths, no repeated ceiling anywhere in the recording.

So the threshold should stay low deliberately rather than provisionally. Raising it to just over
the densest fortnight one account happened to have chases a number with no meaning — the next
account returns 130 and splits again — while giving up the margin that makes over-splitting the
only failure mode. A split that was not needed costs two requests and is caught by the merge; a
cap that slips past costs operations nobody will know are missing. Whoever closes that TODO
should close it with this, not with 106.

**A cassette is only proven by replaying it through the connector.** `tbank-web.contract.test.ts`
now runs `extractOperationsInPage` against `createCassettePlayer`, with the window taken from the
recording and the clock frozen at its end, and requires zero player misses and zero unused
entries. Everything else in that file reads the cassette and calls the mapper directly, which
checks the mapping and nothing else — the range walk, the truncation splitting, the receipt
request key, the tranche parameters and the detail endpoint are exercised only when the connector
does the asking. That replay is what caught seven ways the recorder had drifted from the
connector it mirrors, including a tranche URL missing five parameters the connector always sends
and a detail endpoint the recorder invented where the connector returns null.

**Every detail response in this recording is an error.** All 401 of them are HTTP 200
`INVALID_REQUEST_DATA`, so detail enrichment does not work against the live bank either. Why is
not established: the rejection shows the request is refused, not that `operationId` is the reason
— a missing parameter or a retired endpoint would look the same. The cassette records that
faithfully — the connector sends the same request and gets the same answer — but it means
replaying this recording proves nothing about detail mapping. The recorder now warns when a
recording comes out that way. Why the bank rejects the request is T-260829-g7i in the registry.

**One entry in this cassette is a duplicate, deliberately.** Two operations share an
`authorizationId`, so the connector asks for that detail twice; the recording was made before the
recorder stopped deduplicating by request key and holds one response. The request is byte for
byte identical both times, so the answer is by definition the same, and the fixture emits it as
many times as the connector asks — which is what the fixed recorder produces. Nothing else is
added: a request with no recorded response stays absent and shows up as a replay miss.

**The leak scan cannot rest on the field list alone.** The delivered file carried thirteen
counterparty phone numbers under `pointer`, a transfer field added to the scrubber minutes after
that snippet was built — and the scan reported it clean, because eleven digits is two short of
the long-digit rule. The field was named and the scan now recognises a phone number wherever it
appears. The general lesson is the reason the scan exists separately from the scrubber: the
field list will always lag some field, and the scan is what stops the lag reaching the
repository.

The same file also carried fourteen counterparty names — "Тестовая П." — in `maskedFIO`, and in
`description`, `subcategory` and `merchantKey` on every transfer and every incoming payment.
Those fields cannot simply be redacted: for a purchase they hold "Пятёрочка", which the mapper
and the tests here are built on. What the text means is decided by the `group` beside it, so the
group decides — and, because the same names came back from the detail response under keys with
no group in sight, the masked-name form is redacted wherever a whole value has it and reported
by the scan when it survives.

## `known-keys.json`

Every key that may appear anywhere in a committed cassette, written down. A key outside this list
fails `cassette-scrub.test.ts`.

It exists because naming fields did not converge. Seven review rounds each found one more thing in
this recording that nothing read and that should not have been published — a phone number, a
counterparty, a private transfer note, a cashier, a shop's street address, a course of prescription
medication, a till number, eleven cities, four hundred correlation tokens. Every round's fix named
the field that round had found. The scrubber is allowlist-based now, so an unknown field is
redacted rather than shipped; this file adds the other half, which is that an unknown field is
_seen_. When the bank adds one, or a recording covers an endpoint the last one did not, the test
goes red and somebody has to look at what is in it.

So when it fails: open the recording, read what the bank actually puts in that key, and only then
add it here. If it should survive the scrub, add it to the matching allowlist in
`cassette-scrub.ts` as well — `OPERATION_KEPT`, `MERCHANT_KEPT`, `RECEIPT_KEPT` or
`RECEIPT_ITEM_KEPT`. Adding it here alone means the key is known and still redacted, which is the
right default.

Re-record when the bank changes its responses — `tbank-web.contract.test.ts` is what tells you
that has happened, by failing rather than silently mapping fewer operations.

/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { __test__ } from "./tbank-web.js";
import { createCassettePlayer, type Cassette } from "./cassette-replay";

/**
 * Guards the shape of the bank's responses, which is a contract nobody tells us about when it
 * changes. The connector already counts the operations it had to drop while mapping
 * (`mapping_drop_counts`); the point of this suite is that a changed response makes that
 * counter non-zero and fails loudly, instead of quietly producing fewer rows than the bank
 * actually returned.
 *
 * Cassettes are enumerated through `import.meta.glob` rather than the filesystem: extension
 * runtime code may not import Node modules, and build scripts may not import extension
 * runtime code, so neither `node:fs` here nor a home under `scripts/` is available. Both
 * rules are worth keeping intact — and Vite resolves the fixtures at build time anyway.
 *
 * Recording a cassette needs a signed-in bank session and is therefore a manual step:
 *
 *     just extension-debug-live tbank_web 10
 *
 * then run the recording through scripts/extension/cassette-scrub.ts and commit the result to
 * test/fixtures/tbank/cassettes/<case>/. Until a cassette is committed this suite reports that
 * it has nothing to check rather than passing silently on nothing.
 */

/**
 * The reconciliation totals a recorder writes into a cassette.
 *
 * Declared here rather than imported: the type lives in `scripts/extension/`, and extension
 * runtime code may not import build scripts any more than the reverse. The same split already
 * applies to the dedupe formula, and the shape is small enough that a mismatch shows up as a
 * failing assertion rather than a silent skip — `summary` is optional, so a cassette recorded
 * before this existed simply does not get the check.
 */
interface RecordedSummary {
  months: Array<{
    month: string;
    currency: string;
    operations: number;
    income: string;
    expense: string;
    complete?: boolean;
  }>;
}

/** Moscow is a fixed UTC+03:00, which is the clock the bank prints and totals in. */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const cassetteModules = import.meta.glob<{ default: Cassette }>(
  "../../../test/fixtures/tbank/cassettes/*/cassette.json",
  { eager: true },
);

const cassettes: Cassette[] = Object.entries(cassetteModules).map(([filePath, module]) => {
  const parsed = module.default;
  const directory = filePath.split("/").slice(-2, -1)[0] ?? "unnamed";
  return { ...parsed, name: parsed.name || directory };
});

/**
 * The connector reads its page through globals — the origin it is on, the resource timeline it
 * discovers endpoints from, and `fetch`. In a node test none of those exist, so the replay has
 * to supply them: the origin and the endpoint URLs come out of the cassette itself, which is
 * the point — a recording that never captured an endpoint cannot make the connector ask for it.
 */
/**
 * The player's own match key, restated: origin and path plus every query parameter except the
 * three that legitimately vary between runs. Duplicated rather than imported because it is not
 * exported, and because a test that counted requests by a *different* key would agree with the
 * player about nothing.
 */
function requestsPerKey(urls: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const raw of urls) {
    const url = new URL(raw);
    const params = Array.from(url.searchParams.entries())
      .filter(([name]) => !["sessionid", "start", "end"].includes(name.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
    const key = params ? `${url.origin}${url.pathname}?${params}` : `${url.origin}${url.pathname}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function installPageGlobals(
  player: ReturnType<typeof createCassettePlayer>,
  cassette: Cassette,
  fetched: string[],
): () => void {
  const scope = globalThis as Record<string, unknown>;
  const origin = new URL(cassette.entries[0]?.url ?? "https://www.tbank.ru").origin;

  // One URL per endpoint the recording actually holds, newest last: `findLatestResourceUrlByPath`
  // walks the timeline backwards and takes the first match.
  const resourceUrls = Array.from(
    new Map(
      cassette.entries.map((entry) => [new URL(entry.url).pathname, entry.url] as const),
    ).values(),
  );

  const saved = {
    window: scope.window,
    document: scope.document,
    fetch: scope.fetch,
    getEntriesByType: performance.getEntriesByType,
  };

  scope.window = { location: { origin, href: `${origin}/mybank/operations/` } };
  scope.document = { body: { innerText: "" }, querySelectorAll: () => [] };
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    fetched.push(typeof input === "string" ? input : input.toString());
    return player.fetch(input, init);
  }) as typeof fetch;
  performance.getEntriesByType = ((type: string) =>
    type === "resource"
      ? resourceUrls.map((name) => ({ name }))
      : []) as typeof performance.getEntriesByType;

  return () => {
    scope.window = saved.window;
    scope.document = saved.document;
    scope.fetch = saved.fetch;
    performance.getEntriesByType = saved.getEntriesByType;
  };
}

describe("tbank-web response contract", () => {
  it("reports when there is nothing to check", () => {
    // Recording is manual, so an empty fixture directory is an expected state — but it must
    // be a visible one, not a suite that reports success having checked nothing.
    if (cassettes.length === 0) {
      console.warn(
        "No cassettes in test/fixtures/tbank/cassettes. Record one with " +
          "`just extension-debug-live tbank_web 10`, scrub it, and commit it.",
      );
    }
    expect(Array.isArray(cassettes)).toBe(true);
  });

  for (const cassette of cassettes) {
    const operationsEntries = cassette.entries.filter((entry) =>
      entry.url.includes("/api/common/v1/operations"),
    );

    it(`maps every operation in ${cassette.name} without dropping any`, () => {
      expect(operationsEntries.length, "cassette has no operations response").toBeGreaterThan(0);

      const dropped: string[] = [];
      let mapped = 0;
      for (const entry of operationsEntries) {
        const payload = (entry.body as { payload?: unknown[] })?.payload ?? [];
        for (const operation of payload) {
          const row = __test__.mapOperationRecordToRow({ operation }, { extractionMethod: "api" });
          if (row) mapped += 1;
          else dropped.push(JSON.stringify(operation).slice(0, 200));
        }
      }

      expect(dropped, `operations the mapper could not read: ${dropped.join(" | ")}`).toEqual([]);
      expect(mapped).toBeGreaterThan(0);
    });

    const summary = (cassette as { summary?: RecordedSummary }).summary;
    if (summary && summary.months.length > 0) {
      it(`reproduces the recorded totals for ${cassette.name}`, () => {
        // The recorder wrote these totals, and whoever recorded the cassette compared them with
        // the bank's own screen before committing it. That comparison happened once; this is
        // what makes it permanent. A mapper that starts reading fewer operations, or reads an
        // amount or a date differently, shows up here as a number that no longer matches —
        // which a count of successfully mapped rows cannot express.
        const totals = new Map<string, { operations: number; income: number; expense: number }>();

        // A capped range is recorded as the parent response *and* both halves, so the same
        // operation appears in several payloads. The recorder's totals deduplicate through the
        // connector's own operation key; totalling raw payload entries here would double-count
        // every dense cassette and fail against a mapper that is perfectly correct.
        const seen = new Set<string>();

        for (const entry of operationsEntries) {
          const payload =
            (entry.body as { payload?: Array<Record<string, unknown>> })?.payload ?? [];
          for (const operation of payload) {
            const row = __test__.mapOperationRecordToRow(
              { operation },
              { extractionMethod: "api" },
            );
            if (!row) continue;

            // The identity has to be the one the connector and the recorder both key by. An
            // operation carrying none of the three identifiers is kept by their shared
            // timestamp/amount fallback, so dropping it here counts it in the recorded summary
            // and not in this recomputation — a failure on a response shape the connector
            // explicitly supports.
            // `buildOperationKey`'s own precedence and its own idea of what counts as present:
            // it runs each candidate through `text`, so an empty string falls through to the next
            // one. `??` does not — an operation carrying `id: ""` would take that branch, and
            // every such operation would collapse to one identity while the connector keeps them
            // apart, undercounting the month and failing a cassette that is correct.
            const asKey = (value: unknown): string | null => {
              if (typeof value === "string") return value.trim() || null;
              if (typeof value === "number" && Number.isFinite(value)) return String(value);
              return null;
            };
            const identity =
              asKey(operation.id) ??
              asKey((operation.operationId as { value?: unknown } | undefined)?.value) ??
              asKey(operation.authorizationId) ??
              `fallback:${String(row.posted_at)}:${String(row.amount)}:${String(row.description)}`;
            if (seen.has(identity)) continue;
            seen.add(identity);

            const postedAt = typeof row.posted_at === "string" ? row.posted_at : null;
            const amount = typeof row.amount === "number" ? row.amount : null;
            const currency = typeof row.currency === "string" ? row.currency : "RUB";
            if (postedAt === null || amount === null) continue;

            // `posted_at` is UTC; the summary buckets by Moscow month, because that is what
            // the bank's screen groups by and therefore what a person compares against. An
            // operation just after midnight in Moscow falls in the previous UTC month, so
            // slicing the UTC string here would move it and the totals would never agree.
            const month = new Date(Date.parse(postedAt) + MOSCOW_OFFSET_MS)
              .toISOString()
              .slice(0, 7);
            const key = `${month}|${currency}`;
            const bucket = totals.get(key) ?? { operations: 0, income: 0, expense: 0 };
            bucket.operations += 1;
            // Same convention as the recorder's summary: the bank subtracts a purchase refund
            // from that month's spending rather than counting it as income, and these totals
            // exist to be comparable with the bank's screen.
            const isRefund = amount > 0 && String(operation.group ?? "").toUpperCase() === "PAY";
            if (isRefund) bucket.expense -= amount;
            else if (amount >= 0) bucket.income += amount;
            else bucket.expense += Math.abs(amount);
            totals.set(key, bucket);
          }
        }

        for (const month of summary.months) {
          const bucket = totals.get(`${month.month}|${month.currency}`);
          expect(bucket, `no mapped rows for ${month.month} ${month.currency}`).toBeDefined();
          expect(bucket?.operations, `${month.month} operation count`).toBe(month.operations);
          expect(bucket?.income.toFixed(2), `${month.month} income`).toBe(month.income);
          expect(bucket?.expense.toFixed(2), `${month.month} expense`).toBe(month.expense);
        }
      });
    }

    it(`replays ${cassette.name} through the connector without a miss`, async () => {
      // Everything above reads the cassette and calls the mapper on what it finds. That checks
      // the mapping and nothing else: the range walk, the truncation splitting, the receipt
      // request key, the tranche parameters and the detail endpoint are all exercised only when
      // the connector itself does the asking. A recorder that drifts from any of them produces
      // a cassette that looks complete and replays as misses, which is precisely the failure
      // this whole arrangement exists to prevent — and it would pass every other test here.
      const player = createCassettePlayer(cassette);

      // The window is taken from the recording itself, and the clock is frozen at its end. The
      // player ignores `start` and `end` when matching, but not how many requests are made:
      // asked for a wider window than was recorded, the connector walks extra ranges and reuses
      // the first recorded response for each. Freezing the clock makes the request sequence the
      // recorded sequence, which is the property the recorder is built to guarantee.
      const bounds = operationsEntries
        .map((entry) => new URL(entry.url).searchParams)
        .map((params) => ({ start: Number(params.get("start")), end: Number(params.get("end")) }))
        .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end));
      const windowFromMs = Math.min(...bounds.map(({ start }) => start));
      const windowToMs = Math.max(...bounds.map(({ end }) => end));

      // Fake timers first: enabling them replaces `performance`, which would take the resource
      // timeline the page globals install with it — and endpoint discovery would then find
      // nothing, silently, with every enrichment entry left unused.
      vi.useFakeTimers();
      vi.setSystemTime(windowToMs);
      const fetched: string[] = [];
      const restore = installPageGlobals(player, cassette, fetched);
      try {
        // The connector paces its receipt requests 300ms apart, which is fifteen seconds of
        // real waiting for a full budget. Fake timers turn that into nothing, and draining them
        // alongside the promise is what lets the paced chain run to completion.
        const pending = __test__.extractOperationsInPage({
          windowFromIso: new Date(windowFromMs).toISOString(),
          sessionId: "REDACTED",
          parseStrategy: "fast",
        });
        await vi.runAllTimersAsync();
        const extraction = await pending;

        // A miss is the whole point: it means the connector asked for something the recorder
        // never recorded, so the offline path silently loses that enrichment in production.
        expect(player.misses, `player misses: ${player.misses.join(", ")}`).toEqual([]);
        expect(extraction.blocked_reason ?? null).toBeNull();
        // `mapping_drop_counts` is written into the debug payload at runtime but is not on its
        // declared type, so it is read positionally rather than by widening a shipped interface
        // for a test. Non-empty means the connector saw operations it could not map.
        const debugRecord = (extraction.debug ?? {}) as Record<string, unknown>;
        expect(debugRecord.mapping_drop_counts ?? {}).toEqual({});
        expect(extraction.parsed_transactions_count).toBeGreaterThan(0);

        // The receipt accounting is where recorder and connector have to agree most exactly:
        // the budget, which operations it is spent on, and what counts as a receipt. Derived
        // from this cassette rather than fixed, because a valid recording may hold fewer
        // receipts than the budget — the recorder says as much in a warning — and hard-coding
        // the dense month's fifty would fail every sparser cassette committed later.
        const recordedReceipts = cassette.entries.filter((entry) =>
          entry.url.includes("/api/common/v1/shopping_receipt"),
        ).length;
        const receiptDebug = extraction.debug?.receipt_enrichment;
        expect(receiptDebug?.requested_count).toBe(recordedReceipts);
        // Every issued request ends in exactly one of the two outcomes; which of them it is
        // depends on what the bank returned when the recording was made.
        expect((receiptDebug?.success_count ?? 0) + (receiptDebug?.failed_count ?? 0)).toBe(
          recordedReceipts,
        );

        // Recorded responses nothing asked for are the same drift seen from the other side:
        // the recorder captured requests the connector does not make.
        const unusedPaths = player.unused().map((entry) => new URL(entry.url).pathname);
        expect(unusedPaths, `unused: ${unusedPaths.join(", ")}`).toEqual([]);

        // Zero misses and zero unused entries still do not pin the request count. When a match
        // key runs out of entries the player hands back the first one again rather than
        // reporting a miss, so an extra range request — the very drift this test exists to
        // catch — would leave both those assertions green. Counting requests per key is what
        // closes that: the connector must ask for each key exactly as often as the recording
        // holds it.
        expect(requestsPerKey(fetched), "request count per endpoint").toEqual(
          requestsPerKey(cassette.entries.map((entry) => entry.url)),
        );

        // The count alone still does not pin the walk. `start` and `end` are excluded from the
        // match key on purpose — splitting legitimately re-asks for the same data with different
        // bounds — so a `buildRanges` that moved every boundary while making the same number of
        // calls would replay the recorded payloads against ranges nobody recorded, and every
        // assertion above would stay green. The bounds are compared here, in order, because the
        // player hands operations bodies back in recorded order and that order only means
        // anything if the ranges are the recorded ranges.
        const bounds = (urls: string[]) =>
          urls
            .filter((url) => url.includes("/api/common/v1/operations"))
            .map((url) => {
              const params = new URL(url).searchParams;
              return `${params.get("start")}..${params.get("end")}`;
            });
        expect(bounds(fetched), "range bounds, in order").toEqual(
          bounds(cassette.entries.map((entry) => entry.url)),
        );
      } finally {
        vi.useRealTimers();
        restore();
      }
    });

    it(`keeps every field the row mapping depends on in ${cassette.name}`, () => {
      for (const entry of operationsEntries) {
        const payload = (entry.body as { payload?: Array<Record<string, unknown>> })?.payload ?? [];
        for (const operation of payload) {
          expect(operation.id ?? operation.operationId, "operation identity").toBeDefined();
          expect(
            operation.operationTime ?? operation.debitingTime ?? operation.operationDateTime,
            "operation time",
          ).toBeDefined();
          expect(operation.accountAmount ?? operation.amount, "operation amount").toBeDefined();
          expect(operation.description ?? operation.brand, "operation description").toBeDefined();
        }
      }
    });
  }
});

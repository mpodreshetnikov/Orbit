import { describe, expect, it, vi } from "vitest";
import {
  buildRanges,
  discoverSessionId,
  extractReceiptRequestKey,
  recordCassette,
  type RecorderDeps,
} from "./cassette-console-recorder";

/**
 * The recorder's whole value rests on two properties, and both are asserted here rather than
 * discovered later against a live bank: the session id must not survive into the file, and the
 * URLs it records must be the ones the connector asks for on replay. A cassette that fails
 * either is worse than none — the first leaks a credential, the second replays as misses while
 * looking like a real recording.
 */

const ORIGIN = "https://www.tbank.ru";
const SESSION = "live-session-abc123";
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

function operation(
  id: string,
  amount: number,
  options: { hasReceipt?: boolean } = {},
): Record<string, unknown> {
  return {
    id,
    authorizationId: `auth-${id}`,
    debitingTime: { milliseconds: NOW - 1000 },
    accountAmount: { value: amount, currency: { name: "RUB" } },
    description: "Пятёрочка",
    cardNumber: "4276123456789012",
    clientName: "Иванов Иван Иванович",
    ...(options.hasReceipt === false ? {} : { hasShoppingReceipt: true }),
  };
}

function makeDeps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname === "/api/common/v1/operations") {
      return new Response(JSON.stringify({ payload: [operation("op-1", -2400)] }), { status: 200 });
    }
    if (url.pathname === "/api/common/v1/operation") {
      return new Response(JSON.stringify({ payload: { id: "op-1" } }), { status: 200 });
    }
    if (url.pathname === "/api/common/v1/shopping_receipt") {
      return new Response(
        JSON.stringify({ payload: { receipt: { items: [{ name: "Молоко", sum: 9900 }] } } }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  });

  return {
    fetch: fetchMock as unknown as typeof fetch,
    resourceUrls: () => [
      `${ORIGIN}/api/common/v1/operations?sessionid=${SESSION}&start=1&end=2`,
      `${ORIGIN}/api/common/v1/operation?sessionid=${SESSION}&operationId=op-0`,
    ],
    origin: ORIGIN,
    now: () => NOW,
    ...overrides,
  };
}

describe("cassette console recorder", () => {
  it("refuses to record without a session id in the page's own requests", async () => {
    await expect(
      recordCassette(
        { name: "x", pauseMs: 0 },
        makeDeps({ resourceUrls: () => [`${ORIGIN}/mybank/`] }),
      ),
    ).rejects.toThrow(/No session id/);
  });

  it("records operations and receipts with the session id scrubbed out", async () => {
    const result = await recordCassette(
      { name: "dense-month", pauseMs: 0, maxReceipts: 5 },
      makeDeps(),
    );

    expect(result.leaks).toEqual([]);
    expect(result.counts.receipts).toBe(1);
    const serialized = JSON.stringify(result.cassette);
    expect(serialized).not.toContain(SESSION);
    // The card number is a long digit run and the holder's name is a named field; both are the
    // scrubber's job, and this asserts the recorder actually routes payloads through it.
    expect(serialized).not.toContain("4276123456789012");
    expect(serialized).not.toContain("Иванов");
    // Merchant text and amounts are what the replay asserts on, so they must survive.
    expect(serialized).toContain("Пятёрочка");
    expect(serialized).toContain("Молоко");
  });

  it("records the URL shapes the connector asks for, not a wall of future misses", async () => {
    const result = await recordCassette(
      { name: "dense-month", pauseMs: 0, maxReceipts: 5 },
      makeDeps(),
    );

    // `createCassettePlayer` matches on origin, path, and every query parameter except
    // `sessionid`, `start` and `end`. So what has to hold is that each recorded URL carries the
    // right path and the right *stable* parameter — for a receipt, the operation id the
    // connector will derive from the same operation. These are pinned as literals rather than
    // replayed through the player, because a build script may not import extension runtime
    // code; the end-to-end proof is `tbank-web.contract.test.ts` once a cassette is committed.
    const stableKeys = result.cassette.entries.map((entry) => {
      const url = new URL(entry.url);
      const stable = [...url.searchParams.entries()]
        .filter(([name]) => !["sessionid", "start", "end"].includes(name.toLowerCase()))
        .map(([name, value]) => `${name}=${value}`)
        .join("&");
      return stable ? `${url.pathname}?${stable}` : url.pathname;
    });

    // Four range requests: the default window runs from 1 July Moscow to NOW (20 August), which
    // buildRanges covers in four 14-day chunks.
    expect(stableKeys).toEqual([
      "/api/common/v1/operations",
      "/api/common/v1/operations",
      "/api/common/v1/operations",
      "/api/common/v1/operations",
      "/api/common/v1/operation?operationId=auth-op-1",
      "/api/common/v1/shopping_receipt?operationId=auth-op-1",
    ]);
  });

  it("spends the receipt budget only on operations that carry a receipt", async () => {
    // A transfer at the top of the newest range has a request key like any other operation, so
    // without the connector's own predicate it would eat the budget on a guaranteed miss and
    // the recording would reach no purchase at all.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: [
                operation("transfer-1", -5000, { hasReceipt: false }),
                operation("purchase-1", -2400),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "mixed", pauseMs: 0, maxReceipts: 1 }, deps);

    const receiptUrls = result.cassette.entries
      .map((entry) => entry.url)
      .filter((url) => url.includes("shopping_receipt"));
    expect(receiptUrls).toHaveLength(1);
    expect(receiptUrls[0]).toContain("operationId=auth-purchase-1");
  });

  it("warns rather than silently producing a cassette that proves nothing", async () => {
    const deps = makeDeps({
      fetch: (async () =>
        new Response(JSON.stringify({ payload: [] }), { status: 200 })) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "empty", pauseMs: 0 }, deps);

    expect(result.counts.operations).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/proves nothing/);
  });

  it("splits a capped range and records both halves, as the connector will request them", async () => {
    // The replay player keys every operations request to the same origin and path, ignoring
    // start and end, and hands entries back in recorded order. So a recording that answers a
    // capped range once, where the connector will ask three times, does not merely miss data:
    // it feeds the connector's second request the first request's body.
    const cappedPage = Array.from({ length: 100 }, (unused, index) =>
      operation(`capped-${index}`, -100),
    );
    let operationsRequests = 0;
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          operationsRequests += 1;
          // Only the first response looks capped; the halves come back short.
          const payload = operationsRequests === 1 ? cappedPage : [operation("small-1", -10)];
          return new Response(JSON.stringify({ payload }), { status: 200 });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    // Thirteen days is one whole chunk and no remainder, so the walk starts from exactly one
    // range and every later request is a split of it.
    const result = await recordCassette(
      { name: "dense", pauseMs: 0, windowDays: 13, maxReceipts: 0 },
      deps,
    );

    // One range, capped, split into two halves: three requests, three recorded entries.
    expect(operationsRequests).toBe(3);
    const rangeEntries = result.cassette.entries.filter((entry) =>
      entry.url.includes("/api/common/v1/operations"),
    );
    expect(rangeEntries).toHaveLength(3);
    expect(result.cassette.summary?.truncationSuspected).toBe(1);

    // The halves must cover the parent exactly, with no gap and no overlap, or the split loses
    // whatever falls between them.
    const bounds = rangeEntries.map((entry) => {
      const url = new URL(entry.url);
      return {
        start: Number(url.searchParams.get("start")),
        end: Number(url.searchParams.get("end")),
      };
    });
    const [parent, newer, older] = bounds as [
      (typeof bounds)[0],
      (typeof bounds)[0],
      (typeof bounds)[0],
    ];
    expect(newer.end).toBe(parent.end);
    expect(older.start).toBe(parent.start);
    expect(newer.start - older.end).toBe(1);
  });

  it("reports a single day still at the cap instead of pretending it is complete", async () => {
    const cappedPage = Array.from({ length: 100 }, (unused, index) =>
      operation(`capped-${index}`, -100),
    );
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(JSON.stringify({ payload: cappedPage }), { status: 200 });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette(
      { name: "saturated", pauseMs: 0, windowDays: 2, maxReceipts: 0 },
      deps,
    );

    expect(result.cassette.summary?.truncationUnresolved).toBeGreaterThan(0);
    expect(result.warnings.join(" ")).toMatch(/cannot be split further/);
  });

  it("totals the recording in the bank's own terms, deduplicated across ranges", async () => {
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: [
                // The same operation comes back in every range: adjacent ranges overlap on
                // their bounds, so counting it twice would overstate the month.
                { ...operation("purchase-1", -2400) },
                { ...operation("salary-1", 100000) },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "totals", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(result.cassette.summary?.months).toEqual([
      {
        month: "2026-08",
        currency: "RUB",
        operations: 2,
        income: "100000.00",
        expense: "2400.00",
        // August is the month being recorded into and has not ended, so it is not comparable
        // against the bank — saying so is the point of the flag.
        complete: false,
      },
    ]);
  });

  it("records whole calendar months by default, so a month can be reconciled at all", async () => {
    // A rolling day window lines up with no month the bank shows: thirty days back from the
    // 20th covers two thirds of the previous month, and its total then looks like a loss that
    // never happened. Nothing in a summary could distinguish that from a real one.
    const deps = makeDeps();
    const result = await recordCassette({ name: "months", pauseMs: 0, maxReceipts: 0 }, deps);

    const requested = result.cassette.entries
      .filter((entry) => entry.url.includes("/api/common/v1/operations"))
      .map((entry) => Number(new URL(entry.url).searchParams.get("start")));
    const earliest = Math.min(...requested);

    // NOW is 2026-08-20 12:00 UTC, so the default of two whole months starts at 1 July, Moscow.
    expect(new Date(earliest + 3 * 60 * 60 * 1000).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("marks a month the window covers end to end as comparable", async () => {
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: [
                { ...operation("july-1", -500), debitingTime: { milliseconds: july } },
                operation("august-1", -700),
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "months", pauseMs: 0, maxReceipts: 0 }, deps);
    const byMonth = new Map(result.cassette.summary?.months.map((m) => [m.month, m]) ?? []);

    expect(byMonth.get("2026-07")?.complete).toBe(true);
    expect(byMonth.get("2026-08")?.complete).toBe(false);
  });

  it("does not count a rate-limited receipt as captured", async () => {
    // The bank answers a throttled receipt with HTTP 200 and an error code in the body. Counting
    // it would overstate the cassette, and the replay would retry into the same error forever.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(JSON.stringify({ payload: [operation("op-1", -2400)] }), {
            status: 200,
          });
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          return new Response(
            JSON.stringify({ payload: { resultCode: "REQUEST_RATE_LIMIT_EXCEEDED" } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "throttled", pauseMs: 0 }, deps);

    expect(result.counts.receipts).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/rate-limited/);
  });

  it("records tranche offers only when the page has loaded that endpoint", async () => {
    const withTranche = makeDeps({
      resourceUrls: () => [
        `${ORIGIN}/api/common/v1/operations?sessionid=${SESSION}&start=1&end=2`,
        `${ORIGIN}/api/common/v1/tranche_offers?sessionid=${SESSION}&appName=supreme&platform=web`,
      ],
    });
    const withTrancheResult = await recordCassette(
      { name: "tranche", pauseMs: 0, maxReceipts: 0 },
      withTranche,
    );
    const trancheUrls = withTrancheResult.cassette.entries.filter((entry) =>
      entry.url.includes("tranche_offers"),
    );
    expect(trancheUrls.length).toBeGreaterThan(0);
    // The amount is part of the key the replay matches on, so it has to be there.
    expect(trancheUrls[0]?.url).toContain("amount=2400");
    // And the parameters the page itself used must survive the recording.
    expect(trancheUrls[0]?.url).toContain("appName=supreme");

    // Without the endpoint on the page the connector never asks, so neither may the recorder.
    const withoutTranche = await recordCassette(
      { name: "no-tranche", pauseMs: 0, maxReceipts: 0 },
      makeDeps(),
    );
    expect(
      withoutTranche.cassette.entries.filter((entry) => entry.url.includes("tranche_offers")),
    ).toHaveLength(0);
  });

  it("stops on a blocked session instead of downloading an empty cassette", async () => {
    // The bank reports a lost session inside an HTTP 200 envelope, which reads as "no
    // operations" — and a cassette of error envelopes scrubs perfectly and proves nothing.
    const deps = makeDeps({
      fetch: (async () =>
        new Response(JSON.stringify({ resultCode: "AUTHENTICATION_FAILED" }), {
          status: 200,
        })) as unknown as typeof fetch,
    });

    await expect(recordCassette({ name: "blocked", pauseMs: 0 }, deps)).rejects.toThrow(
      /not authorized/,
    );
  });

  it("walks the same ranges as the connector", () => {
    const ranges = buildRanges(NOW - 30 * 24 * 60 * 60 * 1000, NOW, 14);

    expect(ranges).toHaveLength(3);
    expect(ranges[0]?.end).toBe(NOW);
    expect(ranges.at(-1)?.start).toBe(NOW - 30 * 24 * 60 * 60 * 1000);
  });

  it("derives the receipt key with the connector's precedence", () => {
    expect(
      extractReceiptRequestKey({ authorizationId: "a", operationId: { value: "b" }, id: "c" }),
    ).toBe("a");
    expect(extractReceiptRequestKey({ operationId: { value: "b" }, id: "c" })).toBe("b");
    expect(extractReceiptRequestKey({ id: "c" })).toBe("c");
    expect(extractReceiptRequestKey({})).toBeNull();
  });

  it("takes the most recent session id the page used", () => {
    expect(
      discoverSessionId(
        [`${ORIGIN}/a?sessionid=old`, `${ORIGIN}/b?sessionid=new`, `${ORIGIN}/c`],
        ORIGIN,
      ),
    ).toBe("new");
  });
});

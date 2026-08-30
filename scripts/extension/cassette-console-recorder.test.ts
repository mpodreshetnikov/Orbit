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
    expect(serialized).toContain("9900");
    // The item's own name does not. It is read — it becomes the line item's title — but the real
    // recording put prescription medication in it, so it is replaced by its position: the array,
    // the quantities and the sums stay, and the items stay distinguishable from one another.
    expect(serialized).not.toContain("Молоко");
    expect(serialized).toContain("Позиция 1");
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

  it("does not call a month comparable when a range inside it failed", async () => {
    // A warning is read once; the summary is read every time it is compared against the bank.
    // A range the bank never answered leaves the month short in exactly the way the totals
    // cannot show, so it has to reach the flag as well.
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          if (start <= july && july <= end) return new Response(null, { status: 500 });
          return new Response(JSON.stringify({ payload: [operation("august-1", -700)] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "failed", pauseMs: 0, maxReceipts: 0 }, deps);
    const july2026 = result.cassette.summary?.months.find((month) => month.month === "2026-07");

    expect(result.warnings.join(" ")).toMatch(/answered 500/);
    expect(july2026?.complete ?? false).toBe(false);
  });

  it("keeps a range the bank answered with another success status", async () => {
    // Every request site in the connector tests `response.ok`, so a 206 with a whole payload is
    // an answer to it. Insisting on exactly 200 here discarded those operations and marked the
    // range incomplete, while the connector went on to process them and then ask for details and
    // receipts the cassette does not hold — misses, and totals that do not agree.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(JSON.stringify({ payload: [operation("op-206", -1500)] }), {
            status: 206,
          });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "partial", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(result.warnings.join(" ")).not.toMatch(/answered 206/);
    expect(result.cassette.summary?.months.some((month) => month.operations > 0)).toBe(true);
    expect(result.blockers.join(" ")).not.toMatch(/No operations/);
  });

  it("does not call a month comparable when a range answered 200 with an error envelope", async () => {
    // The bank answers `INVALID_REQUEST_DATA` with HTTP 200, which is how every detail request
    // in the real recording comes back. Nothing about the status line says the range failed, and
    // the envelope carries no `payload` array — so read as an ordinary response it is a range
    // that held no operations, which is exactly what a range the bank refused looks like from
    // here. Marked complete, the month would be reconciled against a total missing everything
    // that range held.
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          if (start <= july && july <= end) {
            return new Response(JSON.stringify({ resultCode: "INVALID_REQUEST_DATA" }), {
              status: 200,
            });
          }
          return new Response(
            JSON.stringify({ resultCode: "OK", payload: [operation("august-1", -700)] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "envelope", pauseMs: 0, maxReceipts: 0 }, deps);
    const july2026 = result.cassette.summary?.months.find((month) => month.month === "2026-07");

    expect(result.warnings.join(" ")).toMatch(/answered 200 with INVALID_REQUEST_DATA/);
    expect(july2026?.complete ?? false).toBe(false);
  });

  it("does not call a month comparable when a range answered 200 with a body that is not JSON", async () => {
    // The other way a 200 arrives without operations: an HTML interstitial, or a proxy page.
    // `detectBlockedReason` only recognises the auth and captcha wording; anything else reaches
    // the extraction as a string with no payload array.
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          if (start <= july && july <= end) {
            return new Response("<html><body>Service unavailable</body></html>", { status: 200 });
          }
          return new Response(JSON.stringify({ payload: [operation("august-1", -700)] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "not-json", pauseMs: 0, maxReceipts: 0 }, deps);
    const july2026 = result.cassette.summary?.months.find((month) => month.month === "2026-07");

    expect(result.warnings.join(" ")).toMatch(/answered 200 with no payload array/);
    expect(july2026?.complete ?? false).toBe(false);
  });

  it("does not call a month comparable when a day inside it stayed capped", async () => {
    // A single day still at the page limit after splitting is a day this recording is short on,
    // and it can sit in the middle of a month the window covers end to end. Marked complete, the
    // console tells the operator that row is safe to compare against the bank, and the contract
    // test then asserts totals already known to omit operations — which makes a real regression
    // indistinguishable from the gap.
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          // Every range covering 15 July comes back at the cap, however far it is split, so the
          // splitting runs down to a single day and gives up there.
          const capped = start <= july && july <= end;
          return new Response(
            JSON.stringify({
              payload: capped
                ? Array.from({ length: 100 }, (_, index) => ({
                    ...operation(`capped-${index}`, -100),
                    debitingTime: { milliseconds: july },
                  }))
                : [],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "capped", pauseMs: 0, maxReceipts: 0 }, deps);
    const july2026 = result.cassette.summary?.months.find((month) => month.month === "2026-07");

    expect(result.cassette.summary?.truncationUnresolved).toBeGreaterThan(0);
    expect(july2026?.complete).toBe(false);
  });

  it("stops on an auth envelope whose status code is a numeric string", async () => {
    // The connector reads `details.httpStatusCode` through `toNum`, so `"401"` is 401 to it and
    // the replay is blocked on the first request. Comparing the raw value against a number here
    // let the recorder carry on and produce a cassette that cannot replay at all.
    const deps = makeDeps({
      fetch: (async () =>
        new Response(JSON.stringify({ details: { httpStatusCode: "401" } }), {
          status: 200,
        })) as unknown as typeof fetch,
    });

    await expect(
      recordCassette({ name: "stringy-401", pauseMs: 0, maxReceipts: 0 }, deps),
    ).rejects.toThrow(/not authorized/);
  });

  it("marks both months when a capped leaf straddles the boundary between them", async () => {
    // A leaf range is at most a day, but a Moscow month boundary falls inside a day. Recording
    // only `range.start` marked the earlier month incomplete and left the later one eligible for
    // reconciliation with part of its first day unread — an operator comparing that total against
    // the bank would be comparing a number known to be short.
    //
    // July is the month under test because the window covers it end to end; August never can be,
    // the recording stopping partway through it, so August could not tell this bug from the
    // ordinary case.
    const boundaryMs = Date.UTC(2026, 5, 30, 21, 0, 0); // 2026-07-01 00:00 Moscow
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const cappedPage = Array.from({ length: 100 }, (unused, index) => ({
      ...operation(`capped-${index}`, -100),
      debitingTime: { milliseconds: boundaryMs + 1000 },
    }));

    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          // Only the range holding the boundary saturates, so only its leaf stays capped — and
          // that leaf begins in June, which is the whole point: June is what `range.start` names.
          if (start <= boundaryMs && boundaryMs <= end) {
            return new Response(JSON.stringify({ payload: cappedPage }), { status: 200 });
          }
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

    const result = await recordCassette(
      { name: "straddle", pauseMs: 0, windowDays: 85, maxReceipts: 0 },
      deps,
    );
    const byMonth = new Map(result.cassette.summary?.months.map((m) => [m.month, m]) ?? []);

    expect(result.cassette.summary?.truncationUnresolved).toBeGreaterThan(0);
    expect(byMonth.get("2026-07")?.complete ?? false).toBe(false);
  });

  it("refuses a recording made below the connector's receipt budget", async () => {
    // The connector's budget is fixed at 50. A recording made below it omits requests the replay
    // will still issue, so the contract test rejects it for receipt misses — handing the file
    // over would only cost someone the time to find that out.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: Array.from({ length: 3 }, (_, index) => operation(`op-${index}`, -100)),
            }),
            { status: 200 },
          );
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          return new Response(
            JSON.stringify({ payload: { receipt: { items: [{ name: "Молоко" }] } } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "short", pauseMs: 0, maxReceipts: 1 }, deps);

    expect(result.blockers.join(" ")).toMatch(/budget is fixed at 50/);

    // And the other direction, which needs more receipt-bearing operations than the budget to
    // show at all: above 50 the cassette holds receipts the replay never asks for, and the
    // contract test rejects those as unused entries. Only the connector's own number replays.
    const denseDeps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: Array.from({ length: 60 }, (_, index) => operation(`op-${index}`, -100)),
            }),
            { status: 200 },
          );
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          return new Response(
            JSON.stringify({ payload: { receipt: { items: [{ name: "Молоко" }] } } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const tooMany = await recordCassette({ name: "long", pauseMs: 0, maxReceipts: 80 }, denseDeps);
    expect(tooMany.blockers.join(" ")).toMatch(/budget is fixed at 50/);

    // At the connector's own budget the same window is fine.
    const exact = await recordCassette({ name: "exact", pauseMs: 0, maxReceipts: 50 }, denseDeps);
    expect(exact.blockers.join(" ")).toEqual("");

    // One above it, with more receipts available than either budget. This is the interval the
    // check used to miss: it is neither "recorded fewer than the connector will ask for" nor
    // large enough for the old second branch, so nothing fired — while the recording held 51
    // receipt entries for the 50 the replay issues, which is one unused entry and a request
    // count that does not match.
    const justOver = await recordCassette({ name: "over", pauseMs: 0, maxReceipts: 51 }, denseDeps);
    expect(justOver.blockers.join(" ")).toMatch(
      /records 51 of them where the connector asks for 50/,
    );
  });

  it("refuses a recording whose range span is not the connector's", async () => {
    // `buildRanges` decides how many requests there are and where their bounds fall, and the
    // replay compares both. Any span but the connector's produces a walk it cannot reproduce.
    const deps = makeDeps();

    const result = await recordCassette(
      { name: "chunked", pauseMs: 0, maxReceipts: 0, chunkDays: 7 },
      deps,
    );

    expect(result.blockers.join(" ")).toMatch(/chunkDays/);
  });

  it("refuses a recording with no operations at all", async () => {
    // The contract test needs at least one mapped operation and the replay throws on an empty
    // operation map, so such a cassette cannot pass the suite it exists for.
    const deps = makeDeps({
      fetch: (async () =>
        new Response(JSON.stringify({ payload: [] }), { status: 200 })) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "empty", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(result.blockers.join(" ")).toMatch(/No operations were recorded/);
  });

  it("measures truncation on the raw payload, as the connector does", async () => {
    // The connector reads `payload.length` before skipping anything that is not an object. A
    // response of exactly the page limit with one malformed entry looks capped to it and short to
    // a recorder that filtered first — so it splits the range and the recorder would not.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const payload: unknown[] = Array.from({ length: 99 }, (_, index) =>
            operation(`op-${index}`, -100),
          );
          payload.push(null);
          return new Response(JSON.stringify({ payload }), { status: 200 });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "raw", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(result.cassette.summary?.truncationSuspected).toBeGreaterThan(0);
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
          // Top level, which is where the connector's `extractReceiptResultCode` looks.
          return new Response(JSON.stringify({ resultCode: "REQUEST_RATE_LIMIT_EXCEEDED" }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "throttled", pauseMs: 0 }, deps);

    expect(result.counts.receipts).toBe(0);
    // A blocker, not a warning: the connector retries a throttled receipt, so it issues more
    // requests than this recording holds and the replay's request count cannot match.
    expect(result.blockers.join(" ")).toMatch(/rate-limited/);
  });

  it("does not count a receipt the bank failed to return", async () => {
    // A real recording hit one 504. The body that comes back is a gateway error page, not a
    // receipt: counting it would claim enrichment the cassette cannot replay, and the person
    // reading the summary would have no reason to re-record.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(JSON.stringify({ payload: [operation("op-1", -2400)] }), {
            status: 200,
          });
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          return new Response("<html>Gateway Timeout</html>", { status: 504 });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "timeout", pauseMs: 0 }, deps);

    expect(result.counts.receipts).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/non-200/);
  });

  it("subtracts a purchase refund from spending, as the bank's own totals do", async () => {
    // Counted as income instead, the recorded month exceeds the bank on both sides by the
    // refund, and every reconciliation then needs the same correction done by hand. This is
    // how a real account's two months came to differ by 5575.00 and 4068.00.
    const july = Date.UTC(2026, 6, 15, 9, 0, 0);
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: [
                { ...operation("purchase", -2400), debitingTime: { milliseconds: july } },
                {
                  ...operation("refund", 900),
                  group: "PAY",
                  debitingTime: { milliseconds: july },
                },
                {
                  ...operation("salary", 100000),
                  group: "INCOME",
                  debitingTime: { milliseconds: july },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "refund", pauseMs: 0, maxReceipts: 0 }, deps);
    const july2026 = result.cassette.summary?.months.find((month) => month.month === "2026-07");

    expect(july2026?.expense).toBe("1500.00");
    expect(july2026?.income).toBe("100000.00");
  });

  it("never attaches the session id to a URL from another origin", async () => {
    // The resource timeline holds whatever the page loaded, third parties included. Matching a
    // candidate on path alone would accept a foreign origin, and the request builder then
    // appends the live session id and fetches it — CORS does not stop the request going out.
    const fetched: string[] = [];
    const deps = makeDeps({
      resourceUrls: () => [
        `https://elsewhere.example/api/common/v1/operations?sessionid=stolen&start=1&end=2`,
        `${ORIGIN}/api/common/v1/operations?sessionid=${SESSION}&start=1&end=2`,
      ],
      fetch: (async (input: RequestInfo | URL) => {
        fetched.push(typeof input === "string" ? input : input.toString());
        return new Response(JSON.stringify({ payload: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    await recordCassette({ name: "origins", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) expect(new URL(url).origin).toBe(ORIGIN);
  });

  it("takes no session id from a foreign URL", () => {
    expect(
      discoverSessionId(
        [`https://elsewhere.example/api/common/v1/operations?sessionid=not-ours`],
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("spends the receipt budget on requests issued, not on receipts captured", async () => {
    // The connector's budget counts issued requests. Counting successes instead lets a run that
    // keeps failing issue requests without limit — which is exactly the run the bank is
    // throttling, so the failures feed on themselves.
    let receiptRequests = 0;
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: Array.from({ length: 10 }, (_, index) => operation(`op-${index}`, -100)),
            }),
            { status: 200 },
          );
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          receiptRequests += 1;
          return new Response("<html>Gateway Timeout</html>", { status: 504 });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "budget", pauseMs: 0, maxReceipts: 3 }, deps);

    expect(receiptRequests).toBe(3);
    expect(result.counts.receipts).toBe(0);
  });

  it("does not count a 200 that carries no receipt items", async () => {
    // The connector counts a success only when the payload actually holds items; the bank
    // answers some requests with a well-formed but empty envelope.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(JSON.stringify({ payload: [operation("op-1", -2400)] }), {
            status: 200,
          });
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          return new Response(JSON.stringify({ payload: { receipt: { items: [] } } }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "empty", pauseMs: 0 }, deps);

    expect(result.counts.receipts).toBe(0);
  });

  it("records the tranche URL with the connector's own defaults filled in", async () => {
    // The replay matches on every query parameter but sessionid, start and end, so a URL
    // recorded with only the parameters the page happened to carry misses on replay — silently,
    // because a miss is indistinguishable from enrichment the connector chose not to request.
    const deps = makeDeps({
      resourceUrls: () => [
        `${ORIGIN}/api/common/v1/operations?sessionid=${SESSION}&start=1&end=2`,
        `${ORIGIN}/api/common/v1/tranche_offers?sessionid=${SESSION}&wuid=abc`,
      ],
    });

    const result = await recordCassette({ name: "tranche", pauseMs: 0, maxReceipts: 0 }, deps);
    const tranche = result.cassette.entries.find((entry) => entry.url.includes("tranche_offers"));
    const params = new URL(tranche?.url ?? "").searchParams;

    expect(params.get("appName")).toBe("supreme");
    expect(params.get("appVersion")).toBe("0.0.1");
    expect(params.get("platform")).toBe("web");
    expect(params.get("program_type")).toBe("rpk_kk");
    expect(params.get("origin")).toBe("web,ib5,platform");
    expect(params.get("amount")).toBe("2400");
    // Recorded redacted: it identifies the browser session the recording was made from.
    expect(params.get("wuid")).toBe("REDACTED");
  });

  it("does not invent the detail endpoint the page never loaded", async () => {
    // The connector's `discoverOperationDetailApiUrl` returns null and it skips detail
    // enrichment. Defaulting the URL here would record one response per operation that the
    // replay never asks for — hundreds of extra calls against a live session, for nothing.
    const deps = makeDeps({
      resourceUrls: () => [`${ORIGIN}/api/common/v1/operations?sessionid=${SESSION}&start=1&end=2`],
    });

    const result = await recordCassette({ name: "no-detail", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(
      result.cassette.entries.filter((entry) => entry.url.includes("/api/common/v1/operation?")),
    ).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/detail endpoint/);
  });

  it("reads a date-string operation time the way the connector does", async () => {
    // `operationDateTime` arrives as an ISO string, and the connector's `toMs` parses it. Read
    // as a number only, the operation vanishes from the summary and from every enrichment
    // request while the connector goes on processing it and asking for entries nobody recorded.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          const { debitingTime: _dropped, ...rest } = operation("op-1", -2400);
          return new Response(
            JSON.stringify({
              payload: [{ ...rest, operationDateTime: new Date(NOW - 1000).toISOString() }],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "isodate", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(result.cassette.summary?.months.map((month) => month.month)).toEqual(["2026-08"]);
  });

  it("reads a timestamp the bank serialised as a string", async () => {
    // The connector's `toNum` parses numeric strings. Rejecting them here would drop the
    // operation from the summary and from enrichment while the connector went on asking for
    // entries the cassette does not hold.
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: [
                {
                  ...operation("op-1", -2400),
                  debitingTime: { milliseconds: String(NOW - 1000) },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await recordCassette({ name: "strings", pauseMs: 0, maxReceipts: 0 }, deps);

    expect(result.cassette.summary?.months.map((month) => month.month)).toEqual(["2026-08"]);
  });

  it("spends the receipt budget newest-first, as the connector does", async () => {
    // When a window holds more receipt-bearing operations than the budget allows, which ones
    // get asked for is decided by that order. A different set replays as a miss for every one.
    const asked: string[] = [];
    const deps = makeDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/common/v1/operations") {
          return new Response(
            JSON.stringify({
              payload: [
                { ...operation("old", -100), debitingTime: { milliseconds: NOW - 900_000 } },
                { ...operation("new", -200), debitingTime: { milliseconds: NOW - 1_000 } },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          asked.push(url.searchParams.get("operationId") ?? "");
          return new Response(
            JSON.stringify({ payload: { receipt: { items: [{ name: "Молоко" }] } } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ payload: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    await recordCassette({ name: "order", pauseMs: 0, maxReceipts: 1 }, deps);

    expect(asked).toEqual(["auth-new"]);
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

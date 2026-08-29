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
      recordCassette({ name: "x" }, makeDeps({ resourceUrls: () => [`${ORIGIN}/mybank/`] })),
    ).rejects.toThrow(/No session id/);
  });

  it("records operations and receipts with the session id scrubbed out", async () => {
    const result = await recordCassette({ name: "dense-month", maxReceipts: 5 }, makeDeps());

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
    const result = await recordCassette({ name: "dense-month", maxReceipts: 5 }, makeDeps());

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

    expect(stableKeys).toEqual([
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

    const result = await recordCassette({ name: "mixed", maxReceipts: 1 }, deps);

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

    const result = await recordCassette({ name: "empty" }, deps);

    expect(result.counts.operations).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/proves nothing/);
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

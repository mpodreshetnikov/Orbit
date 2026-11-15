/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { __test__ } from "./tbank-web.js";
import {
  createCassettePlayer,
  matchKey,
  type Cassette,
} from "../../../test/helpers/tbank/cassette-replay";
import syntheticCassetteModule from "../../../test/fixtures/tbank/cassettes/synthetic-month/cassette.json";

/**
 * Guards the connector against a recorded (or synthetic) bank session without signing in.
 * Replay goes through createCassettePlayer so request matching and bodyless statuses are the
 * same code the Playwright acceptance harness uses.
 */

const DAY = 24 * 60 * 60 * 1000;

function withInRangeOperationTimes(cassette: Cassette, nowMs: number): Cassette {
  const inRangeMs = nowMs - 2 * DAY;
  return {
    ...cassette,
    entries: cassette.entries.map((entry) => {
      if (!entry.body || typeof entry.body !== "object") return entry;
      const body = entry.body as Record<string, unknown>;
      const payload = body.payload;
      if (!Array.isArray(payload)) return entry;
      return {
        ...entry,
        body: {
          ...body,
          payload: payload.map((operation, index) => {
            if (!operation || typeof operation !== "object") return operation;
            return {
              ...operation,
              operationTime: { milliseconds: inRangeMs - index * 60 * 60 * 1000 },
            };
          }),
        },
      };
    }),
  };
}

describe("tbank-web cassette contract", () => {
  it("replays the synthetic cassette through the production extractor with no misses", async () => {
    const nowMs = Date.now();
    const cassette = withInRangeOperationTimes(syntheticCassetteModule as Cassette, nowMs);
    const player = createCassettePlayer(cassette);

    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: {
      windowFromIso?: string;
      sessionId?: string | null;
      sourceId?: string | null;
      payerPersonId?: string | null;
    }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;
    const originalChrome = (globalThis as Record<string, unknown>).chrome;

    (globalThis as Record<string, unknown>).window = {
      location: {
        href: "https://www.tbank.ru/mybank/operations/",
        origin: "https://www.tbank.ru",
      },
    };
    (globalThis as Record<string, unknown>).document = {
      body: { innerText: "Operations" },
      querySelectorAll: vi.fn().mockReturnValue([]),
    };
    (globalThis as Record<string, unknown>).performance = {
      getEntriesByType: vi.fn().mockImplementation((type: string) => {
        if (type !== "resource") return [];
        return [
          {
            name: "https://www.tbank.ru/api/common/v1/operations?sessionid=abc&start=1&end=2",
          },
          {
            name: "https://www.tbank.ru/api/common/v1/operation?sessionid=abc",
          },
          {
            name: "https://www.tbank.ru/api/common/v1/tranche_offers?sessionid=abc&appName=tbank",
          },
        ];
      }),
    };
    (globalThis as Record<string, unknown>).URL = URL;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: vi
          .fn()
          .mockImplementation((_message: unknown, callback?: (value: unknown) => void) => {
            callback?.({ ok: true, states: [] });
          }),
      },
    };
    (globalThis as Record<string, unknown>).fetch = player.fetch;

    try {
      const result = await isolatedExtractor({
        windowFromIso: new Date(nowMs - 7 * DAY).toISOString(),
        sessionId: "live-session",
        sourceId: "tbank_web",
        payerPersonId: "person-synth",
      });

      expect(player.misses).toEqual([]);
      expect(result.method).toBe("api");
      expect(result.blocked_reason).toBeFalsy();
      const records = (result.operation_records ?? []) as Array<Record<string, unknown>>;
      expect(records.length).toBeGreaterThanOrEqual(2);

      const rows = records
        .map((record) => __test__.mapOperationRecordToRow(record, { extractionMethod: "api" }))
        .filter(Boolean);
      expect(rows).toHaveLength(records.length);
      expect(rows.some((row) => Array.isArray(row?.line_items) && row.line_items.length > 0)).toBe(
        true,
      );
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
      (globalThis as Record<string, unknown>).chrome = originalChrome;
    }
  });

  it("keeps wuid out of the match key so redacted recordings still hit", () => {
    expect(
      matchKey(
        "https://www.tbank.ru/api/common/v1/tranche_offers?sessionid=a&wuid=REDACTED&operationId=1",
      ),
    ).toBe(
      matchKey(
        "https://www.tbank.ru/api/common/v1/tranche_offers?sessionid=b&wuid=live&operationId=1",
      ),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import connector, { __test__ } from "./tbank-web.js";

describe("tbank-web connector", () => {
  it("registers expected connector metadata", () => {
    expect(connector.sourceId).toBe("tbank_web");
    expect(connector.displayName).toBe("T-Bank Web");
    expect(typeof connector.parse).toBe("function");
  });

  it("builds backward ranges from now to windowFrom", () => {
    const windowFromMs = Date.parse("2026-01-01T00:00:00.000Z");
    const nowMs = Date.parse("2026-01-15T00:00:00.000Z");

    const ranges = __test__.buildOperationRanges(windowFromMs, nowMs, 5);

    expect(ranges[0]).toEqual({
      start: Date.parse("2026-01-10T00:00:00.001Z"),
      end: nowMs,
    });
    expect(ranges[ranges.length - 1].start).toBe(windowFromMs);
    expect(ranges.every((range) => range.end >= range.start)).toBe(true);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i - 1].start - 1).toBe(ranges[i].end);
    }
  });

  it("prefers the exact operations endpoint over histogram and category endpoints", () => {
    const url = __test__.findLatestResourceUrlByPath(
      [
        "https://www.tbank.ru/api/common/v1/operations?start=1&end=2",
        "https://www.tbank.ru/api/common/v1/operations_category_list_user?platform=web&sessionid=abc",
        "https://www.tbank.ru/api/common/v1/operations_histogram?period=day&sessionid=abc",
      ],
      "/api/common/v1/operations",
      "https://www.tbank.ru",
    );

    expect(url).toBe("https://www.tbank.ru/api/common/v1/operations?start=1&end=2");
  });

  it("treats login redirect URLs as blocked even when page text is inconclusive", () => {
    const reason = __test__.detectBlockedReasonFromPageState(
      "https://www.tbank.ru/auth/login/?redirectTo=%2Fmybank%2Foperations%2F",
      "",
    );

    expect(reason).toBe("T-Bank session is not authorized. Sign in and retry import.");
  });

  it("treats AUTHENTICATION_FAILED operations payloads as blocked auth", () => {
    const reason = __test__.detectBlockedReasonFromApiEnvelope({
      resultCode: "AUTHENTICATION_FAILED",
      errorMessage: "Не указан пользователь",
      details: {
        errorCode: "INSUFFICIENT_PRIVILEGES",
        httpStatusCode: 401,
      },
    });

    expect(reason).toBe("T-Bank session is not authorized. Sign in and retry import.");
  });

  it("keeps the in-page extractor self-contained when serialized for executeScript", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: { windowFromIso?: string }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;

    (globalThis as Record<string, unknown>).window = {
      location: {
        href: "https://www.tbank.ru/auth/login/?redirectTo=%2Fmybank%2Foperations%2F",
        origin: "https://www.tbank.ru",
      },
    };
    (globalThis as Record<string, unknown>).document = {
      body: { innerText: "" },
    };
    (globalThis as Record<string, unknown>).performance = {
      getEntriesByType: vi.fn().mockReturnValue([]),
    };
    (globalThis as Record<string, unknown>).fetch = vi.fn();
    (globalThis as Record<string, unknown>).URL = URL;

    try {
      const result = await isolatedExtractor({
        windowFromIso: "2026-02-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({
        method: "api",
        blocked_reason: "T-Bank session is not authorized. Sign in and retry import.",
      });
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
    }
  });

  it("maps operation record into canonical row with all details preserved", () => {
    const operationRecord = {
      operation: {
        id: "143160245258",
        operationId: { value: "112196258285", source: "PrimeAuth" },
        authorizationId: "112196258285",
        operationTime: { milliseconds: 1772680882000 },
        debitingTime: { milliseconds: 1772680892000 },
        type: "Debit",
        status: "OK",
        amount: { value: 3349, currency: { code: 643, name: "RUB", strCode: "RUB" } },
        accountAmount: { value: 3349, currency: { code: 643, name: "RUB", strCode: "RUB" } },
        group: "PAY",
        description: "Samokat",
        mcc: 5411,
        mccString: "MCC 5411",
        merchant: { name: "Samokat", id: "17525", region: "Moscow" },
        cardNumber: "220070******6986",
        message: "Leave near door",
        loyaltyBonusSummary: {
          amount: 101,
        },
        cashbackAmount: {
          value: 0,
          currency: { code: 643, name: "RUB", strCode: "RUB" },
        },
        documents: ["Statement", "ShoppingReceipt"],
      },
      operationDetail: {
        payload: {
          source: "detail_endpoint",
          timeline: [{ status: "OK" }],
        },
      },
      shoppingReceipt: {
        payload: {
          receipt: {
            totalSum: 3349,
            operationType: 1,
            items: [
              {
                name: "Chicken roll",
                price: 369,
                sum: 369,
                quantity: 1,
              },
              {
                name: "Pasta",
                price: 329,
                sum: 658,
                quantity: 2,
              },
            ],
          },
        },
      },
    };

    const row = __test__.mapOperationRecordToRow(operationRecord, {
      extractionMethod: "api",
    });

    expect(row).not.toBeNull();
    expect(row?.account_id).toBeNull();
    expect(row?.external_id).toBe("143160245258");
    expect(row?.amount).toBe(-3349);
    expect(row?.currency).toBe("RUB");
    expect(row?.transaction_type).toBe("expense");
    expect(row?.comment).toBe("Leave near door");
    expect(row?.source_comment).toBe("Leave near door");
    expect(row?.cashback_amount).toBe(101);
    expect(row?.cashback_currency).toBe("RUB");
    expect(row?.mcc).toBe("5411");
    expect((row?.raw_payload as Record<string, unknown>)?.account_hint).toBe("6986");
    expect(row?.dedupe_hash).toMatch(/^tbw_/);
    expect(row?.line_items).toHaveLength(2);
    expect((row?.line_items as Array<Record<string, unknown>>)[0]?.title).toBe("Chicken roll");
    expect((row?.line_items as Array<Record<string, unknown>>)[1]?.amount).toBe(-658);
    expect((row?.raw_payload as Record<string, unknown>)?.operation).toBeTruthy();
    expect((row?.raw_payload as Record<string, unknown>)?.operation_detail).toBeTruthy();
    expect((row?.raw_payload as Record<string, unknown>)?.shopping_receipt).toBeTruthy();
    expect((row?.raw_payload as Record<string, unknown>)?.all_details_captured).toBe(true);
  });

  it("does not derive card hint from operation.account-only values", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "op-no-card",
          operationTime: { milliseconds: 1772680882000 },
          type: "Debit",
          status: "OK",
          amount: { value: 100, currency: { strCode: "RUB" } },
          accountAmount: { value: 100, currency: { strCode: "RUB" } },
          description: "Account transfer",
          account: "40817810000000000001",
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    );

    const rawPayload = (row?.raw_payload as Record<string, unknown>) ?? {};
    expect(rawPayload.account_hint).toBeNull();
  });

  it("falls back to single line item when receipt is missing", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "income-1",
          operationTime: { milliseconds: 1772680882000 },
          type: "Credit",
          status: "OK",
          amount: { value: 1200, currency: { name: "RUB", strCode: "RUB" } },
          accountAmount: { value: 1200, currency: { name: "RUB", strCode: "RUB" } },
          description: "Transfer from employer",
          group: "PAY",
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    );

    expect(row).not.toBeNull();
    expect(row?.amount).toBe(1200);
    expect(row?.transaction_type).toBe("income");
    expect(row?.line_items).toHaveLength(1);
    expect((row?.line_items as Array<Record<string, unknown>>)[0]?.amount).toBe(1200);
  });

  it("uses page extraction output and maps records to rows", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: 77,
        url: "https://www.tbank.ru/mybank/operations/",
      },
    ]);
    const update = vi.fn();
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [
            {
              operation: {
                id: "op-1",
                operationTime: { milliseconds: 1772680882000 },
                type: "Debit",
                status: "OK",
                amount: { value: 100, currency: { strCode: "RUB" } },
                accountAmount: { value: 100, currency: { strCode: "RUB" } },
                description: "Cafe",
              },
              operationDetail: { payload: { id: "op-1-detail" } },
              shoppingReceipt: null,
            },
          ],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 1,
        },
      },
    ]);

    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query,
        update,
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript,
      },
    } as unknown as typeof chrome;

    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      session: { default_account_id: "acc-1" },
    });

    expect(query).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript.mock.calls[0]?.[0]?.args?.[0]).toEqual({
      windowFromIso: "2026-02-01T00:00:00.000Z",
    });
    expect(result.parsedTransactionsCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.account_id).toBeNull();
    expect(result.rows[0]?.amount).toBe(-100);
    expect(result.rows[0]?.line_items).toHaveLength(1);
  });

  it("throws blocked reason from page extraction", async () => {
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 77,
            url: "https://www.tbank.ru/mybank/operations/",
          },
        ]),
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([
          {
            result: {
              method: "api",
              blocked_reason: "T-Bank session is not authorized. Sign in and retry import.",
              operation_records: [],
              window_to: "2026-03-05T12:00:00.000Z",
              parsed_through_at: "2026-02-01T00:00:00.000Z",
              parsed_transactions_count: 0,
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    await expect(
      connector.parse({
        source: "tbank_web",
        windowFrom: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("T-Bank session is not authorized. Sign in and retry import.");
  });

  it("retries extraction once when executeScript returns no usable result", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        id: 77,
        url: "https://www.tbank.ru/mybank/operations/",
        status: "complete",
      })
      .mockResolvedValueOnce({
        id: 77,
        url: "https://www.tbank.ru/mybank/operations/",
        status: "complete",
      });
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: undefined }])
      .mockResolvedValueOnce([
        {
          result: {
            method: "api",
            operation_records: [
              {
                operation: {
                  id: "op-retry",
                  operationTime: { milliseconds: 1772680882000 },
                  type: "Debit",
                  status: "OK",
                  amount: { value: 250, currency: { strCode: "RUB" } },
                  accountAmount: { value: 250, currency: { strCode: "RUB" } },
                  description: "Retry cafe",
                },
                operationDetail: null,
                shoppingReceipt: null,
              },
            ],
            window_to: "2026-03-05T12:00:00.000Z",
            parsed_through_at: "2026-02-01T00:00:00.000Z",
            parsed_transactions_count: 1,
          },
        },
      ]);

    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 77,
            url: "https://www.tbank.ru/mybank/operations/",
          },
        ]),
        get,
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript,
      },
    } as unknown as typeof chrome;

    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amount).toBe(-250);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("throws diagnostics when executeScript still returns no usable result after retry", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        id: 77,
        url: "https://www.tbank.ru/mybank/operations/",
        status: "complete",
      })
      .mockResolvedValueOnce({
        id: 77,
        url: "https://www.tbank.ru/mybank/operations/",
        status: "complete",
      });

    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 77,
            url: "https://www.tbank.ru/mybank/operations/",
          },
        ]),
        get,
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: undefined }]),
      },
    } as unknown as typeof chrome;

    await expect(
      connector.parse({
        source: "tbank_web",
        windowFrom: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/Unable to extract operations from current page.*execute_script_attempts/);
  });

  it("includes fallback diagnostics when API fails but DOM rows are present", async () => {
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 77,
            url: "https://www.tbank.ru/mybank/operations/",
          },
        ]),
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([
          {
            result: {
              method: "dom",
              rows: [
                {
                  account_id: null,
                  card_id: null,
                  source: "tbank",
                  external_id: null,
                  posted_at: "2026-03-05T10:00:00.000Z",
                  amount: -100,
                  currency: "RUB",
                  transaction_type: "expense",
                  status: "posted",
                  merchant_name: "Cafe",
                  mcc: null,
                  comment: null,
                  is_transfer: false,
                  transfer_group_id: null,
                  raw_payload: { extraction_method: "dom" },
                  dedupe_hash: "tbw_dom_1",
                  line_items: [{ title: "Cafe", amount: -100 }],
                },
              ],
              window_to: "2026-03-05T12:00:00.000Z",
              parsed_through_at: "2026-03-05T10:00:00.000Z",
              parsed_transactions_count: 1,
              debug: {
                extraction_method: "dom",
                fallback_used: true,
                fallback_reason: "No operations returned by API",
                blocked_reason: null,
                discovered_endpoints: {
                  operations_api: "https://www.tbank.ru/api/common/v1/operations?sessionid=abc",
                  operation_detail_api: null,
                  tranche_offers_api: null,
                },
                range_attempts: [
                  {
                    start: 100,
                    end: 200,
                    status_code: 500,
                    payload_count: null,
                  },
                ],
                response_status_histogram: {
                  "500": 1,
                },
                stage_timings_ms: {
                  api: 200,
                  dom: 40,
                },
                api_error_message: "No operations returned by API",
                api_operation_count: 0,
                dom_row_count: 1,
              },
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      session: { default_account_id: "acc-1" },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.debug?.extraction_method).toBe("dom");
    expect(result.debug?.fallback_used).toBe(true);
    expect(result.debug?.fallback_reason).toContain("No operations returned by API");
    expect(result.debug?.discovered_endpoints?.operations_api).toContain("sessionid=<redacted>");
    expect(result.debug?.rows_without_line_items).toBe(0);
  });

  it("throws structured diagnostics when DOM fallback yields zero rows", async () => {
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 77,
            url: "https://www.tbank.ru/mybank/operations/",
          },
        ]),
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([
          {
            result: {
              method: "dom",
              rows: [],
              window_to: "2026-03-05T12:00:00.000Z",
              parsed_through_at: "2026-03-05T00:00:00.000Z",
              parsed_transactions_count: 0,
              debug: {
                extraction_method: "dom",
                fallback_used: true,
                fallback_reason: "No operations returned by API",
                blocked_reason: null,
                discovered_endpoints: {
                  operations_api: null,
                  operation_detail_api: null,
                  tranche_offers_api: null,
                },
                range_attempts: [],
                response_status_histogram: {},
                stage_timings_ms: {},
                api_error_message: "No operations returned by API",
                api_operation_count: 0,
                dom_row_count: 0,
              },
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    await expect(
      connector.parse({
        source: "tbank_web",
        windowFrom: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/DOM fallback returned zero rows.*diagnostics=/);
  });
});

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

  it("never selects a URL from another origin even when its path matches", () => {
    // The resource timeline holds whatever the page loaded, third parties included. Matching a
    // candidate on path alone would accept a foreign origin, and the request builder then
    // appends the live session id and fetches it — CORS does not stop the request going out.
    // Foreign entry is last so a path-only scan would prefer it; origin guard must skip it.
    const url = __test__.findLatestResourceUrlByPath(
      [
        "https://www.tbank.ru/api/common/v1/operations?sessionid=ours&start=1&end=2",
        "https://elsewhere.example/api/common/v1/operations?sessionid=stolen&start=1&end=2",
      ],
      "/api/common/v1/operations",
      "https://www.tbank.ru",
    );

    expect(url).toBe("https://www.tbank.ru/api/common/v1/operations?sessionid=ours&start=1&end=2");
  });

  it("returns null when only a foreign-origin candidate matches the path", () => {
    const url = __test__.findLatestResourceUrlByPath(
      ["https://elsewhere.example/api/common/v1/operations?sessionid=stolen"],
      "/api/common/v1/operations",
      "https://www.tbank.ru",
    );

    expect(url).toBeNull();
  });

  it("estimates full-mode receipt time using the current pause and cooldown window", () => {
    expect(__test__.estimateFullModeReceiptEnrichmentMs(0)).toBe(0);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(1)).toBe(30750);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(70)).toBe(358500);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(71)).toBe(688250);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(108)).toBe(864000);
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

  it("skips all enrichment calls for fulfilled and out-of-range operations", async () => {
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

    const fetchCalls: string[] = [];
    // Anchored to the run, not to fixed dates. The connector splits
    // [windowFrom, now] into 14-day chunks (buildOperationRanges, nowMs =
    // Date.now()) and requests each one; this mock answers every chunk with the
    // same payload, so the out-of-range operation is skipped once per chunk.
    // With a hardcoded 2026-03-01 window that count grew by one every fortnight
    // of real time and had already reached 13 against an expected 2. A window
    // shorter than one chunk keeps it at a single range.
    const DAY = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const windowFromIso = new Date(nowMs - 7 * DAY).toISOString();
    const inRangeMs = nowMs - 2 * DAY;
    const outOfRangeMs = nowMs - 30 * DAY;
    const operationsPayload = [
      {
        id: "op-fulfilled",
        authorizationId: "auth-fulfilled",
        operationTime: { milliseconds: inRangeMs },
        type: "Debit",
        status: "OK",
        amount: { value: 100, currency: { strCode: "RUB" } },
        accountAmount: { value: 100, currency: { strCode: "RUB" } },
        description: "Fulfilled",
        documents: ["ShoppingReceipt"],
      },
      {
        id: "op-incomplete",
        authorizationId: "auth-incomplete",
        operationTime: { milliseconds: inRangeMs - 60 * 60 * 1000 },
        type: "Debit",
        status: "OK",
        amount: { value: 200, currency: { strCode: "RUB" } },
        accountAmount: { value: 200, currency: { strCode: "RUB" } },
        description: "Incomplete",
        documents: ["ShoppingReceipt"],
      },
      {
        id: "op-old",
        authorizationId: "auth-old",
        operationTime: { milliseconds: outOfRangeMs },
        type: "Debit",
        status: "OK",
        amount: { value: 300, currency: { strCode: "RUB" } },
        accountAmount: { value: 300, currency: { strCode: "RUB" } },
        description: "Old",
        documents: ["ShoppingReceipt"],
      },
    ];

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
        sendMessage: vi.fn().mockImplementation((message: Record<string, unknown>, callback) => {
          if (message.type === "MONEY_IMPORT_GET_EXISTING_TRANSACTION_STATES") {
            callback?.({
              ok: true,
              states: [
                {
                  transaction_id: "tx-fulfilled",
                  exists: true,
                  fulfilled: true,
                  has_only_synthetic_line_items: false,
                  has_real_line_items: true,
                  receipt_enrichment_status: "ok",
                },
                {
                  transaction_id: "tx-incomplete",
                  exists: true,
                  fulfilled: false,
                  has_only_synthetic_line_items: true,
                  has_real_line_items: false,
                  receipt_enrichment_status: "ok",
                },
                {
                  transaction_id: null,
                  exists: false,
                  fulfilled: false,
                  has_only_synthetic_line_items: false,
                  has_real_line_items: false,
                  receipt_enrichment_status: null,
                },
              ],
            });
            return;
          }
          callback?.({ ok: true });
        }),
      },
    };
    (globalThis as Record<string, unknown>).fetch = vi
      .fn()
      .mockImplementation(async (input: string) => {
        fetchCalls.push(input);
        const url = new URL(input);
        if (url.pathname === "/api/common/v1/operations") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: operationsPayload }),
          };
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              payload: {
                receipt: {
                  items: [{ name: "Item", sum: 200, quantity: 1 }],
                },
              },
            }),
          };
        }
        if (url.pathname === "/api/common/v1/operation") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: { message: "detail" } }),
          };
        }
        if (url.pathname === "/api/common/v1/tranche_offers") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: [] }),
          };
        }
        return { ok: false, status: 404, json: async () => null };
      });

    try {
      const result = await isolatedExtractor({
        windowFromIso,
        sessionId: "abc",
        sourceId: "tbank_web",
        payerPersonId: "person-1",
      });

      expect(fetchCalls.filter((url) => url.includes("/shopping_receipt"))).toHaveLength(1);
      expect(fetchCalls.filter((url) => url.includes("/api/common/v1/operation?"))).toHaveLength(1);
      expect(fetchCalls.filter((url) => url.includes("/tranche_offers"))).toHaveLength(1);
      const records = (result.operation_records ?? []) as Array<Record<string, unknown>>;
      expect(records).toHaveLength(2);
      expect(records[0]?.shoppingReceiptMeta).toMatchObject({
        receipt_enrichment_status: "not_requested",
        skip_reason: "already_fulfilled",
      });
      expect(records[1]?.shoppingReceiptMeta).toMatchObject({
        receipt_enrichment_status: "ok",
      });
      expect(result.debug).toMatchObject({
        preflight_enrichment_skip_count: 2,
      });
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
      (globalThis as Record<string, unknown>).chrome = originalChrome;
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
        brand: {
          id: "brand-1",
          name: "Samokat",
          link: "https://samokat.ru",
          logo: "https://cdn.example.com/samokat.png",
          baseColor: "FF335F",
          baseTextColor: "FFFFFF",
        },
        icon: "https://cdn.example.com/samokat-icon.png",
        categoryInfo: {
          bankCategory: {
            id: "cat-1",
            name: "Delivery",
          },
        },
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
    expect(row?.operation_icon_url).toBe("https://cdn.example.com/samokat-icon.png");
    expect(row?.source_category).toEqual({
      id: "cat-1",
      name: "Delivery",
    });
    expect(row?.source_brand).toEqual({
      source_key: "brand-1",
      name: "Samokat",
      website_url: "https://samokat.ru/",
      logo_url: "https://cdn.example.com/samokat.png",
      base_color: "FF335F",
      base_text_color: "FFFFFF",
    });
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

  it("drops bank-native source brands for internal transfer operations", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "native-transfer-brand",
          operationTime: { milliseconds: 1772680882000 },
          type: "Debit",
          status: "OK",
          amount: { value: 1000, currency: { strCode: "RUB" } },
          accountAmount: { value: 1000, currency: { strCode: "RUB" } },
          group: "TRANSFER",
          description: "Внутрибанковский перевод",
          brand: {
            id: "brand-transfer",
            name: "Внутрибанковский перевод 3-м лицам",
          },
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    );

    expect(row?.source_brand).toBeNull();
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

  it("suppresses ambiguous own-account transfer tails", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "transfer-ambiguous",
          operationTime: { milliseconds: 1772680882000 },
          type: "Credit",
          status: "OK",
          amount: { value: 62500, currency: { strCode: "RUB" } },
          accountAmount: { value: 62500, currency: { strCode: "RUB" } },
          group: "TRANSFER",
          description: "Между своими счетами",
          merchantKey: "Между своими счетами",
          cardNumber: "518901******1807",
          payment: {
            cardNumber: "518901******0926",
          },
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    );

    expect(row?.transaction_type).toBe("transfer");
    expect((row?.raw_payload as Record<string, unknown>)?.account_hint).toBeNull();
  });

  it("suppresses account-native incoming transfer tails", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "incoming-transfer",
          operationTime: { milliseconds: 1772680882000 },
          type: "Credit",
          status: "OK",
          amount: { value: 10000, currency: { strCode: "RUB" } },
          accountAmount: { value: 10000, currency: { strCode: "RUB" } },
          description: "Максим П.",
          cardNumber: "220070******1778",
          subgroup: { name: "Пополнение по номеру телефона" },
          spendingCategory: { name: "Переводы" },
          categoryInfo: {
            bankCategory: { name: "Переводы" },
          },
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    );

    expect(row?.transaction_type).toBe("income");
    expect((row?.raw_payload as Record<string, unknown>)?.account_hint).toBeNull();
  });

  it("suppresses interest-on-balance tails", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "interest-income",
          operationTime: { milliseconds: 1772680882000 },
          type: "Credit",
          status: "OK",
          amount: { value: 507.93, currency: { strCode: "RUB" } },
          accountAmount: { value: 507.93, currency: { strCode: "RUB" } },
          description: "Проценты на остаток",
          merchantKey: "Проценты на остаток",
          subgroup: { name: "Бонусы" },
          spendingCategory: { name: "Проценты" },
          categoryInfo: {
            bankCategory: { name: "Проценты" },
          },
          cardNumber: "220070******7770",
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    );

    expect(row?.transaction_type).toBe("income");
    expect((row?.raw_payload as Record<string, unknown>)?.account_hint).toBeNull();
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

  it("does not treat plain Receipt document markers as shopping-receipt eligible", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: {
          id: "receipt-doc-1",
          authorizationId: "auth-receipt-doc-1",
          operationTime: { milliseconds: 1773046800000 },
          type: "Debit",
          status: "OK",
          amount: { value: 350, currency: { strCode: "RUB" } },
          accountAmount: { value: 350, currency: { strCode: "RUB" } },
          description: "Store",
          documents: ["Receipt"],
        },
        operationDetail: null,
        shoppingReceipt: null,
      },
      {
        extractionMethod: "api",
      },
    ) as Record<string, unknown>;

    expect(row.receipt_request_key).toBe("auth-receipt-doc-1");
    expect(row.receipt_enrichment_status).toBe("not_requested");
    expect(row.receipt_line_items_skipped).toBe(false);
    expect((row.raw_payload as Record<string, unknown>)?.all_details_captured).toBe(true);
    expect(
      ((row.raw_payload as Record<string, unknown>)?.enrichment as Record<string, unknown>)
        ?.shopping_receipt,
    ).toMatchObject({
      expected: false,
      requested: false,
      receipt_request_key: "auth-receipt-doc-1",
      status: "not_requested",
    });
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
      parseStrategy: "fast",
      payerPersonId: null,
      sessionId: null,
      sourceId: "tbank_web",
      windowFromIso: "2026-02-01T00:00:00.000Z",
      // Null on this call: a catch-up window is bounded by now, and only a history slice sends
      // an end of its own.
      windowToIso: null,
    });
    expect(result.parsedTransactionsCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.account_id).toBeNull();
    expect(result.rows[0]?.amount).toBe(-100);
    expect(result.rows[0]?.line_items).toHaveLength(1);
  });

  function reportedExtraction(operationId: string) {
    return {
      method: "api",
      operation_records: [
        {
          operation: {
            id: operationId,
            operationTime: { milliseconds: 1772680882000 },
            type: "Debit",
            status: "OK",
            amount: { value: 100, currency: { strCode: "RUB" } },
            accountAmount: { value: 100, currency: { strCode: "RUB" } },
            description: "Cafe",
          },
          operationDetail: { payload: { id: `${operationId}-detail` } },
          shoppingReceipt: null,
        },
      ],
      window_to: "2026-03-05T12:00:00.000Z",
      parsed_through_at: "2026-02-01T00:00:00.000Z",
      parsed_transactions_count: 1,
    };
  }

  /** A browser whose page can report by message: the worker's own listeners are what it needs. */
  function installReportingChrome(executeScript: ReturnType<typeof vi.fn>) {
    const messageListeners: Array<(message: unknown, sender: unknown) => void> = [];
    const removedListeners: Array<(tabId: number) => void> = [];
    const updatedListeners: Array<
      (tabId: number, changeInfo: { status?: string; url?: string }) => void
    > = [];
    const removeMessageListener = vi.fn();
    const removeRemovedListener = vi.fn();
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: (message: unknown, sender: unknown) => void) => {
            messageListeners.push(listener);
          }),
          removeListener: removeMessageListener,
        },
      },
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([{ id: 77, url: "https://www.tbank.ru/mybank/operations/" }]),
        get: vi.fn().mockResolvedValue({
          id: 77,
          url: "https://www.tbank.ru/mybank/operations/",
          status: "complete",
        }),
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(
            (listener: (tabId: number, changeInfo: { status?: string; url?: string }) => void) => {
              updatedListeners.push(listener);
            },
          ),
          removeListener: vi.fn(),
        },
        onRemoved: {
          addListener: vi.fn((listener: (tabId: number) => void) => {
            removedListeners.push(listener);
          }),
          removeListener: removeRemovedListener,
        },
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;
    return {
      messageListeners,
      removedListeners,
      updatedListeners,
      removeMessageListener,
      removeRemovedListener,
    };
  }

  it("answers the executeScript call at once and takes the extraction the page reports", async () => {
    // Chrome ends a worker whose single API call is open past five minutes; a month with
    // receipts died inside executeScript that way (2026-09-04). The page now answers "started"
    // and reports by message when done.
    const executeScript = vi.fn();
    const browser = installReportingChrome(executeScript);
    executeScript.mockImplementation(
      async (injection: { args?: Array<{ reportToken?: string }> }) => {
        const token = injection.args?.[0]?.reportToken;
        expect(typeof token).toBe("string");
        setTimeout(() => {
          for (const listener of browser.messageListeners) {
            listener(
              {
                type: "MONEY_IMPORT_PAGE_EXTRACTION",
                report_token: token,
                ok: true,
                result: reportedExtraction("op-reported"),
              },
              { tab: { id: 77 } },
            );
          }
        }, 0);
        return [{ result: { started: true, report_token: token } }];
      },
    );

    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      session: {
        default_account_id: "acc-1",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    expect(executeScript).toHaveBeenCalledOnce();
    expect(result.parsedTransactionsCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amount).toBe(-100);
    // The wait takes its listeners down with it.
    expect(browser.removeMessageListener).toHaveBeenCalledOnce();
    expect(browser.removeRemovedListener).toHaveBeenCalledOnce();
  });

  it("gives up on a page whose tab closes before it reports, after the usual retries", async () => {
    const executeScript = vi.fn();
    const browser = installReportingChrome(executeScript);
    executeScript.mockImplementation(
      async (injection: { args?: Array<{ reportToken?: string }> }) => {
        const token = injection.args?.[0]?.reportToken;
        setTimeout(() => {
          for (const listener of browser.removedListeners) listener(77);
        }, 0);
        return [{ result: { started: true, report_token: token } }];
      },
    );

    await expect(
      connector.parse({
        source: "tbank_web",
        windowFrom: "2026-02-01T00:00:00.000Z",
        session: { default_account_id: "acc-1" },
      }),
    ).rejects.toThrow("Unable to extract operations from current page");
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("gives up on a page that loads anew before it reports, and ignores in-page navigation", async () => {
    const executeScript = vi.fn();
    const browser = installReportingChrome(executeScript);
    let attempt = 0;
    executeScript.mockImplementation(
      async (injection: { args?: Array<{ reportToken?: string }> }) => {
        const token = injection.args?.[0]?.reportToken;
        attempt += 1;
        setTimeout(() => {
          // The bank's own routing: a URL change without a load, which is not the page's end.
          for (const listener of browser.updatedListeners)
            listener(77, { url: "https://www.tbank.ru/mybank/operations/v8/?x=1" });
          if (attempt === 1) {
            for (const listener of browser.updatedListeners) listener(77, { status: "loading" });
            return;
          }
          for (const listener of browser.messageListeners) {
            listener(
              {
                type: "MONEY_IMPORT_PAGE_EXTRACTION",
                report_token: token,
                ok: true,
                result: reportedExtraction("op-after-reload"),
              },
              { tab: { id: 77 } },
            );
          }
        }, 0);
        return [{ result: { started: true, report_token: token } }];
      },
    );

    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      session: { default_account_id: "acc-1" },
    });

    // The first attempt ended with the load; the second, on the page that came back, reported.
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(1);
  });

  it("stops at the deadline: no second attempt, and the page is told to stop", async () => {
    vi.useFakeTimers();
    try {
      const executeScript = vi.fn();
      installReportingChrome(executeScript);
      executeScript.mockImplementation(
        async (injection: { args?: Array<{ reportToken?: string } | string> }) => {
          const first = injection.args?.[0];
          if (typeof first === "string") return [{ result: undefined }];
          return [{ result: { started: true, report_token: first?.reportToken } }];
        },
      );

      const parse = connector.parse({
        source: "tbank_web",
        windowFrom: "2026-02-01T00:00:00.000Z",
        // A session long over: the wait is the floor of a minute, then the deadline.
        session: {
          default_account_id: "acc-1",
          expires_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      });
      const outcome = parse.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await outcome).toContain("did not report back before its session ended");
      // One parse, then the mark in the page -- not a second parse.
      expect(executeScript).toHaveBeenCalledTimes(2);
      const token = (executeScript.mock.calls[0]?.[0] as { args: Array<{ reportToken: string }> })
        .args[0].reportToken;
      expect((executeScript.mock.calls[1]?.[0] as { args: unknown[] }).args).toEqual([token]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recognises the versioned operations page the bank redirects to", () => {
    // Recorded 2026-09-03: navigating to /mybank/operations/ lands here, and an exact match
    // made every run -- manual and unattended -- fail with "did not stay on the operations page".
    expect(
      __test__.isOperationsPageUrl(
        "https://www.tbank.ru/mybank/operations/v8/?dco_ic=4aeb041b-9421-484f-ab8a-9f1642e789d4",
      ),
    ).toBe(true);
    expect(__test__.isOperationsPageUrl("https://www.tbank.ru/mybank/operations/")).toBe(true);
    expect(__test__.isOperationsPageUrl("https://www.tbank.ru/mybank/operations")).toBe(true);

    expect(__test__.isOperationsPageUrl("https://www.tbank.ru/mybank/")).toBe(false);
    expect(__test__.isOperationsPageUrl("https://www.tbank.ru/mybank/operations-settings/")).toBe(
      false,
    );
    expect(__test__.isOperationsPageUrl("https://example.com/mybank/operations/")).toBe(false);
  });

  it("stays on the versioned operations page instead of navigating away from it", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: 77,
        url: "https://www.tbank.ru/mybank/operations/v8/?dco_ic=4aeb041b-9421-484f-ab8a-9f1642e789d4",
        status: "complete",
      },
    ]);
    const update = vi.fn();
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
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
    });

    // Navigating "to the operations page" from here would only trigger the same redirect again.
    expect(update).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledOnce();
    expect(result.rows).toHaveLength(0);
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
    expect(result.debug?.range_request_count).toBe(1);
    expect(result.debug?.effective_chunk_span_days).toBeGreaterThanOrEqual(1);
    expect(result.debug?.page_originated_operations_request_seen).toBe(false);
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

  it("keeps fast receipt pacing and reports strategy in receipt enrichment diagnostics", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: {
      windowFromIso?: string;
      sessionId?: string | null;
      parseStrategy?: string | null;
    }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;
    const originalDateNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const originalChrome = (globalThis as Record<string, unknown>).chrome;

    let nowMs = Date.parse("2026-03-09T00:00:00.000Z");
    const fetchCalls: string[] = [];
    const requestTimes: number[] = [];

    const operationsPayload = [
      {
        id: "op-1",
        authorizationId: "auth-1",
        operationTime: { milliseconds: Date.parse("2026-03-08T09:00:00.000Z") },
        type: "Debit",
        status: "OK",
        amount: { value: 100, currency: { strCode: "RUB" } },
        accountAmount: { value: 100, currency: { strCode: "RUB" } },
        description: "Cafe",
        documents: ["ShoppingReceipt"],
      },
      {
        id: "op-2",
        authorizationId: "auth-2",
        operationTime: { milliseconds: Date.parse("2026-03-08T08:00:00.000Z") },
        type: "Debit",
        status: "OK",
        amount: { value: 200, currency: { strCode: "RUB" } },
        accountAmount: { value: 200, currency: { strCode: "RUB" } },
        description: "Market",
        documents: ["ShoppingReceipt"],
      },
      {
        id: "op-3",
        authorizationId: "auth-3",
        operationTime: { milliseconds: Date.parse("2026-03-08T07:00:00.000Z") },
        type: "Debit",
        status: "OK",
        amount: { value: 300, currency: { strCode: "RUB" } },
        accountAmount: { value: 300, currency: { strCode: "RUB" } },
        description: "Bakery",
        documents: ["ShoppingReceipt"],
      },
      {
        id: "op-4",
        authorizationId: "auth-4",
        operationTime: { milliseconds: Date.parse("2026-03-08T06:00:00.000Z") },
        type: "Debit",
        status: "OK",
        amount: { value: 400, currency: { strCode: "RUB" } },
        accountAmount: { value: 400, currency: { strCode: "RUB" } },
        description: "Deli",
        documents: ["ShoppingReceipt"],
      },
    ];

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
        ];
      }),
    };
    (globalThis as Record<string, unknown>).URL = URL;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    };
    Date.now = () => nowMs;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
      nowMs += delay ?? 0;
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    (globalThis as Record<string, unknown>).fetch = vi
      .fn()
      .mockImplementation(async (input: string) => {
        fetchCalls.push(input);
        const url = new URL(input);
        if (url.pathname === "/api/common/v1/operations") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: operationsPayload }),
          };
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          requestTimes.push(nowMs);
          const operationId = url.searchParams.get("operationId");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resultCode: "REQUEST_RATE_LIMIT_EXCEEDED",
              errorMessage: `${operationId} - Превышено количество обращений к сервису`,
              plainMessage: "Превышено количество обращений к сервису",
              trackingId: `${operationId}-track`,
            }),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => null,
        };
      });

    try {
      const result = await isolatedExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
        sessionId: "abc",
        parseStrategy: "fast",
      });

      expect(fetchCalls.filter((url) => url.includes("/shopping_receipt"))).toHaveLength(3);
      expect(requestTimes).toEqual([
        Date.parse("2026-03-09T00:00:00.000Z"),
        Date.parse("2026-03-09T00:00:01.800Z"),
        Date.parse("2026-03-09T00:00:03.600Z"),
      ]);
      expect(result).toMatchObject({
        method: "api",
        parsed_transactions_count: 4,
        debug: {
          receipt_enrichment: {
            requested_count: 1,
            success_count: 0,
            rate_limited_count: 1,
            skipped_after_budget_count: 3,
            retry_attempts_total: 2,
            stopped_after_budget: true,
            parse_strategy: "fast",
            base_pause_between_receipts_ms: 300,
          },
        },
      });

      const records = (result.operation_records ?? []) as Array<Record<string, unknown>>;
      expect(records[0]?.shoppingReceiptMeta).toMatchObject({
        receipt_request_key: "auth-1",
        receipt_enrichment_status: "rate_limited",
        receipt_line_items_skipped: true,
        receipt_retryable: true,
        receipt_retry_attempts: 2,
        receipt_result_code: "REQUEST_RATE_LIMIT_EXCEEDED",
        receipt_tracking_id: "auth-1-track",
      });
      expect(records[1]?.shoppingReceiptMeta).toMatchObject({
        receipt_request_key: "auth-2",
        receipt_enrichment_status: "skipped_after_budget",
        receipt_line_items_skipped: true,
        receipt_retryable: true,
        receipt_retry_attempts: 0,
      });
      expect(records[3]?.shoppingReceiptMeta).toMatchObject({
        receipt_request_key: "auth-4",
        receipt_enrichment_status: "skipped_after_budget",
        receipt_line_items_skipped: true,
        receipt_retryable: true,
        receipt_retry_attempts: 0,
      });
      expect(records[3]?.shoppingReceipt).toBeNull();
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
      (globalThis as Record<string, unknown>).chrome = originalChrome;
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("keeps retrying full-mode receipt enrichment with progressive backoff instead of skipping later receipts", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: {
      windowFromIso?: string;
      sessionId?: string | null;
      parseStrategy?: string | null;
    }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;
    const originalDateNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const originalChrome = (globalThis as Record<string, unknown>).chrome;

    let nowMs = Date.parse("2026-03-09T00:00:00.000Z");
    const requestTimes: number[] = [];
    const receiptAttemptsByOperationId = new Map<string, number>();

    const operationsPayload = [
      {
        id: "op-1",
        authorizationId: "auth-1",
        operationTime: { milliseconds: Date.parse("2026-03-08T09:00:00.000Z") },
        type: "Debit",
        status: "OK",
        amount: { value: 100, currency: { strCode: "RUB" } },
        accountAmount: { value: 100, currency: { strCode: "RUB" } },
        description: "Cafe",
        documents: ["ShoppingReceipt"],
      },
      {
        id: "op-2",
        authorizationId: "auth-2",
        operationTime: { milliseconds: Date.parse("2026-03-08T08:00:00.000Z") },
        type: "Debit",
        status: "OK",
        amount: { value: 200, currency: { strCode: "RUB" } },
        accountAmount: { value: 200, currency: { strCode: "RUB" } },
        description: "Market",
        documents: ["ShoppingReceipt"],
      },
    ];

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
        ];
      }),
    };
    (globalThis as Record<string, unknown>).URL = URL;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    };
    Date.now = () => nowMs;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
      nowMs += delay ?? 0;
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    (globalThis as Record<string, unknown>).fetch = vi
      .fn()
      .mockImplementation(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/api/common/v1/operations") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: operationsPayload }),
          };
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          requestTimes.push(nowMs);
          const operationId = url.searchParams.get("operationId") ?? "unknown";
          const attempt = (receiptAttemptsByOperationId.get(operationId) ?? 0) + 1;
          receiptAttemptsByOperationId.set(operationId, attempt);
          if (operationId === "auth-1" && attempt <= 3) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                resultCode: "REQUEST_RATE_LIMIT_EXCEEDED",
                errorMessage: "rate limited",
                plainMessage: "rate limited",
                trackingId: `${operationId}-track`,
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resultCode: "OK",
              trackingId: `${operationId}-track`,
              payload: {
                receipt: {
                  items: [
                    {
                      name: `${operationId}-item`,
                      sum: operationId === "auth-1" ? 100 : 200,
                      quantity: 1,
                    },
                  ],
                },
              },
            }),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => null,
        };
      });

    try {
      const result = await isolatedExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
        sessionId: "abc",
        parseStrategy: "full",
      });

      expect(requestTimes).toEqual([
        Date.parse("2026-03-09T00:00:00.000Z"),
        Date.parse("2026-03-09T00:00:05.500Z"),
        Date.parse("2026-03-09T00:00:12.500Z"),
        Date.parse("2026-03-09T00:00:22.500Z"),
        Date.parse("2026-03-09T00:00:26.500Z"),
      ]);
      const records = (result.operation_records ?? []) as Array<Record<string, unknown>>;
      expect(records[0]?.shoppingReceiptMeta).toMatchObject({
        receipt_request_key: "auth-1",
        receipt_enrichment_status: "ok",
        receipt_line_items_skipped: false,
        receipt_retry_attempts: 3,
        receipt_result_code: "OK",
        receipt_tracking_id: "auth-1-track",
      });
      expect(records[1]?.shoppingReceiptMeta).toMatchObject({
        receipt_request_key: "auth-2",
        receipt_enrichment_status: "ok",
        receipt_line_items_skipped: false,
        receipt_retry_attempts: 0,
        receipt_result_code: "OK",
        receipt_tracking_id: "auth-2-track",
      });
      expect(result).toMatchObject({
        debug: {
          receipt_enrichment: {
            parse_strategy: "full",
            retry_strategy: "progressive_backoff",
            base_pause_between_receipts_ms: 4000,
            max_retry_pause_ms: 15000,
            rate_limit_response_count: 3,
            retry_attempts_total: 3,
          },
        },
      });
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
      (globalThis as Record<string, unknown>).chrome = originalChrome;
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("applies a rolling cooldown in full mode before the observed receipt request window is exceeded", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: {
      windowFromIso?: string;
      sessionId?: string | null;
      parseStrategy?: string | null;
    }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;
    const originalDateNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const originalChrome = (globalThis as Record<string, unknown>).chrome;

    let nowMs = Date.parse("2026-03-10T00:00:00.000Z");
    const requestTimes: number[] = [];
    const operationsPayload = Array.from({ length: 71 }, (_, index) => ({
      id: `op-${index + 1}`,
      authorizationId: `auth-${index + 1}`,
      operationTime: { milliseconds: Date.parse("2026-03-09T12:00:00.000Z") - index * 60000 },
      type: "Debit",
      status: "OK",
      amount: { value: 100 + index, currency: { strCode: "RUB" } },
      accountAmount: { value: 100 + index, currency: { strCode: "RUB" } },
      description: `Receipt ${index + 1}`,
      documents: ["ShoppingReceipt"],
    }));

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
        ];
      }),
    };
    (globalThis as Record<string, unknown>).URL = URL;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    };
    Date.now = () => nowMs;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
      nowMs += delay ?? 0;
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    (globalThis as Record<string, unknown>).fetch = vi
      .fn()
      .mockImplementation(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/api/common/v1/operations") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: operationsPayload }),
          };
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          requestTimes.push(nowMs);
          const operationId = url.searchParams.get("operationId") ?? "unknown";
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resultCode: "OK",
              trackingId: `${operationId}-track`,
              payload: {
                receipt: {
                  items: [
                    {
                      name: `${operationId}-item`,
                      sum: 100,
                      quantity: 1,
                    },
                  ],
                },
              },
            }),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => null,
        };
      });

    try {
      const result = await isolatedExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
        sessionId: "abc",
        parseStrategy: "full",
      });

      expect(requestTimes).toHaveLength(71);
      expect(requestTimes[0]).toBe(Date.parse("2026-03-10T00:00:00.000Z"));
      expect(requestTimes[69]).toBe(Date.parse("2026-03-10T00:04:36.000Z"));
      expect(requestTimes[70]).toBe(Date.parse("2026-03-10T00:10:05.000Z"));
      expect(result).toMatchObject({
        debug: {
          receipt_enrichment: {
            parse_strategy: "full",
            base_pause_between_receipts_ms: 4000,
            rate_limit_response_count: 0,
            rate_limited_count: 0,
            success_count: 71,
            window_limit: 70,
            window_ms: 600000,
            window_cooldown_count: 1,
            window_cooldown_total_ms: 325000,
          },
        },
      });
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).performance = originalPerformance;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
      (globalThis as Record<string, unknown>).chrome = originalChrome;
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

describe("tbank-web pure helpers (T-261116-rul mutation)", () => {
  it("accepts tbank.ru and tbank-online.com hosts and rejects others", () => {
    expect(__test__.isTbankUrl("https://www.tbank.ru/mybank/operations/")).toBe(true);
    expect(__test__.isTbankUrl("https://tbank.ru/mybank/operations/")).toBe(true);
    expect(__test__.isTbankUrl("https://www.tbank-online.com/mybank/operations/")).toBe(true);
    expect(__test__.isTbankUrl("https://evil.example/tbank.ru/")).toBe(false);
    expect(__test__.isTbankUrl("http://www.tbank.ru/mybank/operations/")).toBe(false);
    // Must keep the start anchor: a foreign host that merely embeds the bank URL must fail.
    expect(__test__.isTbankUrl("https://evil.example/?next=https://www.tbank.ru/x")).toBe(false);
    expect(__test__.isTbankUrl(null)).toBe(false);
    expect(__test__.isTbankUrl(12)).toBe(false);
    // String objects are not typeof "string"; dropping that check would accept them via ToString.
    expect(
      __test__.isTbankUrl(
        new String("https://www.tbank.ru/mybank/operations/") as unknown as string,
      ),
    ).toBe(false);
  });

  it("picks the mirror operations page when the tab is already on tbank-online.com", () => {
    expect(__test__.operationsPageUrlFor("https://www.tbank-online.com/mybank/")).toBe(
      "https://www.tbank-online.com/mybank/operations/",
    );
    expect(__test__.operationsPageUrlFor("https://tbank-online.com/mybank/")).toBe(
      "https://www.tbank-online.com/mybank/operations/",
    );
    expect(__test__.operationsPageUrlFor("https://www.tbank.ru/mybank/")).toBe(
      "https://www.tbank.ru/mybank/operations/",
    );
    expect(
      __test__.operationsPageUrlFor("https://evil.example/?https://www.tbank-online.com/"),
    ).toBe("https://www.tbank.ru/mybank/operations/");
    expect(__test__.operationsPageUrlFor(null)).toBe("https://www.tbank.ru/mybank/operations/");
    expect(
      __test__.operationsPageUrlFor(
        new String("https://www.tbank-online.com/mybank/") as unknown as string,
      ),
    ).toBe("https://www.tbank.ru/mybank/operations/");
  });

  it("treats versioned and query-bearing operations paths as the operations page", () => {
    expect(__test__.isOperationsPageUrl("https://www.tbank.ru/mybank/operations/v8/?x=1")).toBe(
      true,
    );
    expect(__test__.isOperationsPageUrl("https://www.tbank.ru/mybank/cards/")).toBe(false);
    expect(__test__.isOperationsPageUrl("not-a-url")).toBe(false);
  });

  it("normalizes text, objects, numbers and ISO timestamps", () => {
    expect(__test__.normalizeText("  a\u00a0b\n\tc  ")).toBe("a b c");
    expect(__test__.normalizeText("   ")).toBeNull();
    expect(__test__.normalizeText(1)).toBeNull();
    expect(__test__.asObject({ a: 1 })).toEqual({ a: 1 });
    expect(__test__.asObject(null)).toBeNull();
    expect(__test__.asObject("x")).toBeNull();
    expect(__test__.firstNonEmpty("", "  ", "ok", "later")).toBe("ok");
    expect(__test__.firstNonEmpty("", null, undefined)).toBeNull();
    expect(__test__.toFiniteNumber(3)).toBe(3);
    expect(__test__.toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(__test__.toFiniteNumber("4.5")).toBe(4.5);
    expect(__test__.toFiniteNumber("  ")).toBeNull();
    expect(__test__.toFiniteNumber("nope")).toBeNull();
    expect(__test__.toFiniteNumber(Number.NaN)).toBeNull();
    expect(__test__.toFiniteNumber(true as unknown as number)).toBeNull();
    // Dropping Number.isFinite would return Infinity; dropping typeof-number would return strings.
    expect(__test__.toFiniteNumber(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(__test__.toFiniteMs("2026-01-02T00:00:00.000Z")).toBe(
      Date.parse("2026-01-02T00:00:00.000Z"),
    );
    expect(__test__.toFiniteMs(123)).toBe(123);
    expect(__test__.toFiniteMs("  ")).toBeNull();
    expect(__test__.toFiniteMs("nope")).toBeNull();
    expect(__test__.toFiniteMs(new String("123") as unknown as string)).toBeNull();
    expect(__test__.toIsoString("2026-01-02T00:00:00.000Z")).toBe("2026-01-02T00:00:00.000Z");
    expect(__test__.toIsoString("")).toBeNull();
    expect(__test__.toIsoString("   ")).toBeNull();
    expect(__test__.toIsoString("not-a-date")).toBeNull();
    expect(__test__.toIsoString(12)).toBeNull();
    expect(
      __test__.toIsoString(new String("2026-01-02T00:00:00.000Z") as unknown as string),
    ).toBeNull();
    expect(__test__.normalizeMcc("MCC 5411 store")).toBe("5411");
    expect(__test__.normalizeMcc("none")).toBeNull();
  });

  it("extracts card last4 only from masked or full-length digit strings", () => {
    expect(__test__.extractCardLast4("****1234")).toBe("1234");
    expect(__test__.extractCardLast4("1234")).toBe("1234");
    expect(__test__.extractCardLast4("4111111111111111")).toBe("1111");
    expect(__test__.extractCardLast4("411111111111")).toBe("1111");
    expect(__test__.extractCardLast4("4111111111111111111")).toBe("1111");
    // 11 digits: not masked, not 4, not 12–19 — must stay null.
    expect(__test__.extractCardLast4("41111111111")).toBeNull();
    // 20 digits: over the PAN range — must stay null (kills `<=19` → true).
    expect(__test__.extractCardLast4("41111111111111111111")).toBeNull();
    expect(__test__.extractCardLast4("12")).toBeNull();
    expect(__test__.extractCardLast4(null)).toBeNull();
    expect(__test__.extractCardLast4("123456")).toBeNull();
    expect(__test__.extractCardLast4("123")).toBeNull();
  });

  it("detects transfers from group, subgroup and merchant title", () => {
    expect(__test__.detectTransfer({ group: "Transfer out" }, "Shop")).toBe(true);
    expect(__test__.detectTransfer({ subgroup: { name: "Перевод" } }, "Shop")).toBe(true);
    expect(__test__.detectTransfer({}, "Card to card")).toBe(true);
    expect(__test__.detectTransfer({ group: "Shopping" }, "Coffee")).toBe(false);
  });

  it("marks account-native operations for internal transfers and interest markers", () => {
    expect(__test__.isAccountNativeOperation({}, "Coffee", true)).toBe(true);
    expect(
      __test__.isAccountNativeOperation({ description: "Between own accounts" }, "x", false),
    ).toBe(true);
    expect(__test__.isAccountNativeOperation({ description: "Deposit interest" }, "x", false)).toBe(
      true,
    );
    expect(__test__.isAccountNativeOperation({ description: "Grocery" }, "Coffee", false)).toBe(
      false,
    );
  });

  it("normalizes currency tokens including numeric ISO codes", () => {
    expect(__test__.normalizeCurrencyToken("rub")).toBe("RUB");
    expect(__test__.normalizeCurrencyToken("643")).toBe("RUB");
    expect(__test__.normalizeCurrencyToken("840")).toBe("USD");
    expect(__test__.normalizeCurrencyToken("978")).toBe("EUR");
    expect(__test__.normalizeCurrencyToken("999")).toBeNull();
    // Digits must be the whole token — a leading digit with trailing junk is not numeric ISO.
    expect(__test__.normalizeCurrencyToken("643RUB")).toBe("RUB");
    expect(__test__.normalizeCurrencyToken("x643")).toBeNull();
    // Keep the start anchor: trailing digits must not divert a letter token into the ISO map.
    expect(__test__.normalizeCurrencyToken("USD840")).toBe("USD");
    expect(__test__.normalizeCurrencyToken("")).toBeNull();
    expect(__test__.normalizeCurrencyToken(null)).toBeNull();
  });

  it("prefers account currency then amount currency then RUB", () => {
    expect(
      __test__.extractCurrency({
        accountAmount: { currency: { strCode: "usd" } },
        amount: { currency: { strCode: "eur" } },
      }),
    ).toBe("USD");
    expect(__test__.extractCurrency({ amount: { currency: { strCode: "eur" } } })).toBe("EUR");
    expect(__test__.extractCurrency({})).toBe("RUB");
  });

  it("reads cashback amount from summary, cashbackAmount, cashback, then loyaltyBonus", () => {
    expect(__test__.extractCashbackAmount({ loyaltyBonusSummary: { amount: 12 } })).toBe(12);
    expect(__test__.extractCashbackAmount({ cashbackAmount: { value: 3.5 } })).toBe(3.5);
    expect(__test__.extractCashbackAmount({ cashback: 7 })).toBe(7);
    expect(
      __test__.extractCashbackAmount({
        loyaltyBonus: [{ amount: { value: 9 } }, { amount: { value: 1 } }, "skip-me"],
      }),
    ).toBe(10);
    expect(__test__.extractCashbackAmount({ loyaltyBonus: "not-an-array" })).toBeNull();
    expect(
      __test__.extractCashbackAmount({ loyaltyBonus: [{ amount: { value: null } }] }),
    ).toBeNull();
    expect(__test__.extractCashbackAmount({})).toBeNull();
  });

  it("returns cashback currency only when an amount exists", () => {
    expect(
      __test__.extractCashbackCurrency({ cashbackAmount: { currency: { strCode: "usd" } } }, 1),
    ).toBe("USD");
    expect(
      __test__.extractCashbackCurrency({ cashbackAmount: { currency: { strCode: "usd" } } }, null),
    ).toBeNull();
    expect(__test__.extractCashbackCurrency({}, 1)).toBe("RUB");
  });

  it("maps hold-like statuses to pending and everything else to posted", () => {
    expect(__test__.normalizeStatus("HOLD")).toBe("pending");
    expect(__test__.normalizeStatus("Authorization")).toBe("posted");
    expect(__test__.normalizeStatus("pending payment")).toBe("pending");
    expect(__test__.normalizeStatus("processing")).toBe("pending");
    expect(__test__.normalizeStatus("wait")).toBe("pending");
    expect(__test__.normalizeStatus("new")).toBe("pending");
    expect(__test__.normalizeStatus("")).toBe("posted");
    expect(__test__.normalizeStatus("   ")).toBe("posted");
    expect(__test__.normalizeStatus(null)).toBe("posted");
    expect(__test__.normalizeStatus("OK")).toBe("posted");
  });

  it("builds receipt line items and a fallback when items are empty", () => {
    const items = __test__.buildLineItemsFromReceipt(
      { receipt: { items: [{ name: "Milk", sum: 100, price: 2, quantity: 1 }] } },
      -100,
      "Fallback",
    );
    expect(items[0]).toMatchObject({ title: "Milk", amount: -100, quantity: 1 });
    const positive = __test__.buildLineItemsFromReceipt(
      { receipt: { items: [{ title: "Tea", price: 10, quantity: 2 }] } },
      20,
      "Fallback",
    );
    expect(positive[0]).toMatchObject({ title: "Tea", amount: 20, quantity: 2 });
    const zeroAmount = __test__.buildLineItemsFromReceipt(
      { receipt: { items: [{ name: "Zero", sum: 0 }] } },
      0,
      "Fallback",
    );
    expect(zeroAmount[0]).toMatchObject({ title: "Zero", amount: 0 });
    const fallback = __test__.buildLineItemsFromReceipt(
      { receipt: { items: [] } },
      -50,
      "Fallback",
    );
    expect(fallback[0]).toMatchObject({
      title: "Fallback",
      amount: -50,
      raw_payload: { source: "fallback" },
    });
    const notArray = __test__.buildLineItemsFromReceipt(
      { receipt: { items: "nope" } },
      1,
      "Fallback",
    );
    expect(notArray[0]?.raw_payload).toMatchObject({ source: "fallback" });
  });

  it("hashes inputs stably and pins the FNV-1a digests", () => {
    expect(__test__.hashString("abc")).toBe("1a47e90b");
    expect(__test__.hashString("abd")).toBe("1f47f0ea");
    expect(__test__.hashString("")).toBe("811c9dc5");
    expect(__test__.hashString("abc")).not.toBe(__test__.hashString("abd"));
  });

  it("changes the dedupe hash when any contributing field changes", () => {
    const base = {
      external_id: "e1",
      operation_id: "o1",
      authorization_id: "a1",
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: -10,
      merchant_name: "Shop",
      account_hint: "1234",
    };
    const baseHash = __test__.buildDedupeHash(base);
    expect(baseHash.startsWith("tbw_")).toBe(true);
    expect(__test__.buildDedupeHash({ ...base, external_id: "e2" })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, operation_id: "o2" })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, authorization_id: "a2" })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, posted_at: "2026-01-02T00:00:00.000Z" })).not.toBe(
      baseHash,
    );
    expect(__test__.buildDedupeHash({ ...base, amount: -11 })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, merchant_name: "Other" })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, account_hint: "9999" })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, external_id: "" })).not.toBe(baseHash);
    expect(__test__.buildDedupeHash({ ...base, merchant_name: "" })).not.toBe(baseHash);
  });

  it("reads operation time and signed amount from record fields", () => {
    expect(
      __test__.extractOperationTimeMs({
        operationTime: { milliseconds: Date.parse("2026-01-01T00:00:00.000Z") },
      }),
    ).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(
      __test__.extractOperationTimeMs({
        debitingTime: { milliseconds: Date.parse("2026-02-01T00:00:00.000Z") },
      }),
    ).toBe(Date.parse("2026-02-01T00:00:00.000Z"));
    expect(__test__.extractOperationTimeMs({ operationDateTime: "2026-03-01T00:00:00.000Z" })).toBe(
      Date.parse("2026-03-01T00:00:00.000Z"),
    );
    expect(__test__.extractOperationAmount({ accountAmount: { value: 12.5 } })).toBe(12.5);
    expect(__test__.extractOperationAmount({ amount: { value: 3 } })).toBe(3);
    expect(__test__.extractOperationAmount({})).toBeNull();
    expect(__test__.resolveSignedAmount({ type: "Debit" }, 5)).toBe(-5);
    expect(__test__.resolveSignedAmount({ type: "expense" }, 5)).toBe(-5);
    expect(__test__.resolveSignedAmount({ type: "Credit" }, 5)).toBe(5);
    expect(__test__.resolveSignedAmount({ type: "income" }, -5)).toBe(5);
    // Credit branch must not run for plain types — would abs() a negative amount.
    expect(__test__.resolveSignedAmount({ type: "other" }, -5)).toBe(-5);
    expect(__test__.resolveSignedAmount({}, 5)).toBe(5);
  });

  it("accepts only fast/full parse strategies and resolves session overrides", () => {
    expect(__test__.normalizeParseStrategy("fast")).toBe("fast");
    expect(__test__.normalizeParseStrategy("full")).toBe("full");
    expect(__test__.normalizeParseStrategy("FAST")).toBeNull();
    expect(__test__.normalizeParseStrategy("slow")).toBeNull();
    expect(__test__.normalizeParseStrategy(null)).toBeNull();
    // || must not become && — only one of the two tokens is ever present.
    expect(__test__.normalizeParseStrategy("fast")).not.toBeNull();
    expect(__test__.resolveParseStrategy({ parse_strategy: "full" })).toBe("full");
    expect(__test__.resolveParseStrategy({ parse_strategy: "fast" })).toBe("fast");
    expect(__test__.resolveParseStrategy({ meta: { parse_strategy: "full" } })).toBe("full");
    expect(__test__.resolveParseStrategy({ meta: { parse_strategy: "nope" } })).toBe("fast");
    expect(__test__.resolveParseStrategy({})).toBe("fast");
    expect(__test__.resolveParseStrategy(undefined)).toBe("fast");
  });

  it("estimates full-mode enrichment past the first cooldown window (kills + vs - age)", () => {
    // At 150 the natural-expiry age uses timeline - oldest; flipping to + changes the ms.
    expect(__test__.estimateFullModeReceiptEnrichmentMs(150)).toBe(1388500);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(200)).toBe(1626000);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(-3)).toBe(0);
    expect(__test__.estimateFullModeReceiptEnrichmentMs(1.9)).toBe(30750);
  });

  it("keeps whitespace-sensitive blocked URL and page-text boundaries", () => {
    expect(
      __test__.detectBlockedReasonFromPageState("  https://www.tbank.ru/auth/login  ", ""),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    // Uppercase URL must still match after toLowerCase (kills stripping the method chain).
    expect(__test__.detectBlockedReasonFromPageState("HTTPS://WWW.TBANK.RU/AUTH/LOGIN", "")).toBe(
      "T-Bank session is not authorized. Sign in and retry import.",
    );
    // Trailing whitespace: /login$ only matches after trim (kills removing trim()).
    expect(__test__.detectBlockedReasonFromPageState("https://www.tbank.ru/login ", "")).toBe(
      "T-Bank session is not authorized. Sign in and retry import.",
    );
    // Captcha only past the 6000-char window must not block.
    expect(
      __test__.detectBlockedReasonFromPageState(
        "https://www.tbank.ru/mybank/",
        `${"ok ".repeat(2000)}captcha`,
      ),
    ).toBeNull();
    expect(
      __test__.detectBlockedReasonFromPageState(
        "https://www.tbank.ru/mybank/",
        `captcha${"x".repeat(6000)}`,
      ),
    ).toBe("T-Bank requested verification. Resolve blocking challenge and retry import.");
    expect(__test__.detectBlockedReasonFromTabUrl("   https://www.tbank.ru/auth/login   ")).toBe(
      "T-Bank session is not authorized. Sign in and retry import.",
    );
    // Whitespace-only tab URLs stay null; dropping trim() would treat them as real URLs.
    expect(__test__.detectBlockedReasonFromTabUrl("\t\n")).toBeNull();
  });

  it("detects auth and captcha blocks from API envelopes and page/tab URLs", () => {
    expect(__test__.detectBlockedReasonFromApiEnvelope(null)).toBeNull();
    expect(__test__.detectBlockedReasonFromApiEnvelope("x")).toBeNull();
    expect(__test__.detectBlockedReasonFromApiEnvelope({})).toBeNull();
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        resultCode: "authentication_failed",
      }),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        details: { errorCode: "insufficient_privileges" },
      }),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        details: { httpStatusCode: 401 },
      }),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        errorMessage: "Not Authorized by upstream",
      }),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        details: { message: "пользователь не найден" },
      }),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        errorMessage: "Please complete the captcha challenge",
      }),
    ).toBe("T-Bank requested verification. Resolve blocking challenge and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        details: { message: "слишком много запросов" },
      }),
    ).toBe("T-Bank requested verification. Resolve blocking challenge and retry import.");
    expect(
      __test__.detectBlockedReasonFromApiEnvelope({
        details: { errorCode: "OTHER", message: null, httpStatusCode: 200 },
        errorMessage: "",
        resultCode: "OK",
      }),
    ).toBeNull();

    expect(__test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/Login", "")).toBe(
      "T-Bank session is not authorized. Sign in and retry import.",
    );
    expect(
      __test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/login/", ""),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromPageState("https://www.tbank.ru/x?redirectTo=/y", ""),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/", "Please Sign In"),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/", "войти в кабинет"),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
    expect(
      __test__.detectBlockedReasonFromPageState(
        "https://www.tbank.ru/mybank/",
        "checking your browser",
      ),
    ).toBe("T-Bank requested verification. Resolve blocking challenge and retry import.");
    expect(__test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/", "капча")).toBe(
      "T-Bank requested verification. Resolve blocking challenge and retry import.",
    );
    // Uppercase page text must still match after toLowerCase.
    expect(
      __test__.detectBlockedReasonFromPageState(
        "https://www.tbank.ru/mybank/",
        "VERIFY YOU ARE HUMAN",
      ),
    ).toBe("T-Bank requested verification. Resolve blocking challenge and retry import.");
    expect(
      __test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/", "all good"),
    ).toBeNull();
    // /login must match end-of-path; /loginx must not.
    expect(
      __test__.detectBlockedReasonFromPageState("https://www.tbank.ru/mybank/loginx", ""),
    ).toBeNull();

    expect(__test__.detectBlockedReasonFromTabUrl(null)).toBeNull();
    expect(__test__.detectBlockedReasonFromTabUrl(12)).toBeNull();
    expect(__test__.detectBlockedReasonFromTabUrl("   ")).toBeNull();
    expect(__test__.detectBlockedReasonFromTabUrl("https://www.tbank.ru/auth/login")).toBe(
      "T-Bank session is not authorized. Sign in and retry import.",
    );
  });

  it("summarizes extraction diagnostics with defaults and explicit debug overrides", () => {
    const bare = __test__.summarizeExtractionDiagnostics(
      { method: "api", window_to: "t", parsed_through_at: "t", parsed_transactions_count: 0 },
      { invalid_record: 1 },
      2,
      "fast",
    );
    expect(bare.extraction_method).toBe("api");
    expect(bare.fallback_used).toBe(false);
    expect(bare.fallback_reason).toBeNull();
    expect(bare.blocked_reason).toBeNull();
    expect(bare.discovered_endpoints).toEqual({
      operations_api: null,
      operation_detail_api: null,
      tranche_offers_api: null,
    });
    expect(bare.range_attempts).toEqual([]);
    expect(bare.range_request_count).toBe(0);
    expect(bare.effective_chunk_span_days).toBeNull();
    expect(bare.response_status_histogram).toEqual({});
    expect(bare.stage_timings_ms).toEqual({});
    expect(bare.mapping_drop_counts).toEqual({ invalid_record: 1 });
    expect(bare.mapped_row_count).toBe(2);
    expect(bare.api_operation_count).toBe(0);
    expect(bare.receipt_enrichment.parse_strategy).toBe("fast");
    expect(bare.receipt_enrichment.retry_strategy).toBe("shared_budget");
    expect(bare.receipt_enrichment.base_pause_between_receipts_ms).toBe(300);
    expect(bare.receipt_enrichment.max_retry_pause_ms).toBe(1500);
    expect(bare.receipt_enrichment.stopped_after_budget).toBe(false);
    expect(bare.receipt_enrichment.requested_count).toBe(0);
    expect(bare.preflight_enrichment_skip_count).toBe(0);

    const domBare = __test__.summarizeExtractionDiagnostics(
      {
        method: "dom",
        blocked_reason: "blocked-from-extraction",
        window_to: "t",
        parsed_through_at: "t",
        parsed_transactions_count: 0,
      },
      {},
      0,
      "full",
    );
    expect(domBare.extraction_method).toBe("dom");
    expect(domBare.fallback_used).toBe(true);
    expect(domBare.blocked_reason).toBe("blocked-from-extraction");
    expect(domBare.receipt_enrichment.retry_strategy).toBe("progressive_backoff");
    expect(domBare.receipt_enrichment.base_pause_between_receipts_ms).toBe(4000);
    expect(domBare.receipt_enrichment.max_retry_pause_ms).toBe(15000);

    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const end = start + 2 * 24 * 60 * 60 * 1000 - 1;
    const withDebug = __test__.summarizeExtractionDiagnostics(
      {
        method: "dom",
        window_to: "t",
        parsed_through_at: "t",
        parsed_transactions_count: 0,
        debug: {
          extraction_method: "api",
          fallback_used: false,
          fallback_reason: "api_empty",
          blocked_reason: "from-debug",
          discovered_endpoints: {
            operations_api: "https://www.tbank.ru/api/ops?sessionid=secret",
            operation_detail_api: "https://www.tbank.ru/api/detail?x=1",
            tranche_offers_api: null,
          },
          range_attempts: [{ start, end, status_code: 200, payload_count: 3 }],
          range_request_count: 9,
          effective_chunk_span_days: 14,
          first_operation_posted_at: "2026-01-02T00:00:00.000Z",
          last_operation_posted_at: "2026-01-03T00:00:00.000Z",
          page_originated_operations_request_seen: true,
          response_status_histogram: { "200": 2 },
          stage_timings_ms: { fetch: 10 },
          api_error_message: null,
          api_operation_count: 4,
          dom_row_count: 0,
          receipt_enrichment: {
            requested_count: 5,
            success_count: 4,
            rate_limit_response_count: 1,
            rate_limited_count: 1,
            skipped_after_budget_count: 3,
            failed_count: 2,
            retry_attempts_total: 2,
            stopped_after_budget: true,
            parse_strategy: "full",
            retry_strategy: "progressive_backoff",
            base_pause_between_receipts_ms: 4000,
            max_retry_pause_ms: 15000,
            window_limit: 70,
            window_ms: 600000,
            window_cooldown_count: 1,
            window_cooldown_total_ms: 5000,
          },
          preflight_enrichment_skip_count: 1,
          fulfilled_skip_count: 2,
          out_of_range_skip_count: 3,
        },
      },
      { missing_time_or_amount: 1 },
      7,
      "fast",
    );
    expect(withDebug.extraction_method).toBe("api");
    expect(withDebug.fallback_used).toBe(false);
    expect(withDebug.fallback_reason).toBe("api_empty");
    expect(withDebug.blocked_reason).toBe("from-debug");
    expect(withDebug.discovered_endpoints.operations_api).toBe(
      "https://www.tbank.ru/api/ops?sessionid=<redacted>",
    );
    expect(withDebug.discovered_endpoints.operation_detail_api).toBe(
      "https://www.tbank.ru/api/detail?x=<redacted>",
    );
    expect(withDebug.range_request_count).toBe(9);
    expect(withDebug.effective_chunk_span_days).toBe(14);
    expect(withDebug.first_operation_posted_at).toBe("2026-01-02T00:00:00.000Z");
    expect(withDebug.last_operation_posted_at).toBe("2026-01-03T00:00:00.000Z");
    expect(withDebug.api_operation_count).toBe(4);
    expect(withDebug.receipt_enrichment.requested_count).toBe(5);
    expect(withDebug.receipt_enrichment.success_count).toBe(4);
    expect(withDebug.receipt_enrichment.rate_limit_response_count).toBe(1);
    expect(withDebug.receipt_enrichment.rate_limited_count).toBe(1);
    expect(withDebug.receipt_enrichment.skipped_after_budget_count).toBe(3);
    expect(withDebug.receipt_enrichment.failed_count).toBe(2);
    expect(withDebug.receipt_enrichment.retry_attempts_total).toBe(2);
    expect(withDebug.receipt_enrichment.stopped_after_budget).toBe(true);
    expect(withDebug.receipt_enrichment.window_cooldown_count).toBe(1);
    expect(withDebug.receipt_enrichment.window_cooldown_total_ms).toBe(5000);
    expect(withDebug.discovered_endpoints.tranche_offers_api).toBeNull();
    expect(withDebug.preflight_enrichment_skip_count).toBe(1);
    expect(withDebug.fulfilled_skip_count).toBe(2);
    expect(withDebug.out_of_range_skip_count).toBe(3);

    // Missing range_attempts / discovered_endpoints must not throw when ?. is stripped.
    const noRanges = __test__.summarizeExtractionDiagnostics(
      {
        method: "api",
        window_to: "t",
        parsed_through_at: "t",
        parsed_transactions_count: 0,
        debug: {
          extraction_method: "api",
          fallback_used: false,
          fallback_reason: null,
          blocked_reason: null,
          // Intentionally omit discovered_endpoints and range_attempts.
          response_status_histogram: {},
          stage_timings_ms: {},
          api_error_message: null,
          api_operation_count: 0,
          dom_row_count: 0,
        } as never,
      },
      {},
      0,
      "full",
    );
    expect(noRanges.range_attempts).toEqual([]);
    expect(noRanges.effective_chunk_span_days).toBeNull();
    expect(noRanges.range_request_count).toBe(0);
    expect(noRanges.discovered_endpoints).toEqual({
      operations_api: null,
      operation_detail_api: null,
      tranche_offers_api: null,
    });

    const dayMs = 24 * 60 * 60 * 1000;
    // 1.5 days: (end-start+1)/DAY_MS rounds to 2; (end-start-1) rounds to 1.
    const spanStart = Date.parse("2026-01-01T00:00:00.000Z");
    const spanEnd = spanStart + Math.floor(1.5 * dayMs) - 1;
    const derivedDays = __test__.summarizeExtractionDiagnostics(
      {
        method: "api",
        window_to: "t",
        parsed_through_at: "t",
        parsed_transactions_count: 0,
        debug: {
          extraction_method: "api",
          fallback_used: false,
          fallback_reason: null,
          blocked_reason: null,
          discovered_endpoints: {
            operations_api: null,
            operation_detail_api: null,
            tranche_offers_api: "https://www.tbank.ru/api/tranche?token=secret",
          },
          range_attempts: [{ start: spanStart, end: spanEnd, status_code: 200, payload_count: 1 }],
          response_status_histogram: {},
          stage_timings_ms: {},
          api_error_message: null,
          api_operation_count: 0,
          dom_row_count: 0,
        },
      },
      {},
      0,
      "fast",
    );
    expect(derivedDays.effective_chunk_span_days).toBe(2);
    expect(derivedDays.discovered_endpoints.tranche_offers_api).toBe(
      "https://www.tbank.ru/api/tranche?token=<redacted>",
    );
  });

  it("sanitizes debug URLs and counts rows missing line items", () => {
    expect(__test__.sanitizeDebugUrl(null)).toBeNull();
    expect(__test__.sanitizeDebugUrl("")).toBeNull();
    expect(__test__.sanitizeDebugUrl("not a url")).toBeNull();
    expect(__test__.sanitizeDebugUrl("https://www.tbank.ru/api/ops")).toBe(
      "https://www.tbank.ru/api/ops",
    );
    expect(__test__.sanitizeDebugUrl("https://www.tbank.ru/api/ops?b=2&a=1")).toBe(
      "https://www.tbank.ru/api/ops?a=<redacted>&b=<redacted>",
    );
    expect(
      __test__.countRowsWithoutLineItems([
        { line_items: [{ title: "x" }] },
        { line_items: [] },
        { line_items: "nope" },
        {},
        null as never,
      ]),
    ).toBe(4);
  });

  it("builds shopping-receipt meta for expected, ok, rate-limited and error paths", () => {
    expect(__test__.operationHasShoppingReceipt({ hasShoppingReceipt: true })).toBe(true);
    expect(__test__.operationHasShoppingReceipt({ documents: ["ShoppingReceipt"] })).toBe(true);
    expect(__test__.operationHasShoppingReceipt({ documents: ["SHOPPINGRECEIPT"] })).toBe(true);
    expect(__test__.operationHasShoppingReceipt({ documents: ["other"] })).toBe(false);
    expect(__test__.operationHasShoppingReceipt({ documents: "nope" })).toBe(false);
    expect(__test__.operationHasShoppingReceipt({})).toBe(false);

    expect(__test__.hasReceiptItems(null)).toBe(false);
    expect(__test__.hasReceiptItems({ receipt: { items: [] } })).toBe(false);
    expect(__test__.hasReceiptItems({ receipt: { items: [{ name: "Milk" }] } })).toBe(true);
    expect(__test__.hasReceiptItems({ payload: { receipt: { items: [{ name: "Tea" }] } } })).toBe(
      true,
    );

    expect(__test__.extractReceiptResultCode({ resultCode: "ok" })).toBe("OK");
    expect(__test__.extractReceiptResultCode(null)).toBeNull();
    expect(__test__.extractReceiptMessage({ plainMessage: "p" })).toBe("p");
    expect(__test__.extractReceiptMessage({ errorMessage: "e" })).toBe("e");
    expect(__test__.extractReceiptMessage({ details: { message: "d" } })).toBe("d");
    expect(__test__.extractReceiptMessage(null)).toBeNull();
    expect(__test__.extractReceiptRequestKey({ authorizationId: "a1" })).toBe("a1");
    expect(__test__.extractReceiptRequestKey({ operationId: { value: "oid" } })).toBe("oid");
    expect(__test__.extractReceiptRequestKey({ id: "id1" })).toBe("id1");

    const passthrough = {
      receipt_request_key: "k",
      receipt_enrichment_status: "ok" as const,
      receipt_line_items_skipped: false,
      receipt_retryable: false,
      receipt_retry_attempts: 0,
      receipt_result_code: "OK",
      receipt_tracking_id: "t",
      receipt_message: "m",
      skip_reason: null,
      expected: true,
      requested: true,
    };
    expect(__test__.buildShoppingReceiptMeta({}, null, passthrough)).toEqual(passthrough);

    const notExpected = __test__.buildShoppingReceiptMeta({ id: "x" }, null);
    expect(notExpected).toMatchObject({
      expected: false,
      requested: false,
      receipt_enrichment_status: "not_requested",
      receipt_retryable: false,
      receipt_line_items_skipped: false,
      receipt_request_key: "x",
    });

    const ok = __test__.buildShoppingReceiptMeta(
      { hasShoppingReceipt: true, authorizationId: "auth" },
      {
        trackingId: "trk",
        resultCode: "OK",
        plainMessage: "done",
        receipt: { items: [{ name: "Milk" }] },
      },
    );
    expect(ok).toMatchObject({
      expected: true,
      requested: true,
      receipt_enrichment_status: "ok",
      receipt_line_items_skipped: false,
      receipt_retryable: false,
      receipt_tracking_id: "trk",
      receipt_result_code: "OK",
      receipt_message: "done",
      receipt_request_key: "auth",
    });

    const rateLimited = __test__.buildShoppingReceiptMeta(
      { documents: ["shoppingreceipt"] },
      { resultCode: "REQUEST_RATE_LIMIT_EXCEEDED", trackingId: "r1" },
    );
    expect(rateLimited).toMatchObject({
      receipt_enrichment_status: "rate_limited",
      receipt_line_items_skipped: true,
      receipt_retryable: true,
      requested: true,
      expected: true,
    });

    const missing = __test__.buildShoppingReceiptMeta({ hasShoppingReceipt: true }, null);
    expect(missing.receipt_enrichment_status).toBe("error");
    expect(missing.receipt_message).toBe("Receipt details were not captured.");
    expect(missing.requested).toBe(false);
    expect(missing.expected).toBe(true);
    expect(missing.receipt_line_items_skipped).toBe(true);
    expect(missing.receipt_retryable).toBe(false);

    const emptyItems = __test__.buildShoppingReceiptMeta(
      { hasShoppingReceipt: true },
      { resultCode: "ERROR", errorMessage: "no items", trackingId: "t2" },
    );
    expect(emptyItems.receipt_enrichment_status).toBe("error");
    expect(emptyItems.receipt_line_items_skipped).toBe(true);
    expect(emptyItems.receipt_retryable).toBe(false);
    expect(emptyItems.receipt_message).toBe("no items");
    expect(emptyItems.requested).toBe(true);
    expect(emptyItems.expected).toBe(true);
    expect(emptyItems.receipt_tracking_id).toBe("t2");
  });

  it("maps drop reasons and receipt skip metadata onto rows", () => {
    expect(__test__.mapOperationRecordToRowWithReason(null, { extractionMethod: "api" })).toEqual({
      row: null,
      dropReason: "invalid_record",
    });
    expect(__test__.mapOperationRecordToRowWithReason({}, { extractionMethod: "api" })).toEqual({
      row: null,
      dropReason: "invalid_operation",
    });
    expect(
      __test__.mapOperationRecordToRowWithReason(
        { operation: { description: "x" } },
        { extractionMethod: "api" },
      ),
    ).toEqual({ row: null, dropReason: "missing_time_or_amount" });
    expect(
      __test__.mapOperationRecordToRowWithReason(
        {
          operation: {
            operationTime: { milliseconds: Date.parse("2026-01-01T00:00:00.000Z") },
            description: "x",
          },
        },
        { extractionMethod: "api" },
      ),
    ).toEqual({ row: null, dropReason: "missing_time_or_amount" });
    // Time missing with amount present — keeps the || (not &&) and each null check alive.
    expect(
      __test__.mapOperationRecordToRowWithReason(
        {
          operation: {
            amount: { value: 3, currency: { strCode: "RUB" } },
            accountAmount: { value: 3, currency: { strCode: "RUB" } },
            description: "x",
          },
        },
        { extractionMethod: "api" },
      ),
    ).toEqual({ row: null, dropReason: "missing_time_or_amount" });

    const income = __test__.mapOperationRecordToRowWithReason(
      {
        operation: {
          id: "inc-1",
          type: "Credit",
          status: "OK",
          operationTime: { milliseconds: Date.parse("2026-01-01T00:00:00.000Z") },
          amount: { value: 10, currency: { strCode: "RUB" } },
          accountAmount: { value: 10, currency: { strCode: "RUB" } },
          merchant: { name: "Payroll" },
        },
        shoppingReceiptMeta: {
          receipt_request_key: null,
          receipt_enrichment_status: "not_requested",
          receipt_line_items_skipped: false,
          receipt_retryable: false,
          receipt_retry_attempts: 0,
          receipt_result_code: null,
          receipt_tracking_id: null,
          receipt_message: null,
          skip_reason: "preflight",
          expected: false,
          requested: false,
        },
      },
      { extractionMethod: "api" },
    );
    expect(income.row?.transaction_type).toBe("income");
    expect(income.row?.amount).toBe(10);
    expect(income.row?.merchant_name).toBe("Payroll");
    expect(
      (income.row?.raw_payload as { enrichment?: { shopping_receipt?: { skip_reason?: string } } })
        ?.enrichment?.shopping_receipt?.skip_reason,
    ).toBe("preflight");
    expect(income.row?.dedupe_hash).toBe(
      __test__.buildDedupeHash({
        external_id: "inc-1",
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        merchant_name: "Payroll",
        account_hint: null,
        operation_id: null,
        authorization_id: null,
      }),
    );

    const zeroAmount = __test__.mapOperationRecordToRowWithReason(
      {
        operation: {
          id: "zero-1",
          type: "Credit",
          status: "OK",
          operationTime: { milliseconds: Date.parse("2026-01-01T00:00:00.000Z") },
          amount: { value: 0, currency: { strCode: "RUB" } },
          accountAmount: { value: 0, currency: { strCode: "RUB" } },
          description: "Zero",
        },
      },
      { extractionMethod: "api" },
    );
    // >= 0 must stay income; > 0 would classify zero as expense.
    expect(zeroAmount.row?.transaction_type).toBe("income");
    expect(zeroAmount.row?.amount).toBe(0);

    const merchantOnly = __test__.mapOperationRecordToRowWithReason(
      {
        operation: {
          id: "merch-1",
          type: "Debit",
          status: "OK",
          operationTime: { milliseconds: Date.parse("2026-01-01T00:00:00.000Z") },
          amount: { value: 2, currency: { strCode: "RUB" } },
          accountAmount: { value: 2, currency: { strCode: "RUB" } },
          merchant: { name: "Only Merchant" },
        },
      },
      { extractionMethod: "api" },
    );
    expect(merchantOnly.row?.merchant_name).toBe("Only Merchant");

    const pendingReceipt = __test__.mapOperationRecordToRowWithReason(
      {
        operation: {
          id: "exp-1",
          type: "Debit",
          status: "OK",
          hasShoppingReceipt: true,
          operationTime: { milliseconds: Date.parse("2026-01-01T00:00:00.000Z") },
          amount: { value: 5, currency: { strCode: "RUB" } },
          accountAmount: { value: 5, currency: { strCode: "RUB" } },
          description: "Shop",
        },
        shoppingReceipt: null,
      },
      { extractionMethod: "api" },
    );
    expect(pendingReceipt.row?.transaction_type).toBe("expense");
    expect(
      (pendingReceipt.row?.raw_payload as { all_details_captured?: boolean })?.all_details_captured,
    ).toBe(false);
  });

  it("extracts absolute URLs, brands, categories and formats diagnostic errors", () => {
    expect(__test__.extractAbsoluteUrl(null)).toBeNull();
    expect(__test__.extractAbsoluteUrl("")).toBeNull();
    expect(__test__.extractAbsoluteUrl("ftp://x")).toBeNull();
    expect(__test__.extractAbsoluteUrl("https://cdn.example/a.png")).toBe(
      "https://cdn.example/a.png",
    );
    expect(__test__.extractAbsoluteUrl("http://cdn.example/a.png")).toBe(
      "http://cdn.example/a.png",
    );
    expect(__test__.extractAbsoluteUrl("not a url")).toBeNull();

    expect(__test__.isBankNativeBrandLabel(null)).toBe(false);
    expect(__test__.isBankNativeBrandLabel("   ")).toBe(false);
    expect(__test__.isBankNativeBrandLabel("Внутрибанковский перевод")).toBe(true);
    expect(__test__.isBankNativeBrandLabel("Coffee")).toBe(false);

    expect(__test__.extractSourceBrand({})).toBeNull();
    expect(__test__.extractSourceBrand({ brand: { name: "  " } })).toBeNull();
    expect(__test__.extractSourceBrand({ brand: { name: "Внутрибанковский перевод" } })).toBeNull();
    expect(
      __test__.extractSourceBrand({
        brand: { id: "b1", name: "Coffee Co", link: "https://c.example" },
      }),
    ).toEqual(
      expect.objectContaining({
        source_key: "b1",
        name: "Coffee Co",
        website_url: "https://c.example/",
      }),
    );

    expect(__test__.extractSourceCategory({})).toBeNull();
    expect(__test__.extractSourceCategory({ categoryInfo: { bankCategory: {} } })).toBeNull();
    expect(
      __test__.extractSourceCategory({
        categoryInfo: { bankCategory: { id: "c1", name: "Food" } },
      }),
    ).toEqual({ id: "c1", name: "Food" });
    expect(
      __test__.extractSourceCategory({ categoryInfo: { bankCategory: { name: "Food" } } }),
    ).toEqual({ id: null, name: "Food" });

    const withPeriod = __test__.formatDiagnosticError("Already done.", { a: 1 });
    expect(withPeriod.message).toBe('Already done. diagnostics={"a":1}');
    const withoutPeriod = __test__.formatDiagnosticError("Missing end", { b: 2 });
    expect(withoutPeriod.message).toBe('Missing end. diagnostics={"b":2}');
    // trim() must run: leading space would otherwise keep the period regex from seeing the end.
    expect(__test__.formatDiagnosticError("  Padded.  ", { c: 3 }).message).toBe(
      'Padded. diagnostics={"c":3}',
    );
    // $ anchor: an internal period must not suppress the trailing separator.
    expect(__test__.formatDiagnosticError("Hello. world", { d: 4 }).message).toBe(
      'Hello. world. diagnostics={"d":4}',
    );
  });

  it("keeps operation range edges inclusive at windowFrom", () => {
    const windowFromMs = Date.parse("2026-01-01T00:00:00.000Z");
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    expect(__test__.buildOperationRanges(windowFromMs, nowMs, 14)).toEqual([
      { start: windowFromMs, end: nowMs },
    ]);
    const multi = __test__.buildOperationRanges(
      windowFromMs,
      Date.parse("2026-01-20T00:00:00.000Z"),
      7,
    );
    expect(multi[multi.length - 1]?.start).toBe(windowFromMs);
    expect(multi.every((range) => range.end >= range.start)).toBe(true);
    // Exact chunk boundary: start == windowFrom must break (<= not <).
    const exact = __test__.buildOperationRanges(
      windowFromMs,
      windowFromMs + 7 * 24 * 60 * 60 * 1000 - 1,
      7,
    );
    expect(exact).toHaveLength(1);
    expect(exact[0]?.start).toBe(windowFromMs);
  });
});

describe("tbank-web connector.parse mutation coverage (T-261116-rul)", () => {
  function installSimpleChrome(
    executeScript: ReturnType<typeof vi.fn>,
    tab?: Record<string, unknown>,
  ) {
    const active = tab ?? { id: 77, url: "https://www.tbank.ru/mybank/operations/" };
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([active]),
        get: vi.fn().mockResolvedValue({ ...active, status: "complete" }),
        update: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;
  }

  it("emits progress, honors tab_id/session fields, and fills debug defaults", async () => {
    const onProgress = vi.fn();
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [
            {
              operation: {
                id: "op-progress",
                operationTime: { milliseconds: Date.parse("2026-02-01T00:00:00.000Z") },
                type: "Debit",
                status: "OK",
                amount: { value: 40, currency: { strCode: "RUB" } },
                accountAmount: { value: 40, currency: { strCode: "RUB" } },
                description: "Progress cafe",
              },
              operationDetail: null,
              shoppingReceipt: null,
            },
            { operation: null },
            null,
            {
              operation: {
                description: "missing amount",
                operationTime: { milliseconds: Date.parse("2026-02-01T00:00:00.000Z") },
              },
            },
          ],
          window_to: "not-a-date",
          parsed_through_at: "also-bad",
          // Force fallback to rows.length for parsedTransactionsCount.
          parsed_transactions_count: "nope",
          debug: {
            extraction_method: "api",
            fallback_used: false,
            fallback_reason: null,
            blocked_reason: null,
            discovered_endpoints: {
              operations_api: null,
              operation_detail_api: null,
              tranche_offers_api: null,
            },
            range_attempts: [],
            response_status_histogram: {},
            stage_timings_ms: {},
            api_error_message: null,
            api_operation_count: 1,
            dom_row_count: 0,
          },
        },
      },
    ]);
    const get = vi.fn().mockResolvedValue({
      id: 88,
      url: "https://www.tbank.ru/mybank/operations/",
      status: "complete",
    });
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn(),
        get,
        update: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      session: {
        session_id: "sess-1",
        source: "custom_source",
        payer_person_id: "person-1",
        parse_strategy: "full",
      },
      debug: { tab_id: 88, on_progress: onProgress },
    });

    expect(get).toHaveBeenCalledWith(88);
    expect(onProgress.mock.calls.map((call) => call[0]?.phase)).toEqual([
      "parse_preparing_tab",
      "parse_loading_operations_page",
      "parse_extracting_page_data",
      "parse_mapping_rows",
    ]);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "parse_mapping_rows",
        parsed_transactions_count: null,
      }),
    );
    expect(executeScript.mock.calls[0]?.[0]?.args?.[0]).toMatchObject({
      parseStrategy: "full",
      sessionId: "sess-1",
      sourceId: "custom_source",
      payerPersonId: "person-1",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.parsedTransactionsCount).toBe(1);
    expect(result.debug?.mapping_drop_counts).toMatchObject({
      invalid_record: 1,
      invalid_operation: 1,
      missing_time_or_amount: 1,
    });
    // Bad extraction timestamps fall back to now / windowFrom.
    expect(result.windowTo).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.parsedThroughAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("queries the active tab with lastFocusedWindow and tolerates a missing on_progress", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 77, url: "https://www.tbank.ru/mybank/operations/" }]);
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
        },
      },
    ]);
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query,
        get: vi.fn(),
        update: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      debug: {},
    });
    expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  });

  it("defaults the lookback window when windowFrom and last_imported_at are absent", async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
        },
      },
    ]);
    installSimpleChrome(executeScript);
    const before = Date.now();
    await connector.parse({ source: "tbank_web" });
    const after = Date.now();
    const passedFrom = Date.parse(
      String(executeScript.mock.calls[0]?.[0]?.args?.[0]?.windowFromIso),
    );
    const expectedMin = before - 30 * 24 * 60 * 60 * 1000 - 2000;
    const expectedMax = after - 30 * 24 * 60 * 60 * 1000 + 2000;
    expect(passedFrom).toBeGreaterThanOrEqual(expectedMin);
    expect(passedFrom).toBeLessThanOrEqual(expectedMax);
  });

  it("uses session.last_imported_at when windowFrom is absent", async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
        },
      },
    ]);
    installSimpleChrome(executeScript);
    await connector.parse({
      source: "tbank_web",
      session: { last_imported_at: "2026-01-15T00:00:00.000Z" },
    });
    expect(executeScript.mock.calls[0]?.[0]?.args?.[0]?.windowFromIso).toBe(
      "2026-01-15T00:00:00.000Z",
    );
  });

  it("rejects a missing tab, a non-T-Bank tab, and DOM fallback with zero rows", async () => {
    const queryEmpty = vi.fn().mockResolvedValue([{}]);
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: queryEmpty,
        get: vi.fn(),
        update: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn() },
    } as unknown as typeof chrome;
    await expect(
      connector.parse({ source: "tbank_web", windowFrom: "2026-02-01T00:00:00.000Z" }),
    ).rejects.toThrow(/No active tab/);
    expect(queryEmpty).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });

    const getRejects = vi.fn().mockRejectedValue(new Error("gone"));
    (globalThis as { chrome: Record<string, unknown> }).chrome = {
      tabs: {
        query: vi.fn(),
        get: getRejects,
        update: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn() },
    } as unknown as typeof chrome;
    await expect(
      connector.parse({
        source: "tbank_web",
        windowFrom: "2026-02-01T00:00:00.000Z",
        debug: { tab_id: 99 },
      }),
    ).rejects.toThrow(/No active tab/);

    installSimpleChrome(vi.fn(), { id: 77, url: "https://example.com/" });
    await expect(
      connector.parse({ source: "tbank_web", windowFrom: "2026-02-01T00:00:00.000Z" }),
    ).rejects.toThrow(/Active tab is not a T-Bank page/);

    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "dom",
          rows: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
          debug: {
            extraction_method: "dom",
            fallback_used: true,
            fallback_reason: "api_failed",
            blocked_reason: null,
            discovered_endpoints: {
              operations_api: null,
              operation_detail_api: null,
              tranche_offers_api: null,
            },
            range_attempts: [],
            response_status_histogram: {},
            stage_timings_ms: {},
            api_error_message: "boom",
            api_operation_count: 0,
            dom_row_count: 0,
          },
        },
      },
    ]);
    installSimpleChrome(executeScript);
    await expect(
      connector.parse({ source: "tbank_web", windowFrom: "2026-02-01T00:00:00.000Z" }),
    ).rejects.toThrow(/DOM fallback returned zero rows.*fallback_reason/);

    // DOM zero rows without debug.fallback_used must not take the diagnostic throw path.
    const quietDom = vi.fn().mockResolvedValue([
      {
        result: {
          method: "dom",
          rows: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
        },
      },
    ]);
    installSimpleChrome(quietDom);
    const quiet = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
    });
    expect(quiet.rows).toEqual([]);

    // API with empty rows + fallback_used must not throw (kills method==="dom" → true).
    const apiFallback = vi.fn().mockResolvedValue([
      {
        result: {
          method: "api",
          operation_records: [],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 0,
          debug: {
            extraction_method: "api",
            fallback_used: true,
            fallback_reason: "unused",
            blocked_reason: null,
            discovered_endpoints: {
              operations_api: null,
              operation_detail_api: null,
              tranche_offers_api: null,
            },
            range_attempts: [],
            response_status_histogram: {},
            stage_timings_ms: {},
            api_error_message: null,
            api_operation_count: 0,
            dom_row_count: 0,
          },
        },
      },
    ]);
    installSimpleChrome(apiFallback);
    const apiEmpty = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
    });
    expect(apiEmpty.rows).toEqual([]);
  });

  it("maps DOM rows when method is dom and keeps numeric parsedTransactionsCount", async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          method: "dom",
          rows: [
            {
              amount: -12,
              posted_at: "2026-02-01T00:00:00.000Z",
              merchant_name: "DOM shop",
              line_items: [{ title: "DOM shop", amount: -12 }],
            },
          ],
          window_to: "2026-03-05T12:00:00.000Z",
          parsed_through_at: "2026-02-01T00:00:00.000Z",
          parsed_transactions_count: 9,
          debug: {
            extraction_method: "dom",
            fallback_used: true,
            fallback_reason: "api_failed",
            blocked_reason: null,
            discovered_endpoints: {
              operations_api: null,
              operation_detail_api: null,
              tranche_offers_api: null,
            },
            range_attempts: [],
            response_status_histogram: {},
            stage_timings_ms: {},
            api_error_message: null,
            api_operation_count: 0,
            dom_row_count: 1,
          },
        },
      },
    ]);
    installSimpleChrome(executeScript);
    const onProgress = vi.fn();
    const result = await connector.parse({
      source: "tbank_web",
      windowFrom: "2026-02-01T00:00:00.000Z",
      debug: { on_progress: onProgress },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.parsedTransactionsCount).toBe(9);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "parse_mapping_rows", parsed_transactions_count: 9 }),
    );
  });

  it("includes blocked_reason diagnostics when page extraction reports a block", async () => {
    installSimpleChrome(
      vi.fn().mockResolvedValue([
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
    );
    await expect(
      connector.parse({ source: "tbank_web", windowFrom: "2026-02-01T00:00:00.000Z" }),
    ).rejects.toThrow(/blocked_reason/);
  });
});

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
    // The mapper leaves identity unset; applyMoneyDedupeHashes fills it for the whole run.
    expect(row?.dedupe_hash).toBeNull();
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
      maxReceiptsPerRun: 50,
      payerPersonId: null,
      sessionId: null,
      sourceId: "tbank_web",
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
      maxReceiptsPerRun?: number | null;
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
      maxReceiptsPerRun?: number | null;
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
        // This case is about the bank's request window, not the per-run receipt budget, so
        // the budget is lifted out of the way.
        maxReceiptsPerRun: 1000,
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
      maxReceiptsPerRun?: number | null;
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
        // This case is about the bank's request window, not the per-run receipt budget, so
        // the budget is lifted out of the way.
        maxReceiptsPerRun: 1000,
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

  describe("range truncation", () => {
    function runInPageExtractor(options: {
      windowFromIso: string;
      nowIso: string;
      /** Operations the bank returns for a given [start, end] range. */
      operationsFor: (start: number, end: number) => Array<Record<string, unknown>>;
    }) {
      const isolatedFactory = new Function(
        `return (${__test__.extractOperationsInPage.toString()});`,
      ) as () => (input: {
        windowFromIso?: string;
        sessionId?: string | null;
        parseStrategy?: string | null;
      }) => Promise<Record<string, unknown>>;
      const isolatedExtractor = isolatedFactory();

      const originals = {
        window: (globalThis as Record<string, unknown>).window,
        document: (globalThis as Record<string, unknown>).document,
        performance: (globalThis as Record<string, unknown>).performance,
        fetch: (globalThis as Record<string, unknown>).fetch,
        URL: (globalThis as Record<string, unknown>).URL,
        chrome: (globalThis as Record<string, unknown>).chrome,
        dateNow: Date.now,
        setTimeout: globalThis.setTimeout,
      };

      const requestedRanges: Array<{ start: number; end: number }> = [];

      (globalThis as Record<string, unknown>).window = {
        location: {
          href: "https://www.tbank.ru/mybank/operations/",
          origin: "https://www.tbank.ru",
        },
      };
      (globalThis as Record<string, unknown>).document = {
        body: { innerText: "" },
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
      (globalThis as Record<string, unknown>).chrome = { runtime: { sendMessage: vi.fn() } };
      Date.now = () => Date.parse(options.nowIso);
      globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
        callback();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;
      (globalThis as Record<string, unknown>).fetch = vi
        .fn()
        .mockImplementation(async (input: string) => {
          const url = new URL(input);
          if (url.pathname !== "/api/common/v1/operations") {
            return { ok: false, status: 404, json: async () => null };
          }
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          requestedRanges.push({ start, end });
          return {
            ok: true,
            status: 200,
            json: async () => ({ payload: options.operationsFor(start, end) }),
          };
        });

      const restore = () => {
        (globalThis as Record<string, unknown>).window = originals.window;
        (globalThis as Record<string, unknown>).document = originals.document;
        (globalThis as Record<string, unknown>).performance = originals.performance;
        (globalThis as Record<string, unknown>).fetch = originals.fetch;
        (globalThis as Record<string, unknown>).URL = originals.URL;
        (globalThis as Record<string, unknown>).chrome = originals.chrome;
        Date.now = originals.dateNow;
        globalThis.setTimeout = originals.setTimeout;
      };

      return {
        requestedRanges,
        restore,
        run: () =>
          isolatedExtractor({
            windowFromIso: options.windowFromIso,
            sessionId: "abc",
            parseStrategy: "fast",
          }),
      };
    }

    function operation(index: number, atMs: number): Record<string, unknown> {
      return {
        id: `op-${index}-${atMs}`,
        authorizationId: `auth-${index}-${atMs}`,
        operationTime: { milliseconds: atMs },
        type: "Debit",
        status: "OK",
        amount: { value: 100 + index, currency: { strCode: "RUB" } },
        accountAmount: { value: 100 + index, currency: { strCode: "RUB" } },
        description: `Merchant ${index}`,
        documents: [],
      };
    }

    it("splits a range whose response came back at the page limit", async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const harness = runInPageExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
        nowIso: "2026-03-08T00:00:00.000Z",
        operationsFor: (start, end) => {
          const span = end - start + 1;
          // A wide range comes back capped; each half fits comfortably.
          const count = span > 4 * dayMs ? 100 : 10;
          return Array.from({ length: count }, (_, index) =>
            operation(index, end - index * 60_000),
          );
        },
      });

      try {
        const result = (await harness.run()) as Record<string, unknown>;
        const debug = (result.debug ?? {}) as Record<string, unknown>;

        expect(debug.range_split_count).toBeGreaterThan(0);
        expect(debug.truncation_suspected_count).toBeGreaterThan(0);
        expect(debug.truncation_unresolved_count).toBe(0);
        expect(debug.partial_result).toBe(false);

        // Halves were re-requested, so more ranges were fetched than were planned.
        expect(harness.requestedRanges.length).toBeGreaterThan(1);

        // Operations gathered across the halves are deduplicated, not doubled.
        const records = (result.operation_records ?? []) as Array<Record<string, unknown>>;
        const ids = records.map((record) => {
          const operationRecord = record.operation as Record<string, unknown>;
          return operationRecord.id;
        });
        expect(new Set(ids).size).toBe(ids.length);
      } finally {
        harness.restore();
      }
    });

    it("reports a single day it cannot get past instead of looking complete", async () => {
      const harness = runInPageExtractor({
        windowFromIso: "2026-03-06T00:00:00.000Z",
        nowIso: "2026-03-08T00:00:00.000Z",
        // Every range stays at the cap, so splitting bottoms out at one day.
        operationsFor: (_start, end) =>
          Array.from({ length: 100 }, (_, index) => operation(index, end - index * 1000)),
      });

      try {
        const result = (await harness.run()) as Record<string, unknown>;
        const debug = (result.debug ?? {}) as Record<string, unknown>;

        expect(debug.truncation_unresolved_count).toBeGreaterThan(0);
        expect(debug.partial_result).toBe(true);
      } finally {
        harness.restore();
      }
    });

    it("leaves an unremarkable window alone", async () => {
      const harness = runInPageExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
        nowIso: "2026-03-08T00:00:00.000Z",
        operationsFor: (_start, end) =>
          Array.from({ length: 5 }, (_, index) => operation(index, end - index * 60_000)),
      });

      try {
        const result = (await harness.run()) as Record<string, unknown>;
        const debug = (result.debug ?? {}) as Record<string, unknown>;

        expect(debug.range_split_count).toBe(0);
        expect(debug.truncation_suspected_count).toBe(0);
        expect(debug.truncation_unresolved_count).toBe(0);
        expect(debug.partial_result).toBe(false);
      } finally {
        harness.restore();
      }
    });
  });

  it("stops fetching receipts once the run budget is spent", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: {
      windowFromIso?: string;
      sessionId?: string | null;
      parseStrategy?: string | null;
      maxReceiptsPerRun?: number | null;
    }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originals = {
      window: (globalThis as Record<string, unknown>).window,
      document: (globalThis as Record<string, unknown>).document,
      performance: (globalThis as Record<string, unknown>).performance,
      fetch: (globalThis as Record<string, unknown>).fetch,
      URL: (globalThis as Record<string, unknown>).URL,
      chrome: (globalThis as Record<string, unknown>).chrome,
      setTimeout: globalThis.setTimeout,
    };

    const receiptRequests: string[] = [];
    const operationsPayload = Array.from({ length: 3 }, (_, index) => ({
      id: `op-${index + 1}`,
      authorizationId: `auth-${index + 1}`,
      operationTime: { milliseconds: Date.parse("2026-03-08T12:00:00.000Z") - index * 60_000 },
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
      body: { innerText: "" },
      querySelectorAll: vi.fn().mockReturnValue([]),
    };
    (globalThis as Record<string, unknown>).performance = {
      getEntriesByType: vi.fn().mockImplementation((type: string) => {
        if (type !== "resource") return [];
        return [
          { name: "https://www.tbank.ru/api/common/v1/operations?sessionid=abc&start=1&end=2" },
        ];
      }),
    };
    (globalThis as Record<string, unknown>).URL = URL;
    (globalThis as Record<string, unknown>).chrome = { runtime: { sendMessage: vi.fn() } };
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    (globalThis as Record<string, unknown>).fetch = vi
      .fn()
      .mockImplementation(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/api/common/v1/operations") {
          return { ok: true, status: 200, json: async () => ({ payload: operationsPayload }) };
        }
        if (url.pathname === "/api/common/v1/shopping_receipt") {
          receiptRequests.push(url.searchParams.get("operationId") ?? "");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resultCode: "OK",
              payload: { receipt: { items: [{ name: "item", sum: 100, quantity: 1 }] } },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => null };
      });

    try {
      const result = (await isolatedExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
        sessionId: "abc",
        parseStrategy: "fast",
        maxReceiptsPerRun: 2,
      })) as Record<string, unknown>;

      // Only the budget is spent; nothing is requested for the third operation.
      expect(receiptRequests).toHaveLength(2);

      const records = (result.operation_records ?? []) as Array<Record<string, unknown>>;
      const statuses = records.map((record) => {
        const meta = record.shoppingReceiptMeta as Record<string, unknown>;
        return meta.receipt_enrichment_status;
      });
      expect(statuses.filter((status) => status === "skipped_after_budget")).toHaveLength(1);

      const debug = (result.debug ?? {}) as Record<string, unknown>;
      const receiptDebug = (debug.receipt_enrichment ?? {}) as Record<string, unknown>;
      expect(receiptDebug.skipped_after_budget_count).toBe(1);
      expect(receiptDebug.stopped_after_budget).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).window = originals.window;
      (globalThis as Record<string, unknown>).document = originals.document;
      (globalThis as Record<string, unknown>).performance = originals.performance;
      (globalThis as Record<string, unknown>).fetch = originals.fetch;
      (globalThis as Record<string, unknown>).URL = originals.URL;
      (globalThis as Record<string, unknown>).chrome = originals.chrome;
      globalThis.setTimeout = originals.setTimeout;
    }
  });
});

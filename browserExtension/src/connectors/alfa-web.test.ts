import { afterEach, describe, expect, it, vi } from "vitest";
import connector, { __test__ } from "./alfa-web.js";

const SAMPLE_PURCHASE_OPERATION = {
  id: "1260305MOCO@SV8C51927",
  operationId: "A5A01002-3D67-1AEF-AADD-0004AC1DE54B",
  smartVistaFrontReference: "465307132020",
  dateTime: "2026-03-03T09:22:13.625+0700",
  title: "Аптека",
  logoUrl: "https://enricher.mfms.ru/merchantIcons/UniversalPharmacy_300x300.png",
  amount: {
    value: 111700,
    currency: "RUR",
    minorUnits: 100,
  },
  mcc: "5912",
  category: {
    id: "00046",
    name: "Аптеки",
    color: "#49DFE7",
    icon: "rocky_plus-medicine_m",
    valueFieldColor: "STATIC_PFM_SYSTEM_COLOR_Uranus",
    isClientCategory: false,
  },
  direction: "EXPENSE",
  loyalty: {
    title: "Рубли",
    subTitle: "Рубли",
    type: "CASHBACK",
    amount: {
      value: 4400,
      currency: "RUR",
      minorUnits: 100,
    },
    amountSign: "PLUS",
    status: "SUCCESS",
  },
  loyaltyDetails: {},
  status: "SUCCESS",
  actions: [
    {
      type: "DOCUMENT",
      label: "Получить квитанцию",
      mobileApiPath:
        "v1/operation-info/operations/1260305MOCO%40SV8C51927/documents/pdf?isPos=true",
      referenceId: "1260305MOCO@SV8C51927",
      isPos: true,
    },
  ],
  deepLink:
    "https://online.alfabank.ru/transaction_details?fromCurrent=true&id=1260305MOCO@SV8C51927",
  receipt: {
    smartVistaFrontReference: "465307132020",
    itemsCount: 3,
  },
  installmentAvailable: false,
  isAnotherClient: false,
  isNonFinancialOperation: false,
};

const SAMPLE_INCOME_OPERATION = {
  id: "1260302MOCOIPFB601226",
  operationId: "E2F52002-FF4E-1AEE-AADD-0004AC1DE54B",
  clickReference: "C170203260115841",
  dateTime: "2026-03-02T08:30:59.693+0700",
  title: "Максим П.",
  amount: {
    value: 3500000,
    currency: "RUR",
    minorUnits: 100,
  },
  category: {
    id: "50009",
    name: "Переводы · СБП · Т-Банк",
    color: "#3FCDFE",
    icon: "glyph_pfm-transfer_m",
    valueFieldColor: "STATIC_PFM_SYSTEM_COLOR_FIDES",
    isClientCategory: false,
  },
  direction: "INCOME",
  loyaltyDetails: {},
  actions: [],
  installmentAvailable: false,
  isAnotherClient: false,
  isNonFinancialOperation: false,
};

const SAMPLE_OLD_OPERATION = {
  id: "1260130MOC7@@APK00015",
  operationId: "6E3CF002-91DA-1AEC-A128-0004AC1DE54C",
  dateTime: "2026-01-30T11:05:31.616+0700",
  title: "Комиссия за Альфа-Смарт",
  amount: {
    value: 39900,
    currency: "RUR",
    minorUnits: 100,
  },
  category: {
    id: "00025",
    name: "Прочие расходы",
    color: "#A9B3F9",
    icon: "glyph_pointer-up_m",
    valueFieldColor: "STATIC_PFM_SYSTEM_COLOR_Tars",
    isClientCategory: false,
  },
  direction: "EXPENSE",
  loyaltyDetails: {},
  status: "SUCCESS",
  actions: [],
  installmentAvailable: false,
  isAnotherClient: false,
  isNonFinancialOperation: false,
};

const SAMPLE_DETAIL = {
  id: "1260305MOCO@SV8C51927",
  operationId: "A5A01002-3D67-1AEF-AADD-0004AC1DE54B",
  dateTime: "2026-03-03T09:22:13.625+0700",
  title: "Аптека",
  amount: {
    value: 111700,
    currency: "RUR",
    minorUnits: 100,
  },
  comment: null,
  category: {
    id: "00046",
    name: "Аптеки",
  },
  direction: "EXPENSE",
  status: "SUCCESS",
  fields: [
    {
      id: "ofd-receipts-content",
      type: "SDUI_FIELD",
      view: {
        type: "RightIconWrapper",
        content: {
          content: {
            type: "StackView",
            content: {
              children: [
                {
                  type: "DataContent",
                  content: {
                    title: {
                      value: "3 позиции",
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      id: "cardId",
      type: "SDUI_FIELD",
      view: {
        type: "StackView",
        content: {
          children: [
            {
              type: "DataView",
              content: {
                dataContent: {
                  title: { value: "Карта списания" },
                  subtitle: { value: "Альфа-карта МИР" },
                  value: { value: "6745" },
                },
              },
            },
          ],
        },
      },
    },
    {
      id: "paymentDetails",
      type: "SDUI_FIELD",
      view: {
        type: "StackView",
        content: {
          children: [
            {
              type: "DataView",
              content: {
                dataContent: {
                  title: { value: "Код торговой точки" },
                  value: { value: "MCC 5912" },
                },
              },
            },
          ],
        },
      },
    },
  ],
};

const SAMPLE_RECEIPT = {
  fields: [
    {
      id: "line-1",
      hidden: false,
      type: "DATA_VIEW",
      title:
        "МЕТРОКСИДИН ДЕНТА ГЕЛЬ СТОМАТОЛОГИЧЕСКИЙ 1%+0,05% 20Г. ТУБА /ТУЛЬСКАЯ/ (Годен до 09.2028 Партия 33772/24 от 27.02.2026 (101025))",
      subtitle: "462 ₽ x 1",
      value: "462 ₽",
      isMultiline: true,
    },
    {
      id: "line-2",
      hidden: false,
      type: "DATA_VIEW",
      title:
        "НЕКСИУМ 40МГ. №28 ТАБ. П/О /АСТРА ЗЕНЕКА/ (Годен до 12.2027 Партия 392433988-001 от 21.02.2026 (ZRRV))",
      subtitle: "406 ₽ x 1",
      value: "406 ₽",
      isMultiline: true,
    },
    {
      id: "line-3",
      hidden: false,
      type: "DATA_VIEW",
      title:
        "СМЕКТА 3Г. №20 АПЕЛЬСИН ПОР. Д/СУСП. Д/ПРИЕМА ВНУТРЬ /ИПСЕН/ (Годен до 04.2028 Партия 23499/24 от 12.02.2026 (D70293))",
      subtitle: "249 ₽ x 1",
      value: "249 ₽",
      isMultiline: true,
    },
    {
      id: "cash",
      hidden: false,
      type: "DATA_VIEW",
      title: "Наличные:",
      value: "0 ₽",
    },
    {
      id: "cashless",
      hidden: false,
      type: "DATA_VIEW",
      title: "Безналичные:",
      value: "1117 ₽",
    },
    {
      id: "total",
      hidden: false,
      type: "DATA_VIEW",
      title: "Итого:",
      value: "1117 ₽",
    },
  ],
  isPdfAvailable: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("alfa-web connector", () => {
  it("registers expected connector metadata", () => {
    expect(connector.sourceId).toBe("alfa_web");
    expect(connector.displayName).toBe("Alfa Bank Web");
    expect(typeof connector.parse).toBe("function");
  });

  it("treats alfa auth pages as blocked before API calls", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: { windowFromIso?: string }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;

    (globalThis as Record<string, unknown>).window = {
      location: {
        href: "https://private.auth.alfabank.ru/passport/cerberus-mini-blue/dashboard-blue/phone_auth",
        origin: "https://private.auth.alfabank.ru",
      },
    };
    (globalThis as Record<string, unknown>).document = {
      cookie: "",
      body: { innerText: "Привет! Войдите в Альфа-Онлайн" },
      querySelectorAll: vi.fn().mockReturnValue([]),
    };
    (globalThis as Record<string, unknown>).fetch = vi.fn();
    (globalThis as Record<string, unknown>).URL = URL;

    try {
      const result = await isolatedExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({
        method: "api",
        blocked_reason: "Alfa Bank session is not authorized. Sign in and retry import.",
      });
      expect((globalThis as Record<string, unknown>).fetch).not.toHaveBeenCalled();
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
    }
  });

  it("extracts paginated operations and enriches details + receipts via API", async () => {
    const isolatedFactory = new Function(
      `return (${__test__.extractOperationsInPage.toString()});`,
    ) as () => (input: { windowFromIso?: string }) => Promise<Record<string, unknown>>;
    const isolatedExtractor = isolatedFactory();

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalFetch = (globalThis as Record<string, unknown>).fetch;
    const originalURL = (globalThis as Record<string, unknown>).URL;

    const fetchCalls: Array<{
      input: string;
      method: string;
      headers: Record<string, string>;
      body: string | null;
    }> = [];

    (globalThis as Record<string, unknown>).window = {
      location: {
        href: "https://web.alfabank.ru/history/",
        origin: "https://web.alfabank.ru",
      },
    };
    (globalThis as Record<string, unknown>).document = {
      cookie: "XSRF-TOKEN=token-123; zone-offset=-420; DEVICE_APP_ID=device-123; other=value",
      body: { innerText: "История операций" },
      querySelectorAll: vi.fn().mockReturnValue([]),
    };
    (globalThis as Record<string, unknown>).URL = URL;
    (globalThis as Record<string, unknown>).fetch = vi
      .fn()
      .mockImplementation(
        async (
          input: string | URL,
          init?: { method?: string; headers?: Record<string, string>; body?: string },
        ) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          const headers = (init?.headers as Record<string, string> | undefined) ?? {};
          const body = init?.body ?? null;
          fetchCalls.push({ input: url, method, headers, body });

          const pathname = new URL(url, "https://web.alfabank.ru").pathname;
          if (pathname === "/api/v1/operations-history/operations") {
            const page = body ? ((JSON.parse(body) as { page?: number }).page ?? 1) : 1;
            return {
              ok: true,
              status: 200,
              json: async () => ({
                operations:
                  page === 1
                    ? [SAMPLE_PURCHASE_OPERATION, SAMPLE_INCOME_OPERATION]
                    : [SAMPLE_OLD_OPERATION],
              }),
            };
          }
          if (pathname === "/api/v1/operations-history/operations/1260305MOCO%40SV8C51927") {
            return {
              ok: true,
              status: 200,
              json: async () => SAMPLE_DETAIL,
            };
          }
          if (pathname === "/api/v1/operations-history/operations/1260302MOCOIPFB601226") {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: SAMPLE_INCOME_OPERATION.id,
                title: SAMPLE_INCOME_OPERATION.title,
                fields: [],
              }),
            };
          }
          if (pathname === "/api/v1/ofd/receipt/465307132020") {
            return {
              ok: true,
              status: 200,
              json: async () => SAMPLE_RECEIPT,
            };
          }
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: "not found" }),
          };
        },
      );

    try {
      const result = await isolatedExtractor({
        windowFromIso: "2026-03-01T00:00:00.000Z",
      });

      expect(result.blocked_reason).toBeUndefined();
      expect(result.parsed_transactions_count).toBe(2);
      expect(result.parsed_through_at).toBe("2026-03-01T00:00:00.000Z");
      expect((result.operation_records as Array<unknown>) ?? []).toHaveLength(2);

      const requestBodies = fetchCalls
        .filter((call) => call.input.includes("/api/v1/operations-history/operations"))
        .map((call) => call.body);
      expect(requestBodies).toEqual([
        JSON.stringify({ size: 20, page: 1, forced: true, filters: [] }),
        JSON.stringify({ size: 20, page: 2, filters: [] }),
      ]);
      expect(
        fetchCalls.find((call) => call.input.includes("/api/v1/ofd/receipt/465307132020"))?.headers,
      ).toMatchObject({
        "x-xsrf-token": "token-123",
        "ao-origin-application-id": "newclick-operations-history-ui",
        "x-screen-dimension": "desktop",
      });
      expect(result.debug).toMatchObject({
        extraction_method: "api",
        fallback_used: false,
        api_operation_count: 2,
        detail_request_count: 2,
        receipt_request_count: 1,
      });
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
      (globalThis as Record<string, unknown>).fetch = originalFetch;
      (globalThis as Record<string, unknown>).URL = originalURL;
    }
  });

  it("maps alfa operation record into canonical row with receipt line items", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: SAMPLE_PURCHASE_OPERATION,
        operationDetail: SAMPLE_DETAIL,
        receipt: SAMPLE_RECEIPT,
      },
      { extractionMethod: "api" },
    );

    expect(row).not.toBeNull();
    expect(row?.source).toBe("alfa");
    expect(row?.external_id).toBe("1260305MOCO@SV8C51927");
    expect(row?.posted_at).toBe("2026-03-03T02:22:13.625Z");
    expect(row?.amount).toBe(-111700);
    expect(row?.currency).toBe("RUB");
    expect(row?.transaction_type).toBe("expense");
    expect(row?.merchant_name).toBe("Аптека");
    expect(row?.mcc).toBe("5912");
    expect(row?.cashback_amount).toBe(4400);
    expect(row?.cashback_currency).toBe("RUB");
    expect(row?.operation_icon_url).toBe(
      "https://enricher.mfms.ru/merchantIcons/UniversalPharmacy_300x300.png",
    );
    expect(row?.source_category).toEqual({
      id: "00046",
      name: "Аптеки",
    });
    expect(row?.receipt_request_key).toBe("465307132020");
    expect(row?.receipt_enrichment_status).toBe("ok");
    expect(row?.receipt_line_items_skipped).toBe(false);
    expect(row?.dedupe_hash).toMatch(/^afw_/);
    expect(row?.line_items).toHaveLength(3);
    expect((row?.line_items as Array<Record<string, unknown>>)[0]?.title).toContain(
      "МЕТРОКСИДИН ДЕНТА",
    );
    expect((row?.line_items as Array<Record<string, unknown>>)[0]?.amount).toBe(-46200);
    expect((row?.line_items as Array<Record<string, unknown>>)[1]?.amount).toBe(-40600);
    expect((row?.raw_payload as Record<string, unknown>)?.account_hint).toBe("6745");
    expect((row?.raw_payload as Record<string, unknown>)?.all_details_captured).toBe(true);
  });

  it("falls back to a single line item when alfa receipt is missing", () => {
    const row = __test__.mapOperationRecordToRow(
      {
        operation: SAMPLE_INCOME_OPERATION,
        operationDetail: {
          id: SAMPLE_INCOME_OPERATION.id,
          title: SAMPLE_INCOME_OPERATION.title,
          fields: [],
        },
        receipt: null,
      },
      { extractionMethod: "api" },
    );

    expect(row).not.toBeNull();
    expect(row?.amount).toBe(3500000);
    expect(row?.transaction_type).toBe("income");
    expect(row?.line_items).toHaveLength(1);
    expect((row?.line_items as Array<Record<string, unknown>>)[0]).toMatchObject({
      title: "Максим П.",
      amount: 3500000,
    });
    expect(row?.receipt_enrichment_status).toBe("not_requested");
  });
});

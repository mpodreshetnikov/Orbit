import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyImportSessionStatus } from "@/types";
import MoneyImportPage from "./page";

const hookMocks = vi.hoisted(() => ({
  fetchEdgeFunctionWithTelemetry: vi.fn(),
}));

const i18nMocks = vi.hoisted(() => ({
  // The key, plus any values, so "Line items (1)" is distinguishable from "Line items (2)".
  t: (key: string, values?: Record<string, string | number>): string =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

let selectedPersonIdState: string | null = "person-1";
let connectorsState: Array<{
  sourceId: string;
  displayName: string;
  kind: "file" | "extension";
  fileAccept?: Record<string, string[]>;
  websiteUrl?: string;
  parse?: (file: File) => Promise<{
    transactions: Array<Record<string, unknown>>;
    errors?: string[];
  }>;
}> = [];

const fetchMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => i18nMocks.t,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

// The grants section owns its own data fetching; this page's tests are about the import
// flow, so it is stubbed rather than given a query client.
vi.mock("@/hooks/use-money-import-grants", () => ({
  useMoneyImportGrants: () => ({ data: [], isLoading: false }),
  useCreateMoneyImportGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeMoneyImportGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const recentImportsState: { rows: Array<Record<string, unknown>> } = { rows: [] };

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: recentImportsState.rows, error: null }),
      };
      return query;
    },
  }),
}));

vi.mock("@/lib/import/connector-types", () => ({
  getConnectors: () => connectorsState,
  registerConnector: vi.fn(),
}));

vi.mock("@/lib/observability/edge-function-fetch", () => ({
  fetchEdgeFunctionWithTelemetry: (
    ...args: Parameters<(typeof hookMocks)["fetchEdgeFunctionWithTelemetry"]>
  ) => hookMocks.fetchEdgeFunctionWithTelemetry(...args),
}));

vi.mock("react-dropzone", () => ({
  useDropzone: ({ onDropAccepted }: { onDropAccepted: (files: File[]) => void }) => ({
    getRootProps: () => ({}),
    getInputProps: () => ({
      type: "file",
      "aria-label": "dropzone-input",
      onChange: (event: Event) => {
        const files = Array.from(
          ((event.target as HTMLInputElement).files ?? []) as unknown as File[],
        );
        if (files.length > 0) onDropAccepted(files);
      },
    }),
    isDragActive: false,
  }),
}));

function makeFileConnector(
  sourceId: string,
  parseImpl: (
    file: File,
  ) => Promise<{ transactions: Array<Record<string, unknown>>; errors?: string[] }>,
) {
  return {
    sourceId,
    displayName: "CSV import",
    kind: "file" as const,
    fileAccept: { "text/csv": [".csv"] },
    parse: parseImpl,
  };
}

function makeParsedTransaction(overrides: Record<string, unknown> = {}) {
  return {
    source: "csv-src",
    account_hint: "card ****1234",
    card_id: null,
    external_id: "ext-1",
    posted_at: "2026-02-20T12:00:00.000Z",
    amount: -1200,
    currency: "RUB",
    transaction_type: "expense",
    status: "posted",
    merchant_name: "Shop",
    mcc: null,
    comment: "comment",
    is_transfer: false,
    transfer_group_id: null,
    raw_payload: { account_hint: "card ****1234" },
    dedupe_hash: "hash-1",
    line_items: [],
    ...overrides,
  };
}

describe("MoneyImportPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    connectorsState = [];
    recentImportsState.rows = [];
    window.localStorage.clear();

    fetchMock.mockReset();
    getSessionMock.mockReset();
    hookMocks.fetchEdgeFunctionWithTelemetry.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "access-token" } },
    });
    hookMocks.fetchEdgeFunctionWithTelemetry.mockImplementation(
      async (url: string, init?: RequestInit) => fetchMock(url, init),
    );
    (globalThis.fetch as unknown) = fetchMock;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  });

  it("renders person selection prompt when no person is selected", () => {
    selectedPersonIdState = null;
    render(<MoneyImportPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("shows a history entry point in the page header", () => {
    render(<MoneyImportPage />);

    expect(screen.getByRole("link", { name: "money.importViewHistory" })).toHaveAttribute(
      "href",
      "/money/import/history",
    );
  });

  it("offers the personal account first, recommended, and the statement file after it", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => ({ transactions: [] })),
      { sourceId: "tbank_web", displayName: "TBank extension", kind: "extension" },
      { sourceId: "alfa_web", displayName: "Alfa Bank Web", kind: "extension" },
    ];

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    expect(screen.getByTestId("import-bank-other")).toBeDisabled();
    expect(screen.getByTestId("import-bank-other")).toHaveTextContent("money.importBankSoon");
    await user.click(screen.getByTestId("import-bank-tbank"));

    const methods = screen.getAllByTestId(/^import-method-/);
    expect(methods.map((one) => one.dataset.testid)).toEqual([
      "import-method-extension",
      "import-method-file",
    ]);
    expect(methods[0]).toHaveAttribute("aria-pressed", "true");
    expect(methods[0]).toHaveTextContent("money.importRecommended");
    expect(methods[1]).not.toHaveTextContent("money.importRecommended");
    expect(screen.getByTestId("import-auto-panel")).toHaveTextContent(
      "money.importGrantsCollapsed",
    );
  });

  it("says when the last import was, and when each bank was last imported", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => ({ transactions: [] })),
      { sourceId: "alfa_web", displayName: "Alfa Bank Web", kind: "extension" },
    ];
    recentImportsState.rows = [
      { source: "tbank_web", created_at: "2026-10-24T11:05:00Z", inserted_count: 128 },
      { source: "tbank", created_at: "2026-10-01T09:00:00Z", inserted_count: 4 },
    ];

    render(<MoneyImportPage />);

    expect(await screen.findByTestId("import-last")).toHaveTextContent(
      /money\.importLastImport .*money\.importBankTbank 128/,
    );
    expect(screen.getByTestId("import-bank-tbank")).toHaveTextContent("money.importBankLast");
    expect(screen.getByTestId("import-bank-alfa")).toHaveTextContent("money.importBankNever");
  });

  it("greys out on a phone what needs the extension, and puts the file first", async () => {
    const userAgent = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    connectorsState = [
      makeFileConnector("tbank", async () => ({ transactions: [] })),
      { sourceId: "tbank_web", displayName: "TBank extension", kind: "extension" },
      { sourceId: "alfa_web", displayName: "Alfa Bank Web", kind: "extension" },
    ];

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByTestId("import-bank-alfa")).toBeDisabled());
      expect(screen.getByTestId("import-bank-alfa")).toHaveTextContent(
        "money.importBankDesktopOnly",
      );
      await user.click(screen.getByTestId("import-bank-tbank"));
      expect(screen.getByTestId("import-method-file")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("import-method-extension")).toBeDisabled();
      expect(screen.getByLabelText("dropzone-input")).toBeInTheDocument();
      expect(screen.getByTestId("import-auto-panel")).toHaveTextContent(
        "money.importAutoDesktopOnly",
      );
    } finally {
      userAgent.mockRestore();
    }
  });

  it("imports a statement as soon as it is read, naming no account, and opens its page", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => ({
        transactions: [makeParsedTransaction()],
      })),
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ batch_id: "batch-1" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("dropzone-input"), { target: { files: [file] } });

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-1");
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      action?: string;
      source?: string;
      import_type?: string;
      file_path?: string;
      rows?: Array<Record<string, unknown>>;
    };
    expect(payload).toMatchObject({
      action: "preview_rows",
      source: "tbank",
      import_type: "file",
      file_path: "bank.csv",
    });
    expect(payload.rows?.[0]).not.toHaveProperty("account_id");
    expect(payload.rows?.[0]).toMatchObject({ account_hint: "1234" });
  });

  it("sends an account's own operation without a card, for the server to place", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => ({
        transactions: [
          makeParsedTransaction({
            source: "tbank_web",
            account_hint: null,
            transaction_type: "income",
            raw_payload: {
              connector_source: "tbank_web",
              operation: {
                description: "Проценты на остаток",
                subgroup: { name: "Бонусы" },
                cardNumber: "220070******7770",
              },
            },
          }),
        ],
      })),
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ batch_id: "batch-account-native" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("dropzone-input"), { target: { files: [file] } });

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-account-native");
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      rows?: Array<{
        account_hint?: string | null;
        raw_payload?: { account_hint?: string | null; connector_source?: string | null };
      }>;
    };
    expect(payload.rows?.[0]?.account_hint).toBeNull();
    expect(payload.rows?.[0]?.raw_payload).toMatchObject({
      account_hint: null,
      connector_source: "tbank_web",
    });
  });

  it("stays on the page to say rows of the file were not read, with a way to the import", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => ({
        transactions: [makeParsedTransaction()],
        errors: ["Row 3: invalid date"],
      })),
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ batch_id: "batch-partial" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("dropzone-input"), { target: { files: [file] } });

    expect(await screen.findByText(/money.importFileSkipped/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "money.importOpenReport" })).toHaveAttribute(
      "href",
      "/money/import/reports/batch-partial",
    );
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the file has no operations", async () => {
    connectorsState = [makeFileConnector("tbank", async () => ({ transactions: [] }))];

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));
    const file = new File([""], "empty.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("dropzone-input"), { target: { files: [file] } });

    expect(await screen.findByText("money.importFileEmpty")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the extension again when another bank is picked", async () => {
    connectorsState = [
      { sourceId: "tbank_web", displayName: "TBank extension", kind: "extension" },
      { sourceId: "alfa_web", displayName: "Alfa Bank Web", kind: "extension" },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        last_imported_at: null,
        requires_history_prompt: false,
        stale_threshold_days: 365,
        recommended_mode: "auto",
        window_from: "2026-02-20T12:00:00.000Z",
        window_to: "2026-03-08T00:00:00.000Z",
      }),
    } as Response);
    const pings: string[] = [];
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type !== "MONEY_IMPORT_PING") return;
      pings.push(payload.type);
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
        }),
      );
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();

      await user.click(screen.getByTestId("import-bank-tbank"));
      expect(await screen.findByText("money.importExtensionActive")).toBeInTheDocument();
      const afterFirst = pings.length;

      await user.click(screen.getByTestId("import-bank-alfa"));
      await waitFor(() => expect(pings.length).toBeGreaterThan(afterFirst));
      expect(await screen.findByText("money.importExtensionActive")).toBeInTheDocument();
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("asks the extension again when the page gets focus back, so an update shows its version", async () => {
    connectorsState = [
      { sourceId: "tbank_web", displayName: "TBank extension", kind: "extension" },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        last_imported_at: null,
        requires_history_prompt: false,
        stale_threshold_days: 365,
        recommended_mode: "auto",
        window_from: "2026-02-20T12:00:00.000Z",
        window_to: "2026-03-08T00:00:00.000Z",
      }),
    } as Response);
    let version = "0.1.31";
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type !== "MONEY_IMPORT_PING") return;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "orbit-extension",
            type: "MONEY_IMPORT_PONG",
            extension_version: version,
          },
        }),
      );
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("import-bank-tbank"));
      expect(await screen.findByText("money.importExtensionConnected 0.1.31")).toBeInTheDocument();

      version = "0.1.33";
      window.dispatchEvent(new Event("focus"));
      expect(await screen.findByText("money.importExtensionConnected 0.1.33")).toBeInTheDocument();
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("starts extension import flow and posts the created session to the extension bridge", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
        websiteUrl: "https://example-bank.test",
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          last_imported_at: "2026-02-20T12:00:00.000Z",
          requires_history_prompt: false,
          stale_threshold_days: 365,
          recommended_mode: "auto",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session-1",
          session_token: "token-1",
          batch_id: "batch-1",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-01T00:00:00.000Z",
          last_imported_at: "2026-02-20T12:00:00.000Z",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response);

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
      if (payload.type === "MONEY_IMPORT_START_SESSION") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_SESSION_ACK" },
          }),
        );
      }
    });

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));
    expect(await screen.findByText("money.importExtensionActive")).toBeInTheDocument();
    expect(await screen.findByText("money.importStepPeriod")).toBeInTheDocument();
    const startImportButton = await screen.findByRole("button", {
      name: "money.importStartImport",
    });
    await waitFor(() => {
      expect(startImportButton).toBeEnabled();
    });
    await user.click(startImportButton);

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://example-bank.test",
        "_blank",
        "noopener,noreferrer",
      );
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "orbit-webapp",
          type: "MONEY_IMPORT_START_SESSION",
          session: expect.objectContaining({
            app_origin: window.location.origin,
            default_account_id: null,
            show_source_page_widget: true,
          }),
        }),
        "*",
      );
      // The import's own page follows it from here.
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-1");
    });

    postMessageSpy.mockRestore();
    openSpy.mockRestore();
  });

  it("uses recent import context to create extension session with automatic range", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
        websiteUrl: "https://example-bank.test",
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          last_imported_at: "2026-02-20T12:00:00.000Z",
          requires_history_prompt: false,
          stale_threshold_days: 365,
          recommended_mode: "auto",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session-1",
          session_token: "token-1",
          batch_id: "batch-1",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-08T01:00:00.000Z",
          last_imported_at: "2026-02-20T12:00:00.000Z",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response);

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
      if (payload.type === "MONEY_IMPORT_START_SESSION") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_SESSION_ACK" },
          }),
        );
      }
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();

      await user.click(screen.getByTestId("import-bank-tbank"));
      expect(
        await screen.findByRole("button", { name: "money.importStrategyFull" }),
      ).toHaveAttribute("data-state", "on");
      await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

      await waitFor(() => {
        const contextCall = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
        const createSessionCall = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
        expect(contextCall).toContain('"action":"get_import_context"');
        expect(createSessionCall).toContain('"action":"create_session"');
        expect(createSessionCall).toContain('"window_from":"2026-02-20T12:00:00.000Z"');
        // The page's load time is not the end of the run: it reads up to when the bank is read.
        expect(createSessionCall).toContain('"window_to":null');
        expect(createSessionCall).toContain('"selection_mode":"auto"');
        expect(createSessionCall).toContain('"parse_strategy":"full"');
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("passes fast parse strategy through session creation and extension handoff", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          last_imported_at: "2026-02-20T12:00:00.000Z",
          requires_history_prompt: false,
          stale_threshold_days: 365,
          recommended_mode: "auto",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session-fast",
          session_token: "token-fast",
          batch_id: "batch-fast",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-08T01:00:00.000Z",
          last_imported_at: "2026-02-20T12:00:00.000Z",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
          parse_strategy: "fast",
        }),
      } as Response);

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string; session?: Record<string, unknown> };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
      if (payload.type === "MONEY_IMPORT_START_SESSION") {
        expect(payload.session?.parse_strategy).toBe("fast");
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_SESSION_ACK" },
          }),
        );
      }
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();

      await user.click(screen.getByTestId("import-bank-tbank"));
      await user.click(await screen.findByRole("button", { name: "money.importStrategyFast" }));
      await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

      await waitFor(() => {
        const createSessionCall = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
        expect(createSessionCall).toContain('"parse_strategy":"fast"');
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("defaults stale extension import context to one year preset before session creation", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          last_imported_at: "2024-01-15T09:00:00.000Z",
          requires_history_prompt: true,
          stale_threshold_days: 365,
          recommended_mode: "preset",
          window_from: "2025-03-08T00:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session-2",
          session_token: "token-2",
          batch_id: "batch-2",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-08T01:00:00.000Z",
          last_imported_at: "2024-01-15T09:00:00.000Z",
          window_from: "2025-03-08T00:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response);

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
      if (payload.type === "MONEY_IMPORT_START_SESSION") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_SESSION_ACK" },
          }),
        );
      }
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();

      await user.click(screen.getByTestId("import-bank-tbank"));
      expect(await screen.findByText("money.importStepPeriod")).toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

      await waitFor(() => {
        const createSessionCall = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
        expect(createSessionCall).toContain('"window_from":"2025-03-08T00:00:00.000Z"');
        expect(createSessionCall).toContain('"window_to":null');
        expect(createSessionCall).toContain('"selection_mode":"preset"');
        expect(createSessionCall).toContain('"preset_key":"1y"');
        expect(createSessionCall).toContain('"prompted_for_history":true');
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("allows overriding extension import context with a custom date range", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          last_imported_at: null,
          requires_history_prompt: true,
          stale_threshold_days: 365,
          recommended_mode: "preset",
          window_from: "2025-03-08T00:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session-3",
          session_token: "token-3",
          batch_id: "batch-3",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-08T01:00:00.000Z",
          last_imported_at: null,
          window_from: "2026-02-01T10:00:00.000Z",
          window_to: "2026-02-15T21:30:00.000Z",
        }),
      } as Response);

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
      if (payload.type === "MONEY_IMPORT_START_SESSION") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_SESSION_ACK" },
          }),
        );
      }
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();

      await user.click(screen.getByTestId("import-bank-tbank"));
      await user.click(await screen.findByRole("button", { name: "money.importRangeCustom" }));

      // datetime-local inputs are local time. The page serialises them with
      // `new Date(value).toISOString()`, so the expected UTC below is derived
      // the same way rather than hardcoded — a fixed "Z" value silently pinned
      // this spec to a UTC+7 machine and failed everywhere else, CI included.
      const customFromLocal = "2026-02-01T10:00";
      const customToLocal = "2026-02-15T21:30";

      await user.clear(screen.getByLabelText("money.importRangeFrom"));
      await user.type(screen.getByLabelText("money.importRangeFrom"), customFromLocal);
      await user.clear(screen.getByLabelText("money.importRangeTo"));
      await user.type(screen.getByLabelText("money.importRangeTo"), customToLocal);

      const startImportButton = await screen.findByRole("button", {
        name: "money.importStartImport",
      });
      await waitFor(() => {
        expect(startImportButton).toBeEnabled();
      });
      await user.click(startImportButton);

      await waitFor(() => {
        const createSessionCall = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
        expect(createSessionCall).toContain('"selection_mode":"custom"');
        expect(createSessionCall).toContain(
          `"window_from":"${new Date(customFromLocal).toISOString()}"`,
        );
        expect(createSessionCall).toContain(
          `"window_to":"${new Date(customToLocal).toISOString()}"`,
        );
        expect(createSessionCall).toContain('"prompted_for_history":true');
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("shows parse error when connector parse throws", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => {
        throw new Error("bad file");
      }),
    ];

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));

    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["broken"], "broken.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("money.importParseError")).toBeInTheDocument();
  });

  it("keeps the person on the page and shows why the upload failed", async () => {
    connectorsState = [
      makeFileConnector("tbank", async () => ({
        transactions: [makeParsedTransaction()],
      })),
    ];
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "apply failed" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("import-bank-tbank"));
    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("apply failed")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalledWith("/money/import/reports/batch-1");
  });

  it("asks to reload the tabs, and opens no extension page, when the session handoff gets no ack", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          last_imported_at: "2026-02-20T12:00:00.000Z",
          requires_history_prompt: false,
          stale_threshold_days: 365,
          recommended_mode: "auto",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session-2",
          session_token: "token-2",
          batch_id: "batch-2",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-01T00:00:00.000Z",
          last_imported_at: "2026-02-20T12:00:00.000Z",
          window_from: "2026-02-20T12:00:00.000Z",
          window_to: "2026-03-08T00:00:00.000Z",
        }),
      } as Response);

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
    });

    // The page waits fifteen seconds for the ack; the clock is moved past it rather than waited out.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByTestId("import-bank-tbank"));
      const startImportButton = await screen.findByRole("button", {
        name: "money.importStartImport",
      });
      await waitFor(() => {
        expect(startImportButton).toBeEnabled();
      });
      await user.click(startImportButton);
      await waitFor(
        () => {
          expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: "MONEY_IMPORT_START_SESSION" }),
            "*",
          );
        },
        { timeout: 5000 },
      );
      await act(async () => {
        vi.advanceTimersByTime(16_000);
      });

      expect(
        await screen.findByText("money.importExtensionHandoffFailed", {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      // The session token never goes into a URL: nothing but the bank site may be opened.
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      postMessageSpy.mockRestore();
      openSpy.mockRestore();
    }
  }, 15_000);

  it("creates no session and opens no tab when the extension stops answering before the start", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
        websiteUrl: "https://example-bank.test",
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        last_imported_at: "2026-02-20T12:00:00.000Z",
        requires_history_prompt: false,
        stale_threshold_days: 365,
        recommended_mode: "auto",
        window_from: "2026-02-20T12:00:00.000Z",
        window_to: "2026-03-08T00:00:00.000Z",
      }),
    } as Response);

    // Answers while the page loads, then goes quiet -- an extension reloaded under the open tab.
    let extensionAnswers = true;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING" && extensionAnswers) {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("import-bank-tbank"));
      const startImportButton = await screen.findByRole("button", {
        name: "money.importStartImport",
      });
      await waitFor(() => {
        expect(startImportButton).toBeEnabled();
      });
      extensionAnswers = false;
      await user.click(startImportButton);

      expect(
        await screen.findByText("money.importExtensionNotAnswering", {}, { timeout: 8000 }),
      ).toBeInTheDocument();
      expect(screen.getByText("money.importExtensionInactive")).toBeInTheDocument();
      expect(openSpy).not.toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.some(([, init]) =>
          String((init as RequestInit | undefined)?.body ?? "").includes("create_session"),
        ),
      ).toBe(false);
      expect(postMessageSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "MONEY_IMPORT_START_SESSION" }),
        "*",
      );
    } finally {
      postMessageSpy.mockRestore();
      openSpy.mockRestore();
    }
  }, 15_000);

  it("offers a reload, and creates no session, when the extension was updated under the open tab", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
        websiteUrl: "https://example-bank.test",
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        last_imported_at: "2026-02-20T12:00:00.000Z",
        requires_history_prompt: false,
        stale_threshold_days: 365,
        recommended_mode: "auto",
        window_from: "2026-02-20T12:00:00.000Z",
        window_to: "2026-03-08T00:00:00.000Z",
      }),
    } as Response);

    // Answers while the page loads; after an update the old content script reports itself stale.
    let extensionAnswers = true;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: extensionAnswers
              ? { source: "orbit-extension", type: "MONEY_IMPORT_PONG" }
              : {
                  source: "orbit-extension",
                  type: "MONEY_IMPORT_BRIDGE_STALE",
                  reason: "Extension context invalidated.",
                },
          }),
        );
      }
    });

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("import-bank-tbank"));
      const startImportButton = await screen.findByRole("button", {
        name: "money.importStartImport",
      });
      await waitFor(() => {
        expect(startImportButton).toBeEnabled();
      });
      extensionAnswers = false;
      await user.click(startImportButton);

      expect(
        await screen.findByText("money.importExtensionStaleReload", {}, { timeout: 8000 }),
      ).toBeInTheDocument();
      expect(screen.getByText("money.importExtensionInactive")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "money.importAttentionReload" }),
      ).toBeInTheDocument();
      expect(openSpy).not.toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.some(([, init]) =>
          String((init as RequestInit | undefined)?.body ?? "").includes("create_session"),
        ),
      ).toBe(false);
      expect(postMessageSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "MONEY_IMPORT_START_SESSION" }),
        "*",
      );
    } finally {
      postMessageSpy.mockRestore();
      openSpy.mockRestore();
    }
  }, 15_000);

  it("covers money-import helper functions and progress computation branches", async () => {
    const { callMoneyImportAction, computeProgressPercent, getAccessToken, getFunctionUrl } =
      await import("./money-import-client");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    expect(getFunctionUrl("money-import")).toBe("https://supabase.test/functions/v1/money-import");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    expect(() => getFunctionUrl("money-import")).toThrow("Supabase URL is not configured");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";

    getSessionMock.mockResolvedValueOnce({
      data: { session: { access_token: "token-xyz" } },
    });
    await expect(getAccessToken()).resolves.toBe("token-xyz");

    getSessionMock.mockResolvedValueOnce({
      data: { session: null },
    });
    await expect(getAccessToken()).rejects.toThrow("Not authenticated");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: 1 }),
    } as Response);
    await expect(callMoneyImportAction({ action: "x" }, "token")).resolves.toEqual({
      ok: true,
      value: 1,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "boom" }),
    } as unknown as Response);
    await expect(callMoneyImportAction({ action: "x" }, "token")).rejects.toThrow("boom");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(callMoneyImportAction({ action: "x" }, "token")).rejects.toThrow(
      "Money import request failed",
    );

    expect(computeProgressPercent(null)).toBe(0);
    expect(
      computeProgressPercent({
        batch: { progress_percent: 140 },
      } as MoneyImportSessionStatus),
    ).toBe(100);
    expect(
      computeProgressPercent({
        batch: { progress_percent: -5 },
      } as MoneyImportSessionStatus),
    ).toBe(0);
    expect(
      computeProgressPercent({
        batch: {
          progress_percent: null,
          window_from: null,
          window_to: null,
          parsed_through_at: null,
        },
      } as MoneyImportSessionStatus),
    ).toBe(0);
    expect(
      computeProgressPercent({
        batch: {
          progress_percent: null,
          window_from: "2026-01-01T00:00:00.000Z",
          window_to: "2026-01-01T00:00:00.000Z",
          parsed_through_at: "2026-01-01T00:00:00.000Z",
        },
      } as MoneyImportSessionStatus),
    ).toBe(100);
    expect(
      computeProgressPercent({
        batch: {
          progress_percent: null,
          window_from: "2026-01-01T00:00:00.000Z",
          window_to: "2026-01-03T00:00:00.000Z",
          parsed_through_at: "2026-01-02T00:00:00.000Z",
        },
      } as MoneyImportSessionStatus),
    ).toBe(50);
  });

  it("shows only the status reply that answers its own request", async () => {
    // A reply to some earlier request arrives first, carrying the state from before the key
    // was delivered; the reply to this request follows. Only the second may be shown.
    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string; request_id?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "orbit-extension", type: "MONEY_IMPORT_PONG" },
          }),
        );
      }
      if (payload.type === "MONEY_IMPORT_GET_AUTO_STATUS") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "orbit-extension",
              type: "MONEY_IMPORT_AUTO_STATUS",
              request_id: "someone-else",
              ok: true,
              grant: null,
              sources: [],
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "orbit-extension",
              type: "MONEY_IMPORT_AUTO_STATUS",
              request_id: payload.request_id,
              ok: true,
              grant: {
                person_id: "person-1",
                allowed_sources: ["tbank_web"],
                received_at: "2026-09-03T05:00:00.000Z",
              },
              sources: [],
            },
          }),
        );
      }
    });

    render(<MoneyImportPage />);

    expect(await screen.findByText(/^money\.importAutoStatusGrantHeld /)).toBeInTheDocument();
    expect(screen.queryByText("money.importAutoStatusNoGrant")).not.toBeInTheDocument();
    postMessageSpy.mockRestore();
  });
});
fetchMock.mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    last_imported_at: null,
    requires_history_prompt: true,
    stale_threshold_days: 365,
    recommended_mode: "preset",
    window_from: "2025-03-08T00:00:00.000Z",
    window_to: "2026-03-08T00:00:00.000Z",
  }),
} as Response);

fetchMock.mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    last_imported_at: null,
    requires_history_prompt: true,
    stale_threshold_days: 365,
    recommended_mode: "preset",
    window_from: "2025-03-08T00:00:00.000Z",
    window_to: "2026-03-08T00:00:00.000Z",
  }),
} as Response);

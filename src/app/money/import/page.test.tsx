import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyImportSessionStatus } from "@/types";
import MoneyImportPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyAccounts: vi.fn(),
  useCreateMoneyAccount: vi.fn(),
  useMoneyCardsByAccountIds: vi.fn(),
  useCreateMoneyCard: vi.fn(),
  fetchEdgeFunctionWithTelemetry: vi.fn(),
}));

const i18nMocks = vi.hoisted(() => ({
  t: (key: string): string => key,
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

const createAccountMutateAsync = vi.fn();
const createCardMutateAsync = vi.fn();
const fetchMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => i18nMocks.t,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useCreateMoneyAccount: (...args: unknown[]) => hookMocks.useCreateMoneyAccount(...args),
  useMoneyCardsByAccountIds: (...args: unknown[]) => hookMocks.useMoneyCardsByAccountIds(...args),
  useCreateMoneyCard: (...args: unknown[]) => hookMocks.useCreateMoneyCard(...args),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
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

function makeAccount(source: string, id = "acc-1") {
  return {
    id,
    owner_person_id: "person-1",
    source,
    account_kind: "debit",
    account_label: "Main",
    currency: "RUB",
    external_account_id: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("MoneyImportPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    connectorsState = [];
    window.localStorage.clear();

    createAccountMutateAsync.mockReset();
    createCardMutateAsync.mockReset();
    fetchMock.mockReset();
    getSessionMock.mockReset();
    hookMocks.fetchEdgeFunctionWithTelemetry.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    createAccountMutateAsync.mockResolvedValue(undefined);
    createCardMutateAsync.mockResolvedValue({ id: "card-new" });
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "access-token" } },
    });
    hookMocks.fetchEdgeFunctionWithTelemetry.mockImplementation(
      async (url: string, init?: RequestInit) => fetchMock(url, init),
    );
    (globalThis.fetch as unknown) = fetchMock;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";

    hookMocks.useMoneyAccounts.mockReturnValue({ data: [], isLoading: false });
    hookMocks.useMoneyCardsByAccountIds.mockReturnValue({ data: [] });
    hookMocks.useCreateMoneyAccount.mockReturnValue({
      mutateAsync: createAccountMutateAsync,
      isPending: false,
    });
    hookMocks.useCreateMoneyCard.mockReturnValue({
      mutateAsync: createCardMutateAsync,
      isPending: false,
    });
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

  it("parses file imports and can create a missing source account", async () => {
    connectorsState = [
      makeFileConnector("csv-src", async () => ({
        transactions: [makeParsedTransaction()],
      })),
    ];

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /CSV import/ }));

    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("money.importNoSourceAccounts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "money.importCreateSourceAccount" }));

    await waitFor(() => {
      expect(createAccountMutateAsync).toHaveBeenCalledWith({
        owner_person_id: "person-1",
        source: "csv-src",
        account_kind: "debit",
        account_label: "CSV import",
        currency: "RUB",
      });
    });
  });

  it("previews parsed rows and navigates to report without creating cards", async () => {
    connectorsState = [
      makeFileConnector("csv-src", async () => ({
        transactions: [makeParsedTransaction()],
      })),
    ];
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [
        {
          id: "acc-1",
          owner_person_id: "person-1",
          source: "csv-src",
          account_kind: "debit",
          account_label: "Main",
          currency: "RUB",
          external_account_id: null,
          is_active: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ batch_id: "batch-1" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /CSV import/ }));
    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await user.click(await screen.findByRole("button", { name: "money.importConfirm" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://supabase.test/functions/v1/money-import",
        expect.objectContaining({
          body: expect.stringContaining('"action":"preview_rows"'),
        }),
      );
      expect(createCardMutateAsync).not.toHaveBeenCalled();
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-1");
    });
  });

  it("derives tbank card hint from raw payload cardNumber when top-level hint is missing", async () => {
    connectorsState = [
      makeFileConnector("tbank_web", async () => ({
        transactions: [
          makeParsedTransaction({
            source: "tbank_web",
            account_hint: null,
            raw_payload: {
              connector_source: "tbank_web",
              operation: {
                cardNumber: "220070******6986",
              },
            },
          }),
        ],
      })),
    ];
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-1"), makeAccount("tbank", "acc-2")],
      isLoading: false,
    });
    hookMocks.useMoneyCardsByAccountIds.mockReturnValue({
      data: [{ id: "card-6986", account_id: "acc-2", last4: "6986", card_label: "TBank" }],
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ batch_id: "batch-raw-card" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /CSV import/ }));
    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const confirmButton = await screen.findByRole("button", { name: "money.importConfirm" });
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://supabase.test/functions/v1/money-import",
        expect.objectContaining({
          body: expect.stringContaining('"account_hint":"6986"'),
        }),
      );
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-raw-card");
    });
  });

  it("suppresses account-native tbank hints and falls back to default account", async () => {
    connectorsState = [
      makeFileConnector("tbank_web", async () => ({
        transactions: [
          makeParsedTransaction({
            source: "tbank_web",
            account_hint: null,
            transaction_type: "income",
            raw_payload: {
              connector_source: "tbank_web",
              operation: {
                description: "Проценты на остаток",
                merchantKey: "Проценты на остаток",
                subgroup: { name: "Бонусы" },
                spendingCategory: { name: "Проценты" },
                categoryInfo: {
                  bankCategory: { name: "Проценты" },
                },
                cardNumber: "220070******7770",
              },
            },
          }),
        ],
      })),
    ];
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-1"), makeAccount("tbank", "acc-2")],
      isLoading: false,
    });
    hookMocks.useMoneyCardsByAccountIds.mockReturnValue({
      data: [],
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ batch_id: "batch-account-native" }),
    } as Response);

    window.localStorage.setItem("money-import-default-account:person-1:tbank_web", "acc-2");

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /CSV import/ }));
    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.queryByText("*7770")).not.toBeInTheDocument();
    });

    await user.click(await screen.findByRole("button", { name: "money.importConfirm" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://supabase.test/functions/v1/money-import",
        expect.objectContaining({
          body: expect.stringContaining('"account_id":"acc-2"'),
        }),
      );
      const request = fetchMock.mock.calls[0]?.[1];
      const payload = JSON.parse(String(request?.body ?? "{}")) as {
        rows?: Array<{
          account_id?: string | null;
          account_hint?: string | null;
          raw_payload?: { account_hint?: string | null; connector_source?: string | null };
        }>;
      };
      const row = payload.rows?.[0];
      expect(row?.account_id).toBe("acc-2");
      expect(row?.account_hint).toBeNull();
      expect(row?.raw_payload?.connector_source).toBe("tbank_web");
      expect(row?.raw_payload?.account_hint).toBeNull();
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-account-native");
    });
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
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-tbank")],
      isLoading: false,
    });

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

    await user.click(screen.getByRole("button", { name: /TBank extension/ }));
    expect(await screen.findByText("Import history range")).toBeInTheDocument();
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
            default_account_id: "acc-tbank",
            show_source_page_widget: true,
          }),
        }),
        "*",
      );
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
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-tbank")],
      isLoading: false,
    });
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

      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      expect(await screen.findByRole("button", { name: "Full" })).toHaveAttribute(
        "data-state",
        "on",
      );
      await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

      await waitFor(() => {
        const contextCall = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
        const createSessionCall = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
        expect(contextCall).toContain('"action":"get_import_context"');
        expect(createSessionCall).toContain('"action":"create_session"');
        expect(createSessionCall).toContain('"window_from":"2026-02-20T12:00:00.000Z"');
        expect(createSessionCall).toContain('"window_to":"2026-03-08T00:00:00.000Z"');
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
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-tbank")],
      isLoading: false,
    });
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

      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      await user.click(await screen.findByRole("button", { name: "Fast" }));
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
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-tbank")],
      isLoading: false,
    });
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

      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      expect(await screen.findByText("Import history range")).toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

      await waitFor(() => {
        const createSessionCall = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
        expect(createSessionCall).toContain('"window_from":"2025-03-08T00:00:00.000Z"');
        expect(createSessionCall).toContain('"window_to":"2026-03-08T00:00:00.000Z"');
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
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-tbank")],
      isLoading: false,
    });
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

      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      await user.click(await screen.findByRole("button", { name: "Custom" }));

      await user.clear(screen.getByLabelText("From"));
      await user.type(screen.getByLabelText("From"), "2026-02-01T10:00");
      await user.clear(screen.getByLabelText("To"));
      await user.type(screen.getByLabelText("To"), "2026-02-15T21:30");

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
        expect(createSessionCall).toContain('"window_from":"2026-02-01T03:00:00.000Z"');
        expect(createSessionCall).toContain('"window_to":"2026-02-15T14:30:00.000Z"');
        expect(createSessionCall).toContain('"prompted_for_history":true');
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("creates tbank account source for tbank_web connector account creation", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];

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

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      await user.click(
        await screen.findByRole("button", { name: "money.importCreateSourceAccount" }),
      );

      await waitFor(() => {
        expect(createAccountMutateAsync).toHaveBeenCalledWith({
          owner_person_id: "person-1",
          source: "tbank",
          account_kind: "debit",
          account_label: "TBank extension",
          currency: "RUB",
        });
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("creates alfa account source for alfa_web connector account creation", async () => {
    connectorsState = [
      {
        sourceId: "alfa_web",
        displayName: "Alfa Bank Web",
        kind: "extension",
      },
    ];

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

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Alfa Bank Web/ }));
      await user.click(
        await screen.findByRole("button", { name: "money.importCreateSourceAccount" }),
      );

      await waitFor(() => {
        expect(createAccountMutateAsync).toHaveBeenCalledWith({
          owner_person_id: "person-1",
          source: "alfa",
          account_kind: "debit",
          account_label: "Alfa Bank Web",
          currency: "RUB",
        });
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("hard-blocks extension import start when source account is missing", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];

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

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      const startButton = await screen.findByRole("button", { name: "money.importStartImport" });
      expect(startButton).toBeDisabled();
      expect(await screen.findByText("money.importNoSourceAccounts")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await user.click(startButton);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("requires explicit default account selection for extension flow when multiple accounts exist", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-1"), makeAccount("tbank", "acc-2")],
      isLoading: false,
    });

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

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      const startButton = await screen.findByRole("button", { name: "money.importStartImport" });
      expect(startButton).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("uses remembered extension default account and forwards it in session payload", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
      },
    ];
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-1"), makeAccount("tbank", "acc-2")],
      isLoading: false,
    });
    window.localStorage.setItem("money-import-default-account:person-1:tbank_web", "acc-2");
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
          session_id: "session-remembered",
          session_token: "token-remembered",
          batch_id: "batch-remembered",
          source: "tbank_web",
          payer_person_id: "person-1",
          expires_at: "2026-03-01T00:00:00.000Z",
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
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      const startButton = await screen.findByRole("button", { name: "money.importStartImport" });
      expect(startButton).toBeEnabled();
      await user.click(startButton);

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "MONEY_IMPORT_START_SESSION",
          session: expect.objectContaining({
            default_account_id: "acc-2",
            show_source_page_widget: true,
          }),
        }),
        "*",
      );
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("shows parse error when connector parse throws", async () => {
    connectorsState = [
      makeFileConnector("csv-src", async () => {
        throw new Error("bad file");
      }),
    ];

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /CSV import/ }));

    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["broken"], "broken.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("money.importParseError")).toBeInTheDocument();
  });

  it("keeps user on page and surfaces apply_rows errors", async () => {
    connectorsState = [
      makeFileConnector("csv-src", async () => ({
        transactions: [makeParsedTransaction()],
      })),
    ];
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [
        {
          id: "acc-1",
          owner_person_id: "person-1",
          source: "csv-src",
          account_kind: "debit",
          account_label: "Main",
          currency: "RUB",
          external_account_id: null,
          is_active: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
    });
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "apply failed" }),
    } as Response);

    render(<MoneyImportPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /CSV import/ }));
    const fileInput = screen.getByLabelText("dropzone-input");
    const file = new File(["date,amount"], "bank.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await user.click(await screen.findByRole("button", { name: "money.importConfirm" }));
    expect(await screen.findByText("apply failed")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalledWith("/money/import/reports/batch-1");
  });

  it("shows manual-open hint when extension session ack is not received", async () => {
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
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [makeAccount("tbank", "acc-tbank")],
      isLoading: false,
    });

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

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));
      await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

      expect(
        await screen.findByText(
          /money\.importExtension(OpenPopupManual|SessionCreated)/,
          {},
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
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

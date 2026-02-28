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

describe("MoneyImportPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    connectorsState = [];

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

    expect(await screen.findByText("money.importNoAccounts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "money.importCreateTbankAccount" }));

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

  it("applies parsed rows, creates missing cards, and navigates to report", async () => {
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
      expect(createCardMutateAsync).toHaveBeenCalledWith({
        account_id: "acc-1",
        last4: "1234",
      });
      expect(routerMock.push).toHaveBeenCalledWith("/money/import/reports/batch-1");
    });
  });

  it("starts extension import flow and shows created-session message", async () => {
    connectorsState = [
      {
        sourceId: "tbank_web",
        displayName: "TBank extension",
        kind: "extension",
        websiteUrl: "https://example-bank.test",
      },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "session-1",
        session_token: "token-1",
        batch_id: "batch-1",
        source: "tbank_web",
        payer_person_id: "person-1",
        expires_at: "2026-03-01T00:00:00.000Z",
        last_imported_at: null,
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

    await user.click(screen.getByRole("button", { name: /TBank extension/ }));
    await user.click(await screen.findByRole("button", { name: "money.importStartImport" }));

    expect(await screen.findByText("money.importOpenCurrentReport")).toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledWith(
      "https://example-bank.test",
      "_blank",
      "noopener,noreferrer",
    );

    postMessageSpy.mockRestore();
    openSpy.mockRestore();
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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "session-2",
        session_token: "token-2",
        batch_id: "batch-2",
        source: "tbank_web",
        payer_person_id: "person-1",
        expires_at: "2026-03-01T00:00:00.000Z",
        last_imported_at: null,
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

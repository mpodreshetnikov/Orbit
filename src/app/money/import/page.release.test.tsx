import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useMoneyAccounts: vi.fn(),
  useCreateMoneyAccount: vi.fn(),
  useMoneyCardsByAccountIds: vi.fn(),
  fetchEdgeFunctionWithTelemetry: vi.fn(),
}));

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const getSessionMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: "person-1" }),
}));

vi.mock("@/hooks", () => ({
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useCreateMoneyAccount: (...args: unknown[]) => hookMocks.useCreateMoneyAccount(...args),
  useMoneyCardsByAccountIds: (...args: unknown[]) => hookMocks.useMoneyCardsByAccountIds(...args),
}));

// The grants section fetches its own data; this suite is about extension release UX.
vi.mock("@/hooks/use-money-import-grants", () => ({
  useMoneyImportGrants: () => ({ data: [], isLoading: false }),
  useCreateMoneyImportGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeMoneyImportGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  }),
}));

vi.mock("@/lib/import/connector-types", () => ({
  getConnectors: () => [
    {
      sourceId: "tbank_web",
      displayName: "TBank extension",
      kind: "extension",
      websiteUrl: "https://www.tbank.ru/mybank/",
      release: {
        latestDownloadUrl: "/api/extension-release/latest/download",
      },
    },
  ],
  registerConnector: vi.fn(),
}));

vi.mock("@/lib/observability/edge-function-fetch", () => ({
  fetchEdgeFunctionWithTelemetry: (
    ...args: Parameters<(typeof hookMocks)["fetchEdgeFunctionWithTelemetry"]>
  ) => hookMocks.fetchEdgeFunctionWithTelemetry(...args),
}));

describe("MoneyImportPage release UX", () => {
  const originalAppEnvKind = process.env.NEXT_PUBLIC_APP_ENV_KIND;

  async function importMoneyImportPage() {
    vi.resetModules();
    vi.doMock("./extension-release-client", () => ({
      getAppEnvironmentKind: () => "production",
    }));
    const importedPageModule = await import("./page");
    return importedPageModule.default;
  }

  beforeEach(() => {
    getSessionMock.mockReset();
    fetchMock.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    hookMocks.fetchEdgeFunctionWithTelemetry.mockReset();
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [
        {
          id: "acc-tbank",
          owner_person_id: "person-1",
          source: "tbank",
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
    hookMocks.useMoneyCardsByAccountIds.mockReturnValue({ data: [] });
    hookMocks.useCreateMoneyAccount.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "access-token" } },
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.NEXT_PUBLIC_APP_ENV_KIND = "production";
    window.__ORBIT_APP_ENV_KIND__ = "production";
    hookMocks.fetchEdgeFunctionWithTelemetry.mockImplementation(
      async (url: string, init?: RequestInit) => fetchMock(url, init),
    );
    (globalThis.fetch as unknown) = fetchMock;
  });

  it("shows production download instructions when the extension is not installed", async () => {
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

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const MoneyImportPage = await importMoneyImportPage();

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));

      expect(
        await screen.findByRole("link", { name: "money.importExtensionDownloadLatest" }),
      ).toBeInTheDocument();
      expect(screen.getByText("money.importExtensionInstallProdStep1")).toBeInTheDocument();
      expect(screen.getByText("money.importExtensionInstallProdStep2")).toBeInTheDocument();
      expect(screen.getByText("money.importExtensionInstallProdStep3")).toBeInTheDocument();
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("shows an update prompt when the installed extension is older than the latest release", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: "1.2.4",
          published_at: "2026-03-14T12:00:00.000Z",
          extension_id: "abc123",
          sha256: "deadbeef",
          download_url: "https://downloads.example.test/orbit-extension-1.2.4.zip",
        }),
      } as Response)
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
      } as Response);

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "orbit-extension",
              type: "MONEY_IMPORT_PONG",
              extension_id: "abc123",
              extension_version: "1.2.3",
            },
          }),
        );
      }
    });
    const MoneyImportPage = await importMoneyImportPage();

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));

      expect(await screen.findByText("money.importExtensionUpdateAvailable")).toBeInTheDocument();
      expect(screen.getByText(/money\.importExtensionVersionCurrent/)).toHaveTextContent("1.2.3");
      expect(screen.getByText(/money\.importExtensionVersionLatest/)).toHaveTextContent("1.2.4");
      expect(
        screen.getByRole("link", { name: "money.importExtensionDownloadLatest" }),
      ).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "money.importStartImport" })).toBeEnabled();
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  it("does not show the update prompt when the installed extension matches latest release", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: "1.2.4",
          published_at: "2026-03-14T12:00:00.000Z",
          extension_id: "abc123",
          sha256: "deadbeef",
          download_url: "https://downloads.example.test/orbit-extension-1.2.4.zip",
        }),
      } as Response)
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
      } as Response);

    const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const payload = message as { type?: string };
      if (payload.type === "MONEY_IMPORT_PING") {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "orbit-extension",
              type: "MONEY_IMPORT_PONG",
              extension_id: "abc123",
              extension_version: "1.2.4",
            },
          }),
        );
      }
    });
    const MoneyImportPage = await importMoneyImportPage();

    try {
      render(<MoneyImportPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /TBank extension/ }));

      await waitFor(() => {
        expect(screen.queryByText("money.importExtensionUpdateAvailable")).not.toBeInTheDocument();
      });
    } finally {
      postMessageSpy.mockRestore();
    }
  });

  afterEach(() => {
    if (originalAppEnvKind === undefined) {
      delete process.env.NEXT_PUBLIC_APP_ENV_KIND;
    } else {
      process.env.NEXT_PUBLIC_APP_ENV_KIND = originalAppEnvKind;
    }
    delete window.__ORBIT_APP_ENV_KIND__;
  });
});

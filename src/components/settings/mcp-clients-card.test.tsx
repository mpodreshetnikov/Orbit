import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpClientsCard } from "./mcp-clients-card";

const hookMocks = vi.hoisted(() => ({
  useMcpClients: vi.fn(),
  useRevokeMcpClient: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string, values?: Record<string, string>): string => {
      const base = namespace ? `${namespace}.${key}` : key;
      if (!values) return base;
      return `${base}:${JSON.stringify(values)}`;
    },
}));

vi.mock("@/lib/date-locale", () => ({
  useIntlLocale: () => "en-US",
}));

vi.mock("@/hooks/use-mcp-clients", () => ({
  useMcpClients: (...args: unknown[]) => hookMocks.useMcpClients(...args),
  useRevokeMcpClient: (...args: unknown[]) => hookMocks.useRevokeMcpClient(...args),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div data-testid="alert-dialog" data-open={open ? "yes" : "no"}>
        <button
          type="button"
          data-testid="alert-dialog-dismiss"
          onClick={() => onOpenChange?.(false)}
        >
          dismiss
        </button>
        <button
          type="button"
          data-testid="alert-dialog-keep-open"
          onClick={() => onOpenChange?.(true)}
        >
          keep-open
        </button>
        {children}
      </div>
    ) : (
      <div data-testid="alert-dialog-closed" />
    ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({
    children,
    disabled,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" data-testid="mcp-client-revoke-cancel" disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: (event: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      type="button"
      data-testid="mcp-client-revoke-confirm-action"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));

const clientFixture = {
  grantId: "grant-1",
  clientId: "client-1",
  clientName: "Claude",
  scope: "openid",
  createdAt: "2026-11-19T12:00:00.000Z",
  lastUsedAt: null as string | null,
};

function mockClientsQuery(overrides: Record<string, unknown> = {}) {
  hookMocks.useMcpClients.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    ...overrides,
  });
}

describe("McpClientsCard", () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
    hookMocks.useRevokeMcpClient.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
  });

  it("shows the empty state when no clients are connected", () => {
    mockClientsQuery({ data: [] });
    render(<McpClientsCard />);
    expect(screen.getByTestId("mcp-clients-empty")).toHaveTextContent("settings.mcp.empty");
    expect(screen.getByTestId("alert-dialog-closed")).toBeInTheDocument();
  });

  it("shows loading copy while the query is pending", () => {
    mockClientsQuery({ data: [], isPending: true });
    render(<McpClientsCard />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-clients-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-client-grant-1")).not.toBeInTheDocument();
  });

  it("treats an undefined clients payload as empty once loaded", () => {
    mockClientsQuery({ data: undefined, isPending: false, isError: false });
    render(<McpClientsCard />);
    expect(screen.getByTestId("mcp-clients-empty")).toHaveTextContent("settings.mcp.empty");
    expect(screen.queryAllByTestId(/^mcp-client-revoke-/)).toEqual([]);
    expect(screen.queryByText("settings.mcp.unnamedClient")).not.toBeInTheDocument();
  });

  it("shows a load error and refreshes on demand", () => {
    const refetch = vi.fn();
    mockClientsQuery({
      data: [clientFixture],
      isError: true,
      error: new Error("offline"),
      refetch,
    });
    render(<McpClientsCard />);
    expect(screen.getByText(/settings\.mcp\.loadError/)).toHaveTextContent("offline");
    expect(screen.queryByTestId("mcp-client-grant-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.refresh" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders never-used unnamed clients with connected timestamps", () => {
    mockClientsQuery({
      data: [
        {
          ...clientFixture,
          clientName: "   ",
          lastUsedAt: null,
          createdAt: "2026-11-19T12:00:00.000Z",
        },
      ],
    });
    render(<McpClientsCard />);
    expect(screen.queryByTestId("mcp-clients-empty")).not.toBeInTheDocument();
    expect(screen.getByText("settings.mcp.unnamedClient")).toBeInTheDocument();
    expect(screen.queryByText("   ")).not.toBeInTheDocument();
    expect(screen.getByText(/settings\.mcp\.neverUsed/)).toBeInTheDocument();
    expect(screen.getByText(/settings\.mcp\.connectedAt/)).toHaveTextContent("when");
  });

  it("falls back to unnamed when the client name is null", () => {
    mockClientsQuery({
      data: [{ ...clientFixture, clientName: null }],
    });
    render(<McpClientsCard />);
    expect(screen.getByText("settings.mcp.unnamedClient")).toBeInTheDocument();
  });

  it("renders last-used when present and skips invalid dates", () => {
    mockClientsQuery({
      data: [
        {
          ...clientFixture,
          lastUsedAt: "2026-11-20T08:00:00.000Z",
          createdAt: "not-a-date",
        },
      ],
    });
    render(<McpClientsCard />);
    expect(screen.getByText(/settings\.mcp\.lastUsed/)).toHaveTextContent("when");
    expect(screen.queryByText(/settings\.mcp\.connectedAt/)).not.toBeInTheDocument();
  });

  it("asks for confirmation before revoking and closes the dialog on success", async () => {
    mockClientsQuery({ data: [clientFixture] });
    render(<McpClientsCard />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-clients-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("alert-dialog-closed")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-client-revoke-grant-1"));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("alert-dialog")).toHaveAttribute("data-open", "yes");
    expect(screen.getByRole("heading")).toHaveTextContent("Claude");
    expect(screen.getByTestId("mcp-client-revoke-confirm-action")).toHaveTextContent(
      "settings.mcp.revokeConfirmAction",
    );
    expect(screen.getByTestId("mcp-client-revoke-cancel")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("alert-dialog-keep-open"));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-client-revoke-confirm-action"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("grant-1"));
    await waitFor(() => expect(screen.getByTestId("alert-dialog-closed")).toBeInTheDocument());
    expect(screen.getByTestId("mcp-client-revoke-grant-1")).toHaveTextContent(
      "settings.mcp.revoke",
    );
  });

  it("shows revoking copy while a revoke is in flight and ignores dismiss", async () => {
    let resolveRevoke: (() => void) | undefined;
    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    hookMocks.useRevokeMcpClient.mockReturnValue({
      mutateAsync,
      isPending: true,
    });
    mockClientsQuery({ data: [clientFixture] });

    render(<McpClientsCard />);
    fireEvent.click(screen.getByTestId("mcp-client-revoke-grant-1"));
    fireEvent.click(screen.getByTestId("mcp-client-revoke-confirm-action"));

    await waitFor(() =>
      expect(screen.getByTestId("mcp-client-revoke-confirm-action")).toHaveTextContent(
        "settings.mcp.revoking",
      ),
    );
    expect(screen.getByTestId("mcp-client-revoke-cancel")).toBeDisabled();
    expect(screen.getByTestId("mcp-client-revoke-confirm-action")).toBeDisabled();
    expect(screen.getByTestId("mcp-client-revoke-grant-1")).toHaveTextContent(
      "settings.mcp.revoking",
    );
    fireEvent.click(screen.getByTestId("alert-dialog-dismiss"));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    resolveRevoke?.();
    await waitFor(() => expect(screen.getByTestId("alert-dialog-closed")).toBeInTheDocument());
    expect(screen.getByTestId("mcp-client-revoke-grant-1")).toHaveTextContent(
      "settings.mcp.revoke",
    );
  });

  it("shows a revoke failure instead of failing silently", async () => {
    mutateAsync.mockRejectedValue(new Error("db down"));
    mockClientsQuery({ data: [clientFixture] });

    render(<McpClientsCard />);
    fireEvent.click(screen.getByTestId("mcp-client-revoke-grant-1"));
    fireEvent.click(screen.getByTestId("mcp-client-revoke-confirm-action"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-clients-revoke-error")).toHaveTextContent("db down"),
    );
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-client-revoke-grant-1")).toHaveTextContent(
      "settings.mcp.revoke",
    );
  });

  it("dismisses the confirm dialog without revoking when cancel closes it", () => {
    mockClientsQuery({ data: [clientFixture] });
    render(<McpClientsCard />);
    fireEvent.click(screen.getByTestId("mcp-client-revoke-grant-1"));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("alert-dialog-dismiss"));
    expect(screen.getByTestId("alert-dialog-closed")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

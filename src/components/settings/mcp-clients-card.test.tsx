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
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
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
    hookMocks.useMcpClients.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    render(<McpClientsCard />);
    expect(screen.getByTestId("mcp-clients-empty")).toBeTruthy();
  });

  it("asks for confirmation before revoking", async () => {
    hookMocks.useMcpClients.mockReturnValue({
      data: [
        {
          grantId: "grant-1",
          clientId: "client-1",
          clientName: "Claude",
          scope: "openid",
          createdAt: "2026-11-19T12:00:00.000Z",
          lastUsedAt: null,
        },
      ],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    render(<McpClientsCard />);
    expect(screen.getByText("Claude")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mcp-client-revoke-grant-1"));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("alert-dialog")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mcp-client-revoke-confirm-action"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("grant-1"));
  });

  it("shows a revoke failure instead of failing silently", async () => {
    mutateAsync.mockRejectedValue(new Error("db down"));
    hookMocks.useMcpClients.mockReturnValue({
      data: [
        {
          grantId: "grant-1",
          clientId: "client-1",
          clientName: "Claude",
          scope: "openid",
          createdAt: "2026-11-19T12:00:00.000Z",
          lastUsedAt: null,
        },
      ],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    render(<McpClientsCard />);
    fireEvent.click(screen.getByTestId("mcp-client-revoke-grant-1"));
    fireEvent.click(screen.getByTestId("mcp-client-revoke-confirm-action"));
    await waitFor(() => expect(screen.getByTestId("mcp-clients-revoke-error")).toBeTruthy());
    expect(screen.getByTestId("mcp-clients-revoke-error").textContent).toContain("db down");
  });
});

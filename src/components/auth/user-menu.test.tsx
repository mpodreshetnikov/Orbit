import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockNextIntl,
  mockNextNavigation,
  resetRouterMocks,
  routerMock,
} from "../../../test/utils/web/mocks";
import { clearPersistedStore } from "../../../test/utils/web/store-reset";

function mockDropdownMenu() {
  vi.doMock("@/components/ui/dropdown-menu", () => ({
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <div data-testid="separator" />,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" role="menuitem" onClick={onClick}>
        {children}
      </button>
    ),
  }));
}

function createSupabaseAuthMock(options: {
  user: { id: string; email: string } | null;
  signOut?: () => Promise<void>;
}) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: options.user } });
  const signOut = vi.fn(options.signOut).mockResolvedValue(undefined);
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn().mockReturnValue({
    data: { subscription: { unsubscribe } },
  });

  return {
    auth: { getUser, signOut, onAuthStateChange },
    mocks: { getUser, signOut, unsubscribe, onAuthStateChange },
  };
}

describe("UserMenu", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRouterMocks();
    mockNextIntl();
    mockNextNavigation();
    mockDropdownMenu();
    clearPersistedStore("app.settings");
  });

  it("shows a disabled loading button while user is loading", async () => {
    let resolveUser: ((value: unknown) => void) | null = null;
    const getUser = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUser = resolve;
        }),
    );
    const unsubscribe = vi.fn();
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({
        auth: {
          getUser,
          signOut: vi.fn(),
          onAuthStateChange: vi.fn().mockReturnValue({
            data: { subscription: { unsubscribe } },
          }),
        },
      }),
    }));

    const { UserMenu } = await import("./user-menu");
    render(<UserMenu />);

    expect(screen.getByRole("button", { name: "nav.profile" })).toBeDisabled();
    (resolveUser as unknown as ((v: { data: { user: null } }) => void) | undefined)?.({
      data: { user: null },
    });
  });

  it("renders nothing when there is no authenticated user", async () => {
    const supabase = createSupabaseAuthMock({ user: null });
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ auth: supabase.auth }),
    }));

    const { UserMenu } = await import("./user-menu");
    render(<UserMenu />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "nav.profile" })).not.toBeInTheDocument();
    });
  });

  it("shows authenticated user and signs out from dropdown", async () => {
    const { useUIStore } = await import("@/stores/ui-store");
    useUIStore.getState().setSelectedPersonId("person-1");
    const supabase = createSupabaseAuthMock({
      user: { id: "user-1", email: "user@example.com" },
    });
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ auth: supabase.auth }),
    }));

    const { UserMenu } = await import("./user-menu");
    render(<UserMenu />);

    const user = userEvent.setup();
    await screen.findByRole("button", { name: "nav.profile" });
    await user.click(await screen.findByRole("menuitem", { name: "nav.logout" }));

    await waitFor(() => expect(supabase.mocks.signOut).toHaveBeenCalledTimes(1));
    expect(useUIStore.getState().selectedPersonId).toBeNull();
    expect(routerMock.push).toHaveBeenCalledWith("/login");
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes auth listener on unmount", async () => {
    const supabase = createSupabaseAuthMock({
      user: { id: "user-1", email: "user@example.com" },
    });
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ auth: supabase.auth }),
    }));

    const { UserMenu } = await import("./user-menu");
    const view = render(<UserMenu />);
    await screen.findByRole("button", { name: "nav.profile" });
    view.unmount();

    expect(supabase.mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

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

describe("SignOutButton", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRouterMocks();
    mockNextIntl();
    mockNextNavigation();
  });

  it("signs out and redirects to login", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({
        auth: { signOut },
      }),
    }));

    const { SignOutButton } = await import("./signout-button");
    render(<SignOutButton />);

    await userEvent.setup().click(screen.getByRole("button", { name: "auth.signOut" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(routerMock.push).toHaveBeenCalledWith("/login");
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });
});

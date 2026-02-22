import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  }),
}));

vi.mock("@/components/auth/signout-button", () => ({
  SignOutButton: () => <button type="button">sign-out</button>,
}));

describe("access-denied page", () => {
  beforeEach(() => {
    getUserMock.mockReset();
  });

  it("renders logged-in state with sign out action", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { email: "max@example.com" } },
    });

    const Page = (await import("./page")).default;
    render(await Page());

    expect(screen.getByText("auth.accessDenied.title")).toBeInTheDocument();
    expect(screen.getByText(/max@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sign-out" })).toBeInTheDocument();
  });

  it("renders anonymous state with sign-in link", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
    });

    const Page = (await import("./page")).default;
    render(await Page());

    expect(screen.getByText("auth.accessDenied.message")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "auth.signIn" })).toHaveAttribute("href", "/login");
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isUserAllowedMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  isUserAllowed: (...args: unknown[]) => isUserAllowedMock(...args),
}));

vi.mock("@/components/auth/login-form", () => ({
  LoginForm: () => <div>login-form</div>,
}));

describe("login page", () => {
  beforeEach(() => {
    isUserAllowedMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects authenticated allowed users", async () => {
    isUserAllowedMock.mockResolvedValue(true);
    redirectMock.mockImplementation(() => {
      throw new Error("redirected");
    });

    const Page = (await import("./page")).default;
    await expect(Page()).rejects.toThrow("redirected");
    expect(redirectMock).toHaveBeenCalledWith("/health");
  });

  it("renders login UI for unauthenticated users", async () => {
    isUserAllowedMock.mockResolvedValue(false);

    const Page = (await import("./page")).default;
    render(await Page());

    expect(screen.getByText("auth.welcome")).toBeInTheDocument();
    expect(screen.getByText("auth.subtitle")).toBeInTheDocument();
    expect(screen.getByText("login-form")).toBeInTheDocument();
  });
});

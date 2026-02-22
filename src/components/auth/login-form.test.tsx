import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockNextIntl,
  mockNextNavigation,
  resetRouterMocks,
  setSearchParams,
} from "../../../test/utils/web/mocks";

describe("LoginForm", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRouterMocks();
    mockNextIntl();
    mockNextNavigation();
  });

  it("submits Google OAuth with redirect from search params", async () => {
    setSearchParams({ redirect: "/money/import" });
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({
        auth: { signInWithOAuth },
      }),
    }));

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    await userEvent.setup().click(screen.getByRole("button", { name: "auth.signInWithGoogle" }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/money/import");
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({
          redirectTo: callbackUrl.toString(),
        }),
      }),
    );
  });

  it("uses /health redirect when no search redirect is provided", async () => {
    setSearchParams({});
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({
        auth: { signInWithOAuth },
      }),
    }));

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    await userEvent.setup().click(screen.getByRole("button", { name: "auth.signInWithGoogle" }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/health");
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({
          redirectTo: callbackUrl.toString(),
        }),
      }),
    );
  });

  it("shows Supabase error message when oauth sign-in fails", async () => {
    setSearchParams({});
    const signInWithOAuth = vi.fn().mockResolvedValue({
      error: { message: "oauth failed" },
    });
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({
        auth: { signInWithOAuth },
      }),
    }));

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    await userEvent.setup().click(screen.getByRole("button", { name: "auth.signInWithGoogle" }));

    expect(await screen.findByText("oauth failed")).toBeInTheDocument();
  });

  it("shows loading label while sign-in is pending", async () => {
    setSearchParams({});
    let resolveSignIn: ((value: unknown) => void) | null = null;
    const signInWithOAuth = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({
        auth: { signInWithOAuth },
      }),
    }));

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    await userEvent.setup().click(screen.getByRole("button", { name: "auth.signInWithGoogle" }));

    expect(screen.getByRole("button", { name: "auth.signingIn" })).toBeDisabled();
    (resolveSignIn as unknown as ((v: { error: unknown }) => void) | undefined)?.({ error: null });
  });
});

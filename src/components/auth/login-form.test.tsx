import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED", "0");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  it("hides dev bypass panel when dev bypass is disabled", async () => {
    setSearchParams({});

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    expect(screen.queryByText("auth.devBypass.title")).not.toBeInTheDocument();
  });

  it("shows dev bypass panel when dev bypass is enabled", async () => {
    setSearchParams({});
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED", "1");

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    expect(screen.getByText("auth.devBypass.title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "auth.devBypass.signInButton" })).toBeInTheDocument();
  });

  it("shows validation error for invalid dev bypass email", async () => {
    setSearchParams({});
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED", "1");
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "auth.devBypass.signInButton" }));

    expect(await screen.findByText("auth.devBypass.invalidEmail")).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("builds dev login URL with email and redirect target", async () => {
    setSearchParams({ redirect: "/money/import" });
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED", "1");
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const { LoginForm } = await import("./login-form");
    render(<LoginForm />);

    await userEvent
      .setup()
      .type(screen.getByLabelText("auth.devBypass.emailLabel"), "Dev.User@example.com");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "auth.devBypass.signInButton" }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const redirectUrl = new URL((openSpy.mock.calls[0] as [string])[0]);
    expect(redirectUrl.pathname).toBe("/auth/dev-login");
    expect(redirectUrl.searchParams.get("email")).toBe("dev.user@example.com");
    expect(redirectUrl.searchParams.get("next")).toBe("/money/import");
    expect((openSpy.mock.calls[0] as [string, string])[1]).toBe("_self");
  });
});

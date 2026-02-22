import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle";

const themeMocks = vi.hoisted(() => ({
  useTheme: vi.fn(),
}));

const setThemeMock = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => themeMocks.useTheme(),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    setThemeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders fallback button before mounted", async () => {
    themeMocks.useTheme.mockReturnValue({
      theme: "dark",
      setTheme: setThemeMock,
    });
    const useStateSpy = vi.spyOn(React, "useState").mockImplementationOnce(
      // Mock useState return; vitest's spy types expect [unknown, Dispatch<unknown>]
      () => [false, vi.fn()] as unknown as [unknown, React.Dispatch<unknown>],
    );

    const view = render(<ThemeToggle />);

    expect(view.container.querySelector("button")).toBeTruthy();
    expect(setThemeMock).not.toHaveBeenCalled();
    useStateSpy.mockRestore();
  });

  it("toggles dark theme to light after mount", async () => {
    themeMocks.useTheme.mockReturnValue({
      theme: "dark",
      setTheme: setThemeMock,
    });

    const user = userEvent.setup();
    const view = render(<ThemeToggle />);
    await waitFor(() => expect(view.container.querySelector(".lucide-moon")).toBeTruthy());

    await user.click(screen.getByRole("button"));
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("toggles light theme to dark after mount", async () => {
    themeMocks.useTheme.mockReturnValue({
      theme: "light",
      setTheme: setThemeMock,
    });

    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));

    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });
});

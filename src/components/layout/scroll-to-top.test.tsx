import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScrollToTop } from "./scroll-to-top";

function setScrollY(value: number): void {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    writable: true,
    value,
  });
}

describe("ScrollToTop", () => {
  it("becomes visible after threshold and scrolls to top on click", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollTo,
    });

    setScrollY(0);
    render(<ScrollToTop />);
    const button = screen.getByRole("button", { name: "Scroll to top" });
    expect(button.className).toContain("opacity-0");

    setScrollY(400);
    fireEvent.scroll(window);
    expect(button.className).toContain("opacity-100");

    await userEvent.setup().click(button);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});

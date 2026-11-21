import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

describe("NewRecordPage", () => {
  beforeEach(() => {
    routerMock.replace.mockReset();
    routerMock.push.mockReset();
  });

  it("redirects to /health and explains upload is via assistant", async () => {
    const { default: NewRecordPage, goToHealth, openHealth } = await import("./page");
    goToHealth(routerMock);
    expect(routerMock.replace).toHaveBeenCalledWith("/health");
    openHealth(routerMock);
    expect(routerMock.push).toHaveBeenCalledWith("/health");

    render(<NewRecordPage />);
    expect(screen.getByText("records.uploadRemoved.title")).toBeInTheDocument();
    expect(screen.getByText("records.uploadRemoved.body")).toBeInTheDocument();
    expect(routerMock.replace).toHaveBeenCalledWith("/health");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "records.uploadRemoved.back" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health");
  });
});

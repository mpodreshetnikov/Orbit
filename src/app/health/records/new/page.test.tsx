import React from "react";
import { render, screen } from "@testing-library/react";
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
    const { default: NewRecordPage } = await import("./page");
    render(<NewRecordPage />);

    expect(screen.getByText("records.uploadRemoved.title")).toBeInTheDocument();
    expect(screen.getByText("records.uploadRemoved.body")).toBeInTheDocument();
    expect(routerMock.replace).toHaveBeenCalledWith("/health");
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as page from "./page";

const navigation = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() } }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
}));

const NewRecordPage = page.default;

describe("NewRecordPage", () => {
  beforeEach(() => {
    navigation.router = { replace: vi.fn(), push: vi.fn() };
  });

  it("only exposes the page component to Next.js", () => {
    expect(Object.keys(page)).toEqual(["default"]);
  });

  it("replaces the bookmarked route when the navigation context changes", () => {
    const { rerender } = render(<NewRecordPage />);
    expect(screen.getByText("records.uploadRemoved.title")).toBeInTheDocument();
    expect(screen.getByText("records.uploadRemoved.body")).toBeInTheDocument();
    expect(navigation.router.replace).toHaveBeenCalledWith("/health");

    navigation.router = { replace: vi.fn(), push: vi.fn() };
    rerender(<NewRecordPage />);
    expect(navigation.router.replace).toHaveBeenCalledWith("/health");
  });

  it("lets a reader manually return to health from the fallback message", async () => {
    render(<NewRecordPage />);
    const back = screen.getByRole("button", { name: "records.uploadRemoved.back" });
    expect(back).toBeEnabled();
    expect(navigation.router.push).not.toHaveBeenCalled();
    await userEvent.setup().click(back);
    expect(navigation.router.push).toHaveBeenCalledWith("/health");
  });
});

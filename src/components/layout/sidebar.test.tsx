import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const navMocks = vi.hoisted(() => ({
  pathname: "/health",
  section: "health" as "health" | "money",
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navMocks.pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/app-section", () => ({
  getAppSection: () => navMocks.section,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    navMocks.pathname = "/health";
    navMocks.section = "health";
  });

  it("renders health links and marks the active route", () => {
    navMocks.pathname = "/health/measurements";

    render(<Sidebar />);

    expect(screen.getByText("health.records")).toBeInTheDocument();
    expect(screen.getByText("measurements.navTitle")).toBeInTheDocument();
    expect(screen.getByText("catalogs.title")).toBeInTheDocument();

    const activeLink = screen.getByRole("link", { name: /measurements\.navTitle/i });
    expect(activeLink).toHaveAttribute("href", "/health/measurements");
    expect(activeLink.className).toContain("bg-secondary");
  });

  it("renders money links when the money section is selected", () => {
    navMocks.pathname = "/money/rules";
    navMocks.section = "money";

    render(<Sidebar />);

    expect(screen.getByText("money.reports")).toBeInTheDocument();
    expect(screen.getByText("money.transactions")).toBeInTheDocument();
    expect(screen.getByText("money.import")).toBeInTheDocument();
    expect(screen.getByText("money.accounts")).toBeInTheDocument();
    expect(screen.getByText("money.categories")).toBeInTheDocument();
    expect(screen.getByText("money.rules")).toBeInTheDocument();
    expect(screen.queryByText("health.records")).not.toBeInTheDocument();
  });
});

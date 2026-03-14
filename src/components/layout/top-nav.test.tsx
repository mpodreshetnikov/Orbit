import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopNav } from "./top-nav";

const navMocks = vi.hoisted(() => ({
  pathname: "/health",
  section: "health" as "health" | "money",
  selectedPersonId: "person-1" as string | null,
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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    asChild?: boolean;
  }) =>
    asChild ? (
      <div className={className}>{children}</div>
    ) : (
      <button type="button" className={className} onClick={onClick}>
        {children}
      </button>
    ),
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: navMocks.selectedPersonId }),
}));

vi.mock("@/lib/app-section", () => ({
  getAppSection: () => navMocks.section,
}));

vi.mock("./theme-toggle", () => ({
  ThemeToggle: () => <div>theme-toggle</div>,
}));

vi.mock("./language-toggle", () => ({
  LanguageToggle: () => <div>language-toggle</div>,
}));

vi.mock("./person-selector", () => ({
  PersonSelector: () => <div>person-selector</div>,
}));

vi.mock("@/components/auth/user-menu", () => ({
  UserMenu: () => <div>user-menu</div>,
}));

vi.mock("@/components/measurements/add-measurement-dialog", () => ({
  AddMeasurementDialog: ({ open, personId }: { open: boolean; personId: string | null }) => (
    <div
      data-testid="add-measurement-dialog"
      data-open={open ? "true" : "false"}
      data-person-id={personId ?? ""}
    />
  ),
}));

describe("TopNav", () => {
  beforeEach(() => {
    navMocks.pathname = "/health";
    navMocks.section = "health";
    navMocks.selectedPersonId = "person-1";
  });

  it("renders health quick actions and opens the measurement dialog", () => {
    render(<TopNav />);

    expect(screen.getByText("app.name")).toBeInTheDocument();
    expect(screen.getAllByText("nav.health").length).toBeGreaterThan(0);
    expect(screen.getByText("nav.medicalRecord")).toBeInTheDocument();
    expect(screen.getByText("nav.measurement")).toBeInTheDocument();
    expect(screen.getByText("nav.regularMedication")).toBeInTheDocument();
    expect(screen.getByText("nav.oneTimeMedication")).toBeInTheDocument();

    const measurementDialog = screen.getByTestId("add-measurement-dialog");
    expect(measurementDialog).toHaveAttribute("data-open", "false");
    expect(measurementDialog).toHaveAttribute("data-person-id", "person-1");

    fireEvent.click(screen.getByRole("button", { name: "nav.measurement" }));
    expect(screen.getByTestId("add-measurement-dialog")).toHaveAttribute("data-open", "true");
  });

  it("renders money quick actions for money pages", () => {
    navMocks.pathname = "/money/rules";
    navMocks.section = "money";

    render(<TopNav />);

    expect(screen.getAllByText("nav.money").length).toBeGreaterThan(0);
    expect(screen.getByText("money.addTransaction")).toBeInTheDocument();
    expect(screen.getByText("money.addAccount")).toBeInTheDocument();
    expect(screen.getByText("money.addCategory")).toBeInTheDocument();
    expect(screen.getByText("money.rules")).toBeInTheDocument();
    expect(screen.queryByText("nav.measurement")).not.toBeInTheDocument();
    expect(screen.queryByText("nav.regularMedication")).not.toBeInTheDocument();
  });
});

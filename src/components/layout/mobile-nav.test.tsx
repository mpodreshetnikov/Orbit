import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "./mobile-nav";

const navMocks = vi.hoisted(() => ({
  pathname: "/health",
  section: "health" as "health" | "money",
  selectedPersonId: "person-1" as string | null,
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navMocks.pathname,
  useRouter: () => navMocks.router,
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

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: navMocks.selectedPersonId }),
}));

vi.mock("@/lib/app-section", () => ({
  getAppSection: () => navMocks.section,
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
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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

describe("MobileNav", () => {
  beforeEach(() => {
    navMocks.pathname = "/health";
    navMocks.section = "health";
    navMocks.selectedPersonId = "person-1";
    navMocks.router.push.mockReset();
    navMocks.router.replace.mockReset();
    navMocks.router.refresh.mockReset();
    navMocks.router.prefetch.mockReset();
    navMocks.router.prefetch.mockResolvedValue(undefined);
  });

  it("renders health nav and supports measurement + medication quick actions", async () => {
    render(<MobileNav />);

    expect(screen.getByText("health.records")).toBeInTheDocument();
    expect(screen.getByText("measurements.navTitle")).toBeInTheDocument();
    expect(screen.getByText("checkups.navTitle")).toBeInTheDocument();

    const measurementDialog = screen.getByTestId("add-measurement-dialog");
    expect(measurementDialog).toHaveAttribute("data-open", "false");
    expect(measurementDialog).toHaveAttribute("data-person-id", "person-1");

    await fireEvent.click(screen.getByRole("button", { name: "nav.measurement" }));
    expect(screen.getByTestId("add-measurement-dialog")).toHaveAttribute("data-open", "true");

    await fireEvent.click(screen.getByRole("button", { name: "nav.medication" }));
    expect(screen.getByText("nav.regularMedication")).toBeInTheDocument();
    expect(screen.getByText("nav.oneTimeMedication")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "nav.regularMedication" }));
    expect(navMocks.router.push).toHaveBeenCalledWith("/health/medications/new?kind=regular");

    await fireEvent.click(screen.getByRole("button", { name: "nav.medication" }));
    await fireEvent.click(screen.getByRole("button", { name: "nav.oneTimeMedication" }));
    expect(navMocks.router.push).toHaveBeenCalledWith("/health/medications/new?kind=one_time");
  });

  it("renders money nav and money quick-create actions", () => {
    navMocks.section = "money";
    navMocks.pathname = "/money/import";

    render(<MobileNav />);

    expect(screen.getByText("money.transactions")).toBeInTheDocument();
    expect(screen.getByText("money.import")).toBeInTheDocument();
    expect(screen.getByText("money.accounts")).toBeInTheDocument();
    expect(screen.getByText("money.categories")).toBeInTheDocument();

    expect(screen.getByText("money.addTransaction")).toBeInTheDocument();
    expect(screen.getByText("money.addAccount")).toBeInTheDocument();
    expect(screen.getByText("money.addCategory")).toBeInTheDocument();
    expect(screen.queryByTestId("add-measurement-dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("nav.regularMedication")).not.toBeInTheDocument();
  });

  it("toggles right-edge shadow based on horizontal scroll position", () => {
    const { container } = render(<MobileNav />);
    const scrollEl = container.querySelector(".overflow-x-auto") as HTMLDivElement;
    const getRightShadow = () =>
      container.querySelector("div.pointer-events-none.absolute.right-0.top-0.bottom-0.w-6");

    let scrollLeft = 0;
    Object.defineProperty(scrollEl, "scrollWidth", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(scrollEl, "clientWidth", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(scrollEl, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
    });

    scrollLeft = 20;
    fireEvent.scroll(scrollEl);
    expect(getRightShadow()).toBeInTheDocument();

    scrollLeft = 100;
    fireEvent.scroll(scrollEl);
    expect(getRightShadow()).not.toBeInTheDocument();
  });
});

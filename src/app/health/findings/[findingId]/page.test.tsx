import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useSingleFindingHistory: vi.fn(),
  useMarkFindingResolved: vi.fn(),
  useMedicalRecords: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";
let searchParamsState = new URLSearchParams();

const markResolvedMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (
    selector?: ((state: { selectedPersonId: string | null }) => unknown) | undefined,
  ) => {
    const state = { selectedPersonId: selectedPersonIdState };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

vi.mock("@/hooks", () => ({
  useSingleFindingHistory: (...args: unknown[]) => hookMocks.useSingleFindingHistory(...args),
  useMarkFindingResolved: (...args: unknown[]) => hookMocks.useMarkFindingResolved(...args),
}));

vi.mock("@/hooks/use-medical-records", () => ({
  useMedicalRecords: (...args: unknown[]) => hookMocks.useMedicalRecords(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  const SelectContext = ReactModule.createContext<(value: string) => void>(() => {});

  return {
    Select: ({
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={(value) => onValueChange?.(value)}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => (
      <span>{placeholder ?? "select"}</span>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const onSelect = ReactModule.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onSelect(value)}>
          {children}
        </button>
      );
    },
  };
});

function resolvedParams(findingId: string): Promise<{ findingId: string }> {
  return {
    status: "fulfilled",
    value: { findingId },
    then: (resolve: (value: { findingId: string }) => void) => resolve({ findingId }),
  } as unknown as Promise<{ findingId: string }>;
}

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    finding_code: "finding-code",
    finding_type_text: "Nodule",
    catalog_finding_name_ru: "Pulmonary nodule",
    site_code: "lung",
    body_site_text: "Lung",
    catalog_site_name_ru: "Left lung",
    latest_size_mm: 5,
    latest_severity: "mild",
    latest_laterality: "left",
    latest_count: 1,
    occurrence_count: 2,
    is_resolved: false,
    history: [
      {
        id: "hist-1",
        record_id: "rec-1",
        record_date: "2026-01-01",
        created_at: "2026-01-01T00:00:00.000Z",
        size_mm: 5,
        count: 1,
        severity: "mild",
        laterality: "left",
        description: "description",
        morphology: null,
        source_anchor: "anchor",
      },
      {
        id: "hist-2",
        record_id: "rec-2",
        record_date: "2025-12-01",
        created_at: "2025-12-01T00:00:00.000Z",
        size_mm: 3,
        count: 1,
        severity: "mild",
        laterality: "left",
        description: null,
        morphology: null,
        source_anchor: null,
      },
    ],
    ...overrides,
  };
}

describe("FindingDetailPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    searchParamsState = new URLSearchParams();

    markResolvedMutateAsync.mockReset();
    markResolvedMutateAsync.mockResolvedValue(undefined);

    hookMocks.useMarkFindingResolved.mockReturnValue({
      mutateAsync: markResolvedMutateAsync,
      isPending: false,
    });
    hookMocks.useMedicalRecords.mockReturnValue({
      data: [{ id: "rec-1", title: "Visit note", record_date: "2026-01-01" }],
    });
  });

  it("renders person prompt, loading, and not-found states", async () => {
    const Page = (await import("./page")).default;

    selectedPersonIdState = null;
    hookMocks.useSingleFindingHistory.mockReturnValue({
      data: null,
      isLoading: false,
    });
    const noPersonView = render(<Page params={resolvedParams("finding-code")} />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
    noPersonView.unmount();

    selectedPersonIdState = "person-1";
    hookMocks.useSingleFindingHistory.mockReturnValue({
      data: null,
      isLoading: true,
    });
    const loadingView = render(<Page params={resolvedParams("finding-code")} />);
    expect(loadingView.container.querySelector(".animate-pulse")).toBeTruthy();
    loadingView.unmount();

    hookMocks.useSingleFindingHistory.mockReturnValue({
      data: null,
      isLoading: false,
    });
    render(<Page params={resolvedParams("finding-code")} />);
    expect(screen.getByText("findings.notFound")).toBeInTheDocument();
  });

  it("renders resolved finding state without resolve action", async () => {
    hookMocks.useSingleFindingHistory.mockReturnValue({
      data: makeFinding({ is_resolved: true }),
      isLoading: false,
    });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("finding-code")} />);

    expect(screen.getByText("Pulmonary nodule")).toBeInTheDocument();
    expect(screen.getByText("findings.resolved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "findings.markAsResolved" })).toBeNull();
  });

  it("handles mark-as-resolved flow for active finding", async () => {
    searchParamsState = new URLSearchParams({ site: "lung" });
    hookMocks.useSingleFindingHistory.mockReturnValue({
      data: makeFinding({ latest_severity: "severe", latest_laterality: "bilateral" }),
      isLoading: false,
    });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("finding-code")} />);

    expect(screen.getByText("findings.history")).toBeInTheDocument();
    expect(screen.getByText("findings.totalOccurrences")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "findings.markAsResolved" }));
    expect(screen.getByText("findings.attachToRecord")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Visit note/ }));
    await user.click(screen.getAllByRole("button", { name: "findings.markAsResolved" })[1]);

    await waitFor(() => {
      expect(markResolvedMutateAsync).toHaveBeenCalledWith({
        personId: "person-1",
        recordId: "rec-1",
        finding: expect.objectContaining({
          finding_code: "finding-code",
        }),
      });
    });
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedRegimen } from "@/types/regimen";
import MedicationsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useRegimens: vi.fn(),
  useUserPreferences: vi.fn(),
  useUpdateUserPreferences: vi.fn(),
  useMarkDoseTaken: vi.fn(),
  useMarkDoseSkipped: vi.fn(),
}));

const routerMock = {
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
  prefetch: vi.fn<(href: string) => Promise<void>>().mockResolvedValue(undefined),
};

const uiState = {
  selectedPersonId: "person-1" as string | null,
};

const markTakenMutate = vi.fn();
const markSkippedMutate = vi.fn();
const updatePrefsMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: typeof uiState) => unknown) => selector(uiState),
}));

vi.mock("@/hooks", () => ({
  useRegimens: (...args: unknown[]) => hookMocks.useRegimens(...args),
  useUserPreferences: (...args: unknown[]) => hookMocks.useUserPreferences(...args),
  useUpdateUserPreferences: (...args: unknown[]) => hookMocks.useUpdateUserPreferences(...args),
  useMarkDoseTaken: (...args: unknown[]) => hookMocks.useMarkDoseTaken(...args),
  useMarkDoseSkipped: (...args: unknown[]) => hookMocks.useMarkDoseSkipped(...args),
}));

vi.mock("@/components/medications", () => ({
  MedicationDashboard: () => <div>medication-dashboard</div>,
  RegimenCard: ({ regimen }: { regimen: MedRegimen }) => (
    <div>{`regimen:${regimen.custom_name}`}</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <div role="combobox" aria-controls="mock-listbox" aria-expanded={false}>
        {children}
      </div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

function regimen(overrides: Partial<MedRegimen> = {}): MedRegimen {
  return {
    id: "reg-1",
    person_id: "person-1",
    custom_name: "Alpha",
    status: "active",
    intake_unit: "pill",
    dose_definition: { intake: { amount: 1, unit: "pill" }, active: [] },
    intake_advice_type: "none",
    intake_advice_text: null,
    schedule: { mode: "daily_times", times: ["09:00"], amounts: [1] },
    duration: { type: "endless", start_date: "2026-01-01" },
    reminder_prefs: null,
    inventory: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("MedicationsPage", () => {
  beforeEach(() => {
    uiState.selectedPersonId = "person-1";
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    markTakenMutate.mockReset();
    markSkippedMutate.mockReset();
    updatePrefsMutateAsync.mockReset();
    updatePrefsMutateAsync.mockResolvedValue(undefined);

    hookMocks.useRegimens.mockReturnValue({ data: [], isLoading: false });
    hookMocks.useUserPreferences.mockReturnValue({
      data: { overdue_reminder_interval_minutes: 30 },
    });
    hookMocks.useUpdateUserPreferences.mockReturnValue({
      mutateAsync: updatePrefsMutateAsync,
      isPending: false,
    });
    hookMocks.useMarkDoseTaken.mockReturnValue({ mutate: markTakenMutate, isPending: false });
    hookMocks.useMarkDoseSkipped.mockReturnValue({ mutate: markSkippedMutate, isPending: false });

    window.history.pushState({}, "", "/health/medications");
  });

  it("renders person prompt when no person is selected", () => {
    uiState.selectedPersonId = null;
    render(<MedicationsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("handles notification URL actions and clears action params", async () => {
    window.history.pushState(
      {},
      "",
      "/health/medications?notification_action=taken&dose_event_ids=dose-1,dose-2",
    );

    render(<MedicationsPage />);

    await waitFor(() => {
      expect(markTakenMutate).toHaveBeenCalledTimes(2);
    });
    expect(markTakenMutate).toHaveBeenNthCalledWith(1, {
      doseEventId: "dose-1",
      takenAt: expect.any(String),
    });
    expect(markTakenMutate).toHaveBeenNthCalledWith(2, {
      doseEventId: "dose-2",
      takenAt: expect.any(String),
    });
    expect(window.location.search).not.toContain("notification_action");
    expect(window.location.search).not.toContain("dose_event_ids");
  });

  it("covers loading, empty, filtering, and completed-status sorting branches", async () => {
    const user = userEvent.setup();

    hookMocks.useRegimens.mockReturnValue({ data: [], isLoading: true });
    const loading = render(<MedicationsPage />);
    expect(loading.container.querySelector(".animate-pulse")).toBeTruthy();
    loading.unmount();

    hookMocks.useRegimens.mockReturnValue({ data: [], isLoading: false });
    const empty = render(<MedicationsPage />);
    expect(screen.getByText("medications.noItems")).toBeInTheDocument();
    empty.unmount();

    hookMocks.useRegimens.mockReturnValue({
      data: [
        regimen({ id: "reg-active", custom_name: "Alpha", status: "active" }),
        regimen({
          id: "reg-oneoff",
          custom_name: "One Off",
          status: "active",
          schedule: { mode: "one_off", due_at: "2026-02-22T10:00:00.000Z" },
        }),
        regimen({ id: "reg-done", custom_name: "Done", status: "completed" }),
      ],
      isLoading: false,
    });
    render(<MedicationsPage />);

    expect(screen.getByText("medication-dashboard")).toBeInTheDocument();
    expect(screen.getByText("regimen:Alpha")).toBeInTheDocument();
    expect(screen.getByText("regimen:One Off")).toBeInTheDocument();
    expect(screen.getByText("regimen:Done")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("common.search"), "zzz");
    expect(screen.getByText("common.noResults")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "common.clear" })[0]);

    await user.click(screen.getByRole("button", { name: "medications.statusCompleted" }));
    expect(screen.queryByText("regimen:Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("regimen:One Off")).toBeInTheDocument();
    expect(screen.getByText("regimen:Done")).toBeInTheDocument();
  });

  it("saves overdue reminder settings and routes add-menu actions", async () => {
    const user = userEvent.setup();
    render(<MedicationsPage />);

    await user.click(screen.getByRole("button", { name: "medications.settings" }));
    const intervalInput = screen.getByLabelText("medications.overdueReminderInterval");
    fireEvent.change(intervalInput, { target: { value: "2000" } });
    fireEvent.blur(intervalInput);

    await waitFor(() => {
      expect(updatePrefsMutateAsync).toHaveBeenCalledWith({
        overdue_reminder_interval_minutes: 1440,
      });
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => {
      expect(updatePrefsMutateAsync).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole("button", { name: "medications.oneTime" }));
    await user.click(screen.getByRole("button", { name: "medications.regular" }));

    expect(routerMock.push).toHaveBeenCalledWith("/health/medications/new?kind=one_time");
    expect(routerMock.push).toHaveBeenCalledWith("/health/medications/new?kind=regular");
  });
});

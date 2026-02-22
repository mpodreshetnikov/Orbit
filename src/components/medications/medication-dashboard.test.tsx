import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedDoseEventWithRegimen } from "@/types/regimen";
import { MedicationDashboard } from "./medication-dashboard";

const hookMocks = vi.hoisted(() => ({
  useDoseEventsForPerson: vi.fn(),
  useMarkDoseTaken: vi.fn(),
  useMarkDoseSkipped: vi.fn(),
  useUndoDoseIntake: vi.fn(),
  useUpdateDoseEventResolutionDetails: vi.fn(),
  useDeleteRegimen: vi.fn(),
}));

const uiState = {
  selectedPersonId: "person-1" as string | null,
  language: "en",
};

const markTakenMutate = vi.fn();
const markSkippedMutate = vi.fn();
const undoMutate = vi.fn();
const updateResolutionMutateAsync = vi.fn();
const deleteRegimenMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    return Object.entries(values).reduce(
      (message, [valueKey, value]) => message.replaceAll(`{${valueKey}}`, String(value)),
      key,
    );
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
  useDateHeaderFormat: () => "MMM d, yyyy",
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: typeof uiState) => unknown) => selector(uiState),
}));

vi.mock("@/hooks", () => ({
  useDoseEventsForPerson: (...args: unknown[]) => hookMocks.useDoseEventsForPerson(...args),
  useMarkDoseTaken: (...args: unknown[]) => hookMocks.useMarkDoseTaken(...args),
  useMarkDoseSkipped: (...args: unknown[]) => hookMocks.useMarkDoseSkipped(...args),
  useUndoDoseIntake: (...args: unknown[]) => hookMocks.useUndoDoseIntake(...args),
  useUpdateDoseEventResolutionDetails: (...args: unknown[]) =>
    hookMocks.useUpdateDoseEventResolutionDetails(...args),
  useDeleteRegimen: (...args: unknown[]) => hookMocks.useDeleteRegimen(...args),
}));

vi.mock("./edit-intake-dialog", () => ({
  EditIntakeDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    event: MedDoseEventWithRegimen | null;
    isPending?: boolean;
    onSubmit: (params: { takenAt: string; amountTaken: number; note?: string | null }) => void;
  }) =>
    open ? (
      <div>
        edit-intake-dialog
        <button
          type="button"
          onClick={() =>
            onSubmit({
              takenAt: "2026-02-22T10:00:00.000Z",
              amountTaken: 2,
              note: "updated",
            })
          }
        >
          submit-edit-intake
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/calendar", () => ({
  Calendar: () => <div>calendar</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void | Promise<void>;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      type="button"
      disabled={disabled}
      className={className}
      onClick={() => void onClick?.()}
    >
      {children}
    </button>
  ),
}));

function makeEvent(overrides: Partial<MedDoseEventWithRegimen> = {}): MedDoseEventWithRegimen {
  return {
    id: "event-1",
    person_id: "person-1",
    regimen_id: "reg-1",
    scheduled_at: "2026-02-22T09:00:00.000Z",
    actual_at: "2099-02-22T09:00:00.000Z",
    planned_intake: { intake: { amount: 1, unit: "pill" }, active: [] },
    status: "scheduled",
    taken_at: null,
    note: null,
    created_at: "2026-02-22T09:00:00.000Z",
    updated_at: "2026-02-22T09:00:00.000Z",
    regimen: {
      custom_name: "Vitamin D",
      intake_unit: "pill",
      intake_advice_type: "none",
      intake_advice_text: null,
      schedule: { mode: "daily_times", times: ["09:00"], amounts: [1] },
    },
    ...overrides,
  };
}

describe("MedicationDashboard", () => {
  beforeEach(() => {
    uiState.selectedPersonId = "person-1";
    uiState.language = "en";

    markTakenMutate.mockReset();
    markSkippedMutate.mockReset();
    undoMutate.mockReset();
    updateResolutionMutateAsync.mockReset();
    deleteRegimenMutateAsync.mockReset();

    updateResolutionMutateAsync.mockResolvedValue(undefined);
    deleteRegimenMutateAsync.mockResolvedValue(undefined);

    hookMocks.useDoseEventsForPerson.mockReturnValue({ data: [], isLoading: false });
    hookMocks.useMarkDoseTaken.mockReturnValue({ mutate: markTakenMutate, isPending: false });
    hookMocks.useMarkDoseSkipped.mockReturnValue({ mutate: markSkippedMutate, isPending: false });
    hookMocks.useUndoDoseIntake.mockReturnValue({ mutate: undoMutate, isPending: false });
    hookMocks.useUpdateDoseEventResolutionDetails.mockReturnValue({
      mutateAsync: updateResolutionMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteRegimen.mockReturnValue({
      mutateAsync: deleteRegimenMutateAsync,
      isPending: false,
    });
  });

  it("renders person prompt when no person is selected", () => {
    uiState.selectedPersonId = null;
    render(<MedicationDashboard />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("renders loading skeleton and empty-state branch", () => {
    hookMocks.useDoseEventsForPerson.mockReturnValue({ data: [], isLoading: true });
    const loading = render(<MedicationDashboard />);
    expect(loading.container.querySelector(".animate-pulse")).toBeTruthy();
    loading.unmount();

    hookMocks.useDoseEventsForPerson.mockReturnValue({ data: [], isLoading: false });
    render(<MedicationDashboard />);
    expect(screen.getByText("medications.noItems")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "medications.add" })).toBeInTheDocument();
  });

  it("marks grouped pending events taken and allows skip action", async () => {
    const user = userEvent.setup();
    hookMocks.useDoseEventsForPerson.mockReturnValue({
      data: [
        makeEvent({ id: "event-a", actual_at: "2099-02-22T09:00:00.000Z" }),
        makeEvent({ id: "event-b", actual_at: "2099-02-22T09:00:00.000Z" }),
      ],
      isLoading: false,
    });

    render(<MedicationDashboard />);

    await user.click(screen.getAllByTitle("medications.skipped")[0]);
    expect(markSkippedMutate).toHaveBeenCalledWith({ doseEventId: "event-a" }, expect.any(Object));

    await user.click(screen.getByRole("button", { name: "medications.confirmAll" }));
    expect(markTakenMutate).toHaveBeenCalledTimes(2);
    expect(markTakenMutate).toHaveBeenNthCalledWith(
      1,
      { doseEventId: "event-a", takenAt: expect.any(String) },
      expect.any(Object),
    );
    expect(markTakenMutate).toHaveBeenNthCalledWith(
      2,
      { doseEventId: "event-b", takenAt: expect.any(String) },
      expect.any(Object),
    );
  });

  it("executes completed-section actions for one-off and regular events", async () => {
    const user = userEvent.setup();
    hookMocks.useDoseEventsForPerson.mockReturnValue({
      data: [
        makeEvent({
          id: "event-oneoff",
          regimen_id: "reg-oneoff",
          actual_at: "2026-02-22T08:00:00.000Z",
          status: "taken",
          taken_at: "2026-02-22T08:10:00.000Z",
          regimen: {
            custom_name: "One-off med",
            intake_unit: "pill",
            intake_advice_type: "none",
            intake_advice_text: null,
            schedule: { mode: "one_off", due_at: "2026-02-22T08:00:00.000Z" },
          },
        }),
        makeEvent({
          id: "event-regular",
          regimen_id: "reg-regular",
          actual_at: "2026-02-22T07:00:00.000Z",
          status: "skipped",
          regimen: {
            custom_name: "Regular med",
            intake_unit: "pill",
            intake_advice_type: "none",
            intake_advice_text: null,
            schedule: { mode: "daily_times", times: ["07:00"], amounts: [1] },
          },
        }),
      ],
      isLoading: false,
    });

    render(<MedicationDashboard />);

    await user.click(screen.getByRole("button", { name: /medications.completedToday/ }));

    await user.click(screen.getAllByRole("button", { name: "medications.editIntake" }).at(-1)!);
    await user.click(screen.getByRole("button", { name: "submit-edit-intake" }));
    await waitFor(() => {
      expect(updateResolutionMutateAsync).toHaveBeenCalledWith({
        doseEventId: "event-oneoff",
        takenAt: "2026-02-22T10:00:00.000Z",
        amountTaken: 2,
        note: "updated",
      });
    });

    await user.click(screen.getAllByRole("button", { name: "medications.removeOneTime" })[0]);
    await user.click(screen.getAllByRole("button", { name: "medications.removeOneTime" }).at(-1)!);
    await waitFor(() => {
      expect(deleteRegimenMutateAsync).toHaveBeenCalledWith({
        id: "reg-oneoff",
        personId: "person-1",
      });
    });

    await user.click(screen.getByRole("button", { name: "medications.undoIntake" }));
    expect(undoMutate).toHaveBeenCalledWith({ doseEventId: "event-regular" });

    await user.click(screen.getByRole("button", { name: "medications.markAsTaken" }));
    expect(markTakenMutate).toHaveBeenCalledWith(
      { doseEventId: "event-regular", takenAt: expect.any(String) },
      expect.any(Object),
    );
  });

  it("covers past-date completed section with resolved and unspecified regular events", async () => {
    const user = userEvent.setup();
    hookMocks.useDoseEventsForPerson.mockReturnValue({
      data: [
        makeEvent({
          id: "event-taken-past",
          regimen_id: "reg-a",
          actual_at: "2025-02-21T08:00:00.000Z",
          status: "taken",
          taken_at: "2025-02-21T08:05:00.000Z",
          regimen: {
            custom_name: "Taken regular",
            intake_unit: "pill",
            intake_advice_type: "none",
            intake_advice_text: null,
            schedule: { mode: "daily_times", times: ["08:00"], amounts: [1] },
          },
        }),
        makeEvent({
          id: "event-unspecified-past",
          regimen_id: "reg-b",
          actual_at: "2025-02-21T09:00:00.000Z",
          status: "scheduled",
          taken_at: null,
          regimen: {
            custom_name: "Unspecified regular",
            intake_unit: "pill",
            intake_advice_type: "none",
            intake_advice_text: null,
            schedule: { mode: "daily_times", times: ["09:00"], amounts: [1] },
          },
        }),
      ],
      isLoading: false,
    });

    render(<MedicationDashboard />);
    await user.click(screen.getByRole("button", { name: "medications.datePrev" }));

    expect(screen.getByText(/medications\.completedOnDate/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "medications.undoIntake" }));
    expect(undoMutate).toHaveBeenCalledWith({ doseEventId: "event-taken-past" });

    await user.click(screen.getAllByRole("button", { name: "medications.markAsSkipped" })[0]);
    expect(markSkippedMutate).toHaveBeenCalledWith(
      { doseEventId: "event-taken-past" },
      expect.any(Object),
    );

    await user.click(screen.getByRole("button", { name: "medications.markAsTaken" }));
    expect(markTakenMutate).toHaveBeenCalledWith(
      { doseEventId: "event-unspecified-past", takenAt: expect.any(String) },
      expect.any(Object),
    );
  });
});

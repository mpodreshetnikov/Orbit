import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedDoseEvent, MedRegimen } from "@/types/regimen";

/**
 * The snooze date has to be in the future relative to the run. The page treats
 * a lapsed snooze as inactive (`activeRefillSnoozeUntil` in page.tsx only keeps
 * a value that is >= today), so it stops rendering the "snoozed until" label —
 * a hardcoded date silently rots this spec into a failure once it passes.
 *
 * Derived here rather than inlined so the calendar mock and the assertions
 * cannot drift apart. Local noon, formatted the same way the page does with
 * date-fns `format(date, "yyyy-MM-dd")`.
 */
const snooze = vi.hoisted(() => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + 30);
  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { date, value };
});

const hookMocks = vi.hoisted(() => ({
  useRegimen: vi.fn(),
  useDoseEventsForRegimen: vi.fn(),
  useMedicationRefillSnooze: vi.fn(),
  useSetMedicationRefillSnooze: vi.fn(),
  useUpdateRegimenInventory: vi.fn(),
  useDeleteRegimen: vi.fn(),
  useArchiveRegimen: vi.fn(),
  useUnarchiveRegimen: vi.fn(),
  useUndoDoseIntake: vi.fn(),
  useMarkDoseTaken: vi.fn(),
  useMarkDoseSkipped: vi.fn(),
  useUpdateDoseEventResolutionDetails: vi.fn(),
}));

const routerMock = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const deleteMutateAsync = vi.fn();
const archiveMutateAsync = vi.fn();
const unarchiveMutateAsync = vi.fn();
const updateInventoryMutateAsync = vi.fn();
const setRefillSnoozeMutateAsync = vi.fn();
const updateResolutionMutateAsync = vi.fn();
const undoMutate = vi.fn();
const markTakenMutate = vi.fn();
const markSkippedMutate = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
  useIntlLocale: () => "en-US",
}));

vi.mock("@/hooks", () => ({
  useRegimen: (...args: unknown[]) => hookMocks.useRegimen(...args),
  useDoseEventsForRegimen: (...args: unknown[]) => hookMocks.useDoseEventsForRegimen(...args),
  useMedicationRefillSnooze: (...args: unknown[]) => hookMocks.useMedicationRefillSnooze(...args),
  useSetMedicationRefillSnooze: (...args: unknown[]) =>
    hookMocks.useSetMedicationRefillSnooze(...args),
  useUpdateRegimenInventory: (...args: unknown[]) => hookMocks.useUpdateRegimenInventory(...args),
  useDeleteRegimen: (...args: unknown[]) => hookMocks.useDeleteRegimen(...args),
  useArchiveRegimen: (...args: unknown[]) => hookMocks.useArchiveRegimen(...args),
  useUnarchiveRegimen: (...args: unknown[]) => hookMocks.useUnarchiveRegimen(...args),
  useUndoDoseIntake: (...args: unknown[]) => hookMocks.useUndoDoseIntake(...args),
  useMarkDoseTaken: (...args: unknown[]) => hookMocks.useMarkDoseTaken(...args),
  useMarkDoseSkipped: (...args: unknown[]) => hookMocks.useMarkDoseSkipped(...args),
  useUpdateDoseEventResolutionDetails: (...args: unknown[]) =>
    hookMocks.useUpdateDoseEventResolutionDetails(...args),
}));

vi.mock("@/components/medications/regimen-card", () => ({
  formatRegimenScheduleSummary: () => "daily at 09:00",
}));

vi.mock("@/components/medications/medication-units", () => ({
  formatAmountWithUnit: (amount: number, unit: string) => `${amount} ${unit}`,
  getUnitIcon: () => (props: React.SVGProps<SVGSVGElement>) =>
    React.createElement("svg", { ...props, role: "img" }),
}));

vi.mock("@/components/medications", () => ({
  RefillDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (amount: number) => void | Promise<void>;
  }) =>
    open ? (
      <div>
        refill-dialog
        <button type="button" onClick={() => void onSubmit(5)}>
          submit-refill
        </button>
        <button type="button" onClick={() => void onSubmit(-2)}>
          submit-correction
        </button>
      </div>
    ) : null,
  EditIntakeDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (params: { takenAt: string; amountTaken: number; note?: string | null }) => void;
  }) =>
    open ? (
      <div>
        edit-intake-dialog
        <button
          type="button"
          onClick={() =>
            onSubmit({
              takenAt: "2026-02-20T09:30:00.000Z",
              amountTaken: 2,
              note: "updated",
            })
          }
        >
          submit-edit-intake
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              takenAt: "2026-02-20T09:35:00.000Z",
              amountTaken: 1,
            })
          }
        >
          submit-edit-intake-no-note
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
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect?: (date: Date | undefined) => void }) => (
    <button type="button" onClick={() => onSelect?.(snooze.date)}>
      pick-refill-snooze-date
    </button>
  ),
}));

function resolvedParams(id: string): Promise<{ id: string }> {
  return {
    status: "fulfilled",
    value: { id },
    then: (resolve: (value: { id: string }) => void) => resolve({ id }),
  } as unknown as Promise<{ id: string }>;
}

function makeRegimen(overrides: Partial<MedRegimen> = {}): MedRegimen {
  return {
    id: "reg-1",
    person_id: "person-1",
    custom_name: "Vitamin D",
    status: "active",
    intake_unit: "pill",
    dose_definition: { intake: { amount: 1, unit: "pill" }, active: [] },
    intake_advice_type: "none",
    intake_advice_text: null,
    schedule: { mode: "daily_times", times: ["09:00"], amounts: [1] },
    duration: { type: "endless", start_date: "2026-01-01" },
    reminder_prefs: null,
    inventory: {
      enabled: true,
      current_amount: 2,
      refill_threshold_amount: 3,
      unit: "pill",
      auto_decrement_on_taken: true,
    },
    notes: "Take with meal",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDoseEvent(overrides: Partial<MedDoseEvent> = {}): MedDoseEvent {
  return {
    id: "event-1",
    person_id: "person-1",
    regimen_id: "reg-1",
    scheduled_at: "2026-02-20T09:00:00.000Z",
    actual_at: "2026-02-20T09:00:00.000Z",
    planned_intake: { intake: { amount: 1, unit: "pill" }, active: [] },
    status: "skipped",
    taken_at: null,
    note: null,
    created_at: "2026-02-20T09:00:00.000Z",
    updated_at: "2026-02-20T09:00:00.000Z",
    ...overrides,
  };
}

describe("MedicationDetailPage", () => {
  beforeEach(() => {
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    deleteMutateAsync.mockReset();
    archiveMutateAsync.mockReset();
    unarchiveMutateAsync.mockReset();
    updateInventoryMutateAsync.mockReset();
    setRefillSnoozeMutateAsync.mockReset();
    updateResolutionMutateAsync.mockReset();
    undoMutate.mockReset();
    markTakenMutate.mockReset();
    markSkippedMutate.mockReset();

    deleteMutateAsync.mockResolvedValue(undefined);
    archiveMutateAsync.mockResolvedValue(undefined);
    unarchiveMutateAsync.mockResolvedValue(undefined);
    updateInventoryMutateAsync.mockResolvedValue(undefined);
    setRefillSnoozeMutateAsync.mockResolvedValue(undefined);
    updateResolutionMutateAsync.mockResolvedValue(undefined);

    hookMocks.useMedicationRefillSnooze.mockReturnValue({
      data: null,
      isLoading: false,
    });
    hookMocks.useSetMedicationRefillSnooze.mockReturnValue({
      mutateAsync: setRefillSnoozeMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateRegimenInventory.mockReturnValue({
      mutateAsync: updateInventoryMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteRegimen.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
    hookMocks.useArchiveRegimen.mockReturnValue({
      mutateAsync: archiveMutateAsync,
      isPending: false,
    });
    hookMocks.useUnarchiveRegimen.mockReturnValue({
      mutateAsync: unarchiveMutateAsync,
      isPending: false,
    });
    hookMocks.useUndoDoseIntake.mockReturnValue({
      mutate: undoMutate,
      isPending: false,
    });
    hookMocks.useMarkDoseTaken.mockReturnValue({
      mutate: markTakenMutate,
      isPending: false,
    });
    hookMocks.useMarkDoseSkipped.mockReturnValue({
      mutate: markSkippedMutate,
      isPending: false,
    });
    hookMocks.useUpdateDoseEventResolutionDetails.mockReturnValue({
      mutateAsync: updateResolutionMutateAsync,
      isPending: false,
    });
  });

  it("renders loading and error states", async () => {
    hookMocks.useRegimen.mockReturnValue({ data: null, isLoading: true, error: null });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({ data: [] });

    const Page = (await import("./page")).default;
    const loadingView = render(<Page params={resolvedParams("reg-1")} />);
    expect(loadingView.container.querySelector(".animate-pulse")).toBeTruthy();
    loadingView.unmount();

    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen(),
      isLoading: false,
      error: new Error("fail"),
    });
    render(<Page params={resolvedParams("reg-1")} />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("handles archive and delete confirmations", async () => {
    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen(),
      isLoading: false,
      error: null,
    });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({ data: [] });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("reg-1")} />);

    expect(screen.getByRole("heading", { name: "Vitamin D" })).toBeInTheDocument();
    expect(screen.getByText("medications.refillWarning")).toBeInTheDocument();
    expect(screen.getByText("daily at 09:00")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "medications.archiveMedication" }));
    await user.click(screen.getAllByRole("button", { name: "medications.archiveMedication" })[1]);

    await waitFor(() => {
      expect(archiveMutateAsync).toHaveBeenCalledWith({ id: "reg-1", personId: "person-1" });
      expect(routerMock.push).toHaveBeenCalledWith("/health/medications");
    });

    await user.click(screen.getByRole("button", { name: "medications.deleteMedication" }));
    await user.click(screen.getByRole("button", { name: "common.delete" }));

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({ id: "reg-1", personId: "person-1" });
    });
  });

  it("executes intake actions for skipped/taken events", async () => {
    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen(),
      isLoading: false,
      error: null,
    });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({
      data: [
        makeDoseEvent({ id: "event-skipped", status: "skipped" }),
        makeDoseEvent({
          id: "event-taken",
          status: "taken",
          taken_at: "2026-02-20T10:00:00.000Z",
        }),
      ],
    });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("reg-1")} />);

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "medications.markAsTaken" })[0]);
    expect(markTakenMutate).toHaveBeenCalledWith(
      { doseEventId: "event-skipped", takenAt: expect.any(String) },
      expect.any(Object),
    );

    await user.click(screen.getAllByRole("button", { name: "medications.markAsSkipped" })[0]);
    expect(markSkippedMutate).toHaveBeenCalledWith(
      { doseEventId: "event-taken" },
      expect.any(Object),
    );

    await user.click(screen.getAllByRole("button", { name: "medications.editIntake" })[0]);
    await user.click(screen.getByRole("button", { name: "submit-edit-intake" }));
    await waitFor(() => {
      expect(updateResolutionMutateAsync).toHaveBeenCalledWith({
        doseEventId: "event-skipped",
        takenAt: "2026-02-20T09:30:00.000Z",
        amountTaken: 2,
        note: "updated",
      });
    });
  });

  it("renders archived no-intake state and for-days duration branch", async () => {
    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen({
        status: "archived",
        inventory: {
          enabled: false,
          current_amount: undefined,
          refill_threshold_amount: undefined,
          unit: "pill",
          auto_decrement_on_taken: true,
        },
        duration: { type: "for_days", start_date: "2026-01-01", days: 7 },
        notes: null,
      }),
      isLoading: false,
      error: null,
    });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({ data: [] });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("reg-1")} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "medications.unarchiveMedication" }));
    await user.click(screen.getAllByRole("button", { name: "medications.unarchiveMedication" })[1]);
    await waitFor(() => {
      expect(unarchiveMutateAsync).toHaveBeenCalledWith({ id: "reg-1", personId: "person-1" });
      expect(routerMock.push).toHaveBeenCalledWith("/health/medications");
    });

    expect(screen.getByText("medications.noIntakes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "medications.archiveMedication" })).toBeNull();
    expect(screen.queryByRole("button", { name: "medications.refillButton" })).toBeNull();
  });

  it("handles refill and correction inventory operations", async () => {
    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen({
        duration: { type: "until_date", start_date: "2026-01-01", end_date: "2026-02-01" },
        inventory: {
          enabled: true,
          current_amount: undefined,
          refill_threshold_amount: 3,
          unit: "pill",
          auto_decrement_on_taken: true,
        },
      }),
      isLoading: false,
      error: null,
    });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({ data: [] });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("reg-1")} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));
    await user.click(screen.getByRole("button", { name: "submit-refill" }));
    await user.click(screen.getByRole("button", { name: "submit-correction" }));

    await waitFor(() => {
      expect(updateInventoryMutateAsync).toHaveBeenCalledWith({
        regimenId: "reg-1",
        type: "refill",
        amount: 5,
      });
      expect(updateInventoryMutateAsync).toHaveBeenCalledWith({
        regimenId: "reg-1",
        type: "correction",
        amount: -2,
      });
    });
    expect(screen.getByText(/medications\.endDate/)).toBeInTheDocument();
  });

  it("saves and clears a refill reminder snooze date", async () => {
    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen(),
      isLoading: false,
      error: null,
    });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({ data: [] });

    const Page = (await import("./page")).default;
    const user = userEvent.setup();

    const view = render(<Page params={resolvedParams("reg-1")} />);

    await user.click(screen.getByRole("button", { name: "pick-refill-snooze-date" }));
    await user.click(screen.getByRole("button", { name: "medications.saveRefillReminderSnooze" }));

    await waitFor(() => {
      expect(setRefillSnoozeMutateAsync).toHaveBeenCalledWith({
        regimenId: "reg-1",
        snoozeUntil: snooze.value,
      });
    });

    view.unmount();

    hookMocks.useMedicationRefillSnooze.mockReturnValue({
      data: snooze.value,
      isLoading: false,
    });

    render(<Page params={resolvedParams("reg-1")} />);
    expect(screen.getByText(/medications\.refillReminderSnoozedUntil/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "medications.clearRefillReminderSnooze" }));

    await waitFor(() => {
      expect(setRefillSnoozeMutateAsync).toHaveBeenCalledWith({
        regimenId: "reg-1",
        snoozeUntil: null,
      });
    });
  });

  it("supports unspecified/missed/cancelled intake branches and null note fallback", async () => {
    hookMocks.useRegimen.mockReturnValue({
      data: makeRegimen(),
      isLoading: false,
      error: null,
    });
    hookMocks.useDoseEventsForRegimen.mockReturnValue({
      data: [
        makeDoseEvent({ id: "event-scheduled", status: "scheduled", note: "pending note" }),
        makeDoseEvent({ id: "event-missed", status: "missed", note: null }),
        makeDoseEvent({ id: "event-cancelled", status: "cancelled", note: null }),
      ],
    });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("reg-1")} />);

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "medications.markAsTaken" })[0]);
    await user.click(screen.getAllByRole("button", { name: "medications.markAsSkipped" })[0]);
    await user.click(screen.getAllByRole("button", { name: "medications.editIntake" })[0]);
    await user.click(screen.getByRole("button", { name: "submit-edit-intake-no-note" }));

    expect(markTakenMutate).toHaveBeenCalledWith(
      { doseEventId: "event-scheduled", takenAt: expect.any(String) },
      expect.any(Object),
    );
    expect(markSkippedMutate).toHaveBeenCalledWith(
      { doseEventId: "event-scheduled" },
      expect.any(Object),
    );
    await waitFor(() => {
      expect(updateResolutionMutateAsync).toHaveBeenCalledWith({
        doseEventId: "event-scheduled",
        takenAt: "2026-02-20T09:35:00.000Z",
        amountTaken: 1,
        note: null,
      });
    });
    expect(screen.getByText("medications.unspecified")).toBeInTheDocument();
    expect(screen.getByText("medications.missed")).toBeInTheDocument();
  });
});

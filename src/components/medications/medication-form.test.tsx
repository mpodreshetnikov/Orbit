import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateMedRegimenInput,
  MedRegimen,
  MedSchedule,
  UpdateMedRegimenInput,
} from "@/types/regimen";
import type { MedicationKind } from "@/types";
import {
  MedicationForm,
  getInitialDuration,
  getInitialSchedule,
  getInitialStartDate,
  getReminderSlotsForIntakesPerDay,
  mapLegacyIntakeAdvice,
  toDatetimeLocalString,
} from "./medication-form";

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}

const hookMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(),
  useRegimens: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    return Object.entries(values).reduce(
      (message, [valueKey, value]) => message.replaceAll(`{${valueKey}}`, String(value)),
      key,
    );
  },
}));

vi.mock("@/hooks/use-media-query", () => ({
  useIsMobile: () => hookMocks.useIsMobile(),
}));

vi.mock("@/hooks/use-regimens", () => ({
  useRegimens: (...args: unknown[]) => hookMocks.useRegimens(...args),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder ?? "command-input"}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
    value,
    className,
  }: {
    children: React.ReactNode;
    onSelect?: (value: string) => void;
    value?: string;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={() => onSelect?.(value ?? "")}>
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

function makeRegimen(overrides: Partial<MedRegimen> = {}): MedRegimen {
  return {
    id: "reg-1",
    person_id: "person-1",
    custom_name: "Aspirin",
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

describe("MedicationForm", () => {
  beforeEach(() => {
    hookMocks.useIsMobile.mockReturnValue(false);
    hookMocks.useRegimens.mockReturnValue({ data: [] });
  });

  it("submits add-one-time payload when an existing regimen is selected", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    hookMocks.useRegimens.mockReturnValue({
      data: [makeRegimen({ id: "reg-42", custom_name: "Aspirin" })],
    });

    render(
      <MedicationForm
        mode="create"
        personId="person-1"
        defaultKind="one_time"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aspirin" }));
    fireEvent.change(screen.getByLabelText("medications.scheduledAt"), {
      target: { value: "2026-03-01T10:15" },
    });
    fireEvent.change(screen.getByLabelText("medications.oneTimeAmount"), {
      target: { value: "3" },
    });

    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        addToRegimenId: "reg-42",
        scheduled_at: new Date("2026-03-01T10:15").toISOString(),
        amount: 3,
        unit: "pill",
        notes: null,
      });
    });
  });

  it("creates a new one-time regimen payload when no existing regimen is chosen", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MedicationForm
        mode="create"
        personId="person-1"
        defaultKind="one_time"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("medications.namePlaceholder"), {
      target: { value: "  New Med  " },
    });
    fireEvent.change(screen.getByLabelText("medications.scheduledAt"), {
      target: { value: "2026-03-02T08:00" },
    });
    fireEvent.change(screen.getByPlaceholderText("medications.notesPlaceholder"), {
      target: { value: "once only" },
    });

    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        person_id: "person-1",
        custom_name: "New Med",
        intake_unit: "pill",
        dose_definition: { intake: { amount: 1, unit: "pill" }, active: [] },
        intake_advice_type: "none",
        intake_advice_text: null,
        schedule: { mode: "one_off", due_at: new Date("2026-03-02T08:00").toISOString() },
        duration: { type: "endless" },
        inventory: null,
        notes: "once only",
      });
    });
  });

  it("submits a fractional one-time dose", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MedicationForm
        mode="create"
        personId="person-1"
        defaultKind="one_time"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("medications.namePlaceholder"), {
      target: { value: "Aspirin" },
    });
    fireEvent.change(screen.getByLabelText("medications.scheduledAt"), {
      target: { value: "2026-03-01T10:15" },
    });
    fireEvent.change(screen.getByLabelText("medications.oneTimeAmount"), {
      target: { value: "0.5" },
    });

    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          dose_definition: { intake: { amount: 0.5, unit: "pill" }, active: [] },
        }),
      );
    });
  });

  it("submits a fractional daily dose entered with a decimal comma", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<MedicationForm mode="create" personId="person-1" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("medications.name"), { target: { value: "Aspirin" } });
    fireEvent.change(screen.getByLabelText("medications.amountPerIntake"), {
      target: { value: "1,5" },
    });

    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          dose_definition: { intake: { amount: 1.5, unit: "pill" }, active: [] },
          schedule: expect.objectContaining({ mode: "daily_times", amounts: [1.5] }),
        }),
      );
    });
  });

  it("blocks submit for regular regimen when for-days duration is invalid", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<MedicationForm mode="create" personId="person-1" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("medications.name"), {
      target: { value: "Vitamin C" },
    });
    await user.click(screen.getByRole("button", { name: "medications.endTypeDaysFromStart" }));
    fireEvent.change(screen.getByLabelText("medications.daysFromStartCount"), {
      target: { value: "0" },
    });

    const form = screen.getByRole("button", { name: "common.add" }).closest("form");
    if (!form) throw new Error("form not found");
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("medications.daysCountRequired");
  });

  it("submits regular interval-hours payload with inventory and custom intake advice", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<MedicationForm mode="create" personId="person-1" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("medications.name"), {
      target: { value: "Metformin" },
    });
    await user.click(screen.getByRole("button", { name: "medications.everyXHours" }));

    fireEvent.change(screen.getByLabelText("medications.hours"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("medications.amountPerIntake"), {
      target: { value: "2" },
    });

    await user.click(screen.getByRole("button", { name: "medications.intakeAdviceCustom" }));
    fireEvent.change(screen.getByPlaceholderText("medications.intakeAdviceCustom"), {
      target: { value: "After breakfast only" },
    });

    await user.click(screen.getByLabelText("medications.inventoryEnabled"));

    fireEvent.change(screen.getByLabelText(/medications\.inventoryCurrent/), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText(/medications\.inventoryRefillThreshold/), {
      target: { value: "10" },
    });

    fireEvent.change(screen.getByPlaceholderText("medications.notesPlaceholder"), {
      target: { value: "long-term regimen" },
    });

    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          custom_name: "Metformin",
          status: "active",
          intake_unit: "pill",
          dose_definition: { intake: { amount: 2, unit: "pill" }, active: [] },
          intake_advice_type: "custom",
          intake_advice_text: "After breakfast only",
          schedule: { mode: "interval_hours", interval: { every: 8 }, amount: 2 },
          duration: expect.objectContaining({ type: "endless", start_date: expect.any(String) }),
          inventory: {
            enabled: true,
            current_amount: 50,
            refill_threshold_amount: 10,
            unit: "pill",
            auto_decrement_on_taken: true,
          },
          notes: "long-term regimen",
        }),
      );
    });
  });

  it("auto-matches regimen by typed one-time name when no explicit selection is made", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    hookMocks.useRegimens.mockReturnValue({
      data: [
        makeRegimen({ id: "reg-42", custom_name: "Aspirin" }),
        makeRegimen({ id: "reg-99", custom_name: "Other" }),
      ],
    });

    render(
      <MedicationForm
        mode="create"
        personId="person-1"
        defaultKind="one_time"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("medications.namePlaceholder"), {
      target: { value: " aspirin " },
    });
    fireEvent.change(screen.getByLabelText("medications.scheduledAt"), {
      target: { value: "2026-03-03T09:00" },
    });
    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        addToRegimenId: "reg-42",
        scheduled_at: new Date("2026-03-03T09:00").toISOString(),
        amount: 1,
        unit: "pill",
        notes: null,
      });
    });
  });

  it("submits one-time edit payload", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MedicationForm
        mode="edit"
        personId="person-1"
        defaultKind="one_time"
        initial={makeRegimen({
          custom_name: "Ibuprofen",
          schedule: { mode: "one_off", due_at: "2026-03-04T08:30:00.000Z" } as MedSchedule,
          dose_definition: { intake: { amount: 2, unit: "pill" }, active: [] },
        } as unknown as MedRegimen)}
        onSubmit={onSubmit as (data: CreateMedRegimenInput | UpdateMedRegimenInput) => void}
      />,
    );

    fireEvent.change(screen.getByLabelText("medications.scheduledAt"), {
      target: { value: "2026-03-05T07:15" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        custom_name: "Ibuprofen",
        intake_unit: "pill",
        dose_definition: { intake: { amount: 2, unit: "pill" }, active: [] },
        intake_advice_type: "none",
        intake_advice_text: null,
        schedule: { mode: "one_off", due_at: new Date("2026-03-05T07:15").toISOString() },
        duration: { type: "endless" },
        inventory: null,
        notes: null,
      });
    });
  });

  it("keeps weekly per-slot amounts when an unrelated field is edited", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MedicationForm
        mode="edit"
        personId="person-1"
        initial={makeRegimen({
          custom_name: "Methotrexate",
          dose_definition: { intake: { amount: 0.5, unit: "pill" }, active: [] },
          schedule: {
            mode: "days_of_week",
            days_of_week: [1, 4],
            times: ["09:00", "20:00"],
            amounts: [0.5, 1.5],
          } as MedSchedule,
        })}
        onSubmit={onSubmit as (data: CreateMedRegimenInput | UpdateMedRegimenInput) => void}
      />,
    );

    fireEvent.change(screen.getByLabelText(/medications\.notes/), {
      target: { value: "half in the morning" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: "half in the morning",
          dose_definition: { intake: { amount: 0.5, unit: "pill" }, active: [] },
          schedule: {
            mode: "days_of_week",
            days_of_week: [1, 4],
            times: ["09:00", "20:00"],
            amounts: [0.5, 1.5],
          },
        }),
      );
    });
  });

  it("edits a weekly per-slot amount and leaves the other slot alone", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MedicationForm
        mode="edit"
        personId="person-1"
        initial={makeRegimen({
          schedule: {
            mode: "days_of_week",
            days_of_week: [1, 4],
            times: ["09:00", "20:00"],
            amounts: [0.5, 1.5],
          } as MedSchedule,
        })}
        onSubmit={onSubmit as (data: CreateMedRegimenInput | UpdateMedRegimenInput) => void}
      />,
    );

    const amountInputs = screen.getAllByLabelText("medications.amountPerIntake");
    expect(amountInputs).toHaveLength(2);
    expect(amountInputs[1]).toHaveValue("1.5");

    fireEvent.change(amountInputs[1], { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: expect.objectContaining({ mode: "days_of_week", amounts: [0.5, 2] }),
        }),
      );
    });
  });

  it("keeps a weekly course on its base amount when no slot overrides it", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MedicationForm
        mode="edit"
        personId="person-1"
        initial={makeRegimen({
          dose_definition: { intake: { amount: 2, unit: "pill" }, active: [] },
          schedule: {
            mode: "days_of_week",
            days_of_week: [1, 4],
            times: ["09:00"],
          } as MedSchedule,
        })}
        onSubmit={onSubmit as (data: CreateMedRegimenInput | UpdateMedRegimenInput) => void}
      />,
    );

    expect(screen.getByLabelText("medications.amountPerIntake")).toHaveValue("2");

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          dose_definition: { intake: { amount: 2, unit: "pill" }, active: [] },
          schedule: { mode: "days_of_week", days_of_week: [1, 4], times: ["09:00"] },
        }),
      );
    });
  });

  it("keeps daily and interval-hours amounts across an unrelated edit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    const { unmount } = render(
      <MedicationForm
        mode="edit"
        personId="person-1"
        initial={makeRegimen({
          dose_definition: { intake: { amount: 0.5, unit: "pill" }, active: [] },
          schedule: {
            mode: "daily_times",
            times: ["09:00", "20:00"],
            amounts: [0.5, 1.5],
          } as MedSchedule,
        })}
        onSubmit={onSubmit as (data: CreateMedRegimenInput | UpdateMedRegimenInput) => void}
      />,
    );

    fireEvent.change(screen.getByLabelText(/medications\.notes/), { target: { value: "note" } });
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: { mode: "daily_times", times: ["09:00", "20:00"], amounts: [0.5, 1.5] },
        }),
      );
    });

    unmount();
    onSubmit.mockClear();

    render(
      <MedicationForm
        mode="edit"
        personId="person-1"
        initial={makeRegimen({
          dose_definition: { intake: { amount: 1.5, unit: "pill" }, active: [] },
          schedule: { mode: "interval_hours", interval: { every: 6 }, amount: 1.5 } as MedSchedule,
        })}
        onSubmit={onSubmit as (data: CreateMedRegimenInput | UpdateMedRegimenInput) => void}
      />,
    );

    fireEvent.change(screen.getByLabelText(/medications\.notes/), { target: { value: "note" } });
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          dose_definition: { intake: { amount: 1.5, unit: "pill" }, active: [] },
          schedule: { mode: "interval_hours", interval: { every: 6 }, amount: 1.5 },
        }),
      );
    });
  });

  it("validates and progresses mobile wizard before submit", async () => {
    hookMocks.useIsMobile.mockReturnValue(true);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<MedicationForm mode="create" personId="person-1" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "common.next" }));
    expect(screen.getByRole("alert")).toHaveTextContent("medications.validationNameRequired");

    fireEvent.change(screen.getByLabelText("medications.name"), {
      target: { value: "Calcium" },
    });
    await user.click(screen.getByRole("button", { name: "common.next" }));

    await user.click(screen.getByRole("button", { name: "medications.endTypeDaysFromStart" }));
    fireEvent.change(screen.getByLabelText("medications.daysFromStartCount"), {
      target: { value: "0" },
    });
    await user.click(screen.getByRole("button", { name: "common.next" }));
    expect(screen.getByRole("alert")).toHaveTextContent("medications.daysCountRequired");

    fireEvent.change(screen.getByLabelText("medications.daysFromStartCount"), {
      target: { value: "5" },
    });
    await user.click(screen.getByRole("button", { name: "common.next" }));
    await user.click(screen.getByRole("button", { name: "common.next" }));
    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          custom_name: "Calcium",
          duration: expect.objectContaining({ type: "for_days", days: 5 }),
        }),
      );
    });
  }, 15000);
});

describe("medication-form helpers", () => {
  it("formats datetime-local strings and reminder slots", () => {
    expect(toDatetimeLocalString(new Date("2026-03-01T09:05:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );

    expect(getReminderSlotsForIntakesPerDay(0)).toEqual([{ time: "09:00", amount: 1 }]);
    expect(getReminderSlotsForIntakesPerDay(3)).toEqual([
      { time: "09:00", amount: 1 },
      { time: "15:00", amount: 1 },
      { time: "20:00", amount: 1 },
    ]);
    expect(getReminderSlotsForIntakesPerDay(6).map((s) => s.time)).toEqual([
      "07:00",
      "09:00",
      "10:00",
      "12:00",
      "14:00",
      "15:00",
    ]);
  });

  it("normalizes initial schedule variants", () => {
    expect(getInitialSchedule(null, "one_time" as MedicationKind)).toEqual({
      mode: "one_off",
      due_at: "",
    });
    expect(
      getInitialSchedule(
        {
          schedule: { mode: "daily_times" },
        } as MedRegimen,
        undefined,
      ),
    ).toEqual({ mode: "daily_times", times: ["09:00"], amounts: [1] });
    expect(
      getInitialSchedule(
        {
          schedule: { mode: "interval_hours", interval: {}, amount: 0 },
        } as MedRegimen,
        undefined,
      ),
    ).toEqual({ mode: "interval_hours", interval: { every: 1 }, amount: 1 });
    expect(
      getInitialSchedule(
        {
          schedule: { mode: "interval_days", interval: {}, time_of_day: "11:00" },
        } as MedRegimen,
        undefined,
      ),
    ).toEqual({ mode: "interval_days", interval: { every: 1 }, times: ["11:00"], amounts: [1] });
    expect(
      getInitialSchedule(
        {
          schedule: { mode: "days_of_week" },
        } as MedRegimen,
        undefined,
      ),
    ).toEqual({ mode: "days_of_week", days_of_week: [1, 2, 3, 4, 5], times: ["09:00"] });
    expect(
      getInitialSchedule(
        {
          schedule: {
            mode: "days_of_week",
            days_of_week: [1, 4],
            times: ["09:00", "20:00"],
            amounts: [0.5, 1.5],
          },
        } as MedRegimen,
        undefined,
      ),
    ).toEqual({
      mode: "days_of_week",
      days_of_week: [1, 4],
      times: ["09:00", "20:00"],
      amounts: [0.5, 1.5],
    });
    expect(
      getInitialSchedule(
        {
          schedule: { mode: "unsupported" },
        } as unknown as MedRegimen,
        undefined,
      ),
    ).toEqual({ mode: "daily_times", times: ["09:00"], amounts: [1] });
  });

  it("normalizes initial duration and legacy intake advice", () => {
    expect(getInitialDuration(null)).toEqual({ type: "endless" });
    expect(
      getInitialDuration({
        duration: { type: "until_date", start_date: "2026-01-01" },
      } as MedRegimen),
    ).toEqual({ type: "until_date", end_date: "", start_date: "2026-01-01" });
    expect(
      getInitialDuration({
        duration: { type: "for_days", start_date: "2026-01-01" },
      } as MedRegimen),
    ).toEqual({ type: "for_days", days: 1, start_date: "2026-01-01" });
    expect(
      getInitialDuration({
        duration: { type: "endless", start_date: "2026-01-01" },
      } as MedRegimen),
    ).toEqual({ type: "endless", start_date: "2026-01-01" });

    expect(getInitialStartDate(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      getInitialStartDate({
        duration: { type: "endless", start_date: "2026-01-15" },
      } as MedRegimen),
    ).toBe("2026-01-15");

    expect(mapLegacyIntakeAdvice(null)).toBe("");
    expect(mapLegacyIntakeAdvice("with_breakfast")).toBe("with_meal");
    expect(mapLegacyIntakeAdvice("before_meal")).toBe("before_meal");
    expect(mapLegacyIntakeAdvice("unknown")).toBe("");
  });
});

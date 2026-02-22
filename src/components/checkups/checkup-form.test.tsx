import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckupItem, Condition } from "@/types";
import { CheckupForm } from "./checkup-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

const condition: Condition = {
  id: "condition-1",
  person_id: "person-1",
  name: "Hypertension",
  icd_name_en: null,
  icd_name_ru: null,
  code: "I10",
  current_status: "active",
  onset_date: null,
  resolved_date: null,
  notes: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
};

function initialCheckup(overrides: Partial<CheckupItem> = {}): CheckupItem {
  return {
    id: "checkup-1",
    person_id: "person-1",
    title: "Annual blood work",
    category: "lab",
    schedule: { type: "interval", every: 6, unit: "month", next_due_from: "completion" },
    next_due_at: "2026-07-01",
    status: "active",
    reminder_days_before: [7, 1],
    planned_on: null,
    why_text: "Baseline check",
    why_links: [{ type: "condition", id: "condition-1", label: "Hypertension" }],
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("CheckupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates custom recurring schedule with linked condition and sorted reminder days", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <CheckupForm
        mode="create"
        personId="person-1"
        conditions={[condition]}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("checkups.itemTitle *"), {
      target: { value: "Blood pressure panel" },
    });
    await user.click(screen.getByRole("button", { name: "checkups.customFrequency" }));

    const customEveryInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(customEveryInput, { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "checkups.weeks" }));

    await user.click(screen.getByRole("button", { name: "checkups.anchorCustom" }));
    const customAnchorInput = document.querySelector("input[type='date']") as HTMLInputElement;
    fireEvent.change(customAnchorInput, { target: { value: "2026-03-01" } });

    await user.click(screen.getByRole("button", { name: "checkups.nextDueFromTarget" }));

    const reminderInputs = screen.getAllByLabelText("checkups.reminderDaysBeforeAria");
    fireEvent.change(reminderInputs[0], { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "checkups.addReminderDay" }));

    const reminderInputsUpdated = screen.getAllByLabelText("checkups.reminderDaysBeforeAria");
    fireEvent.change(reminderInputsUpdated[1], { target: { value: "10" } });

    fireEvent.change(screen.getByLabelText("checkups.why"), {
      target: { value: "Monitor pressure trend" },
    });
    await user.click(screen.getByRole("button", { name: /Hypertension/ }));

    await user.click(screen.getByRole("button", { name: "checkups.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        person_id: "person-1",
        title: "Blood pressure panel",
        category: "visit",
        schedule: {
          type: "interval",
          every: 2,
          unit: "week",
          anchor_date: "2026-03-01",
          next_due_from: "target",
        },
        reminder_days_before: [10, 3],
        why_text: "Monitor pressure trend",
        why_links: [{ type: "condition", id: "condition-1", label: "Hypertension" }],
      });
    });
  }, 15000);

  it("requires one-off due date and submits once provided", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<CheckupForm mode="create" personId="person-1" conditions={[]} onSubmit={onSubmit} />);

    expect(screen.getByText("checkups.linkedConditionsGoToConditions")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("checkups.itemTitle *"), {
      target: { value: "Flu vaccine" },
    });
    await user.click(screen.getByRole("button", { name: "checkups.oneOff" }));
    await user.click(screen.getByRole("button", { name: "checkups.add" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("checkups.dueDate"), {
      target: { value: "2026-11-15" },
    });
    await user.click(screen.getByRole("button", { name: "checkups.add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        person_id: "person-1",
        title: "Flu vaccine",
        category: "visit",
        schedule: {
          type: "one_off",
          due_at: "2026-11-15",
        },
        reminder_days_before: [7],
        why_text: null,
        why_links: [],
      });
    });
  });

  it("submits edit payload without person id", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <CheckupForm
        mode="edit"
        personId="person-1"
        initial={initialCheckup()}
        conditions={[condition]}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("checkups.itemTitle *"), {
      target: { value: "Updated annual panel" },
    });
    await user.click(screen.getByRole("button", { name: "checkups.categoryDental" }));
    await user.click(screen.getByRole("button", { name: "checkups.oneOff" }));
    fireEvent.change(screen.getByLabelText("checkups.dueDate"), {
      target: { value: "2026-08-20" },
    });
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: "Updated annual panel",
        category: "dental",
        schedule: {
          type: "one_off",
          due_at: "2026-08-20",
        },
        reminder_days_before: [7, 1],
        why_text: "Baseline check",
        why_links: [{ type: "condition", id: "condition-1", label: "Hypertension" }],
      });
    });
  });
});

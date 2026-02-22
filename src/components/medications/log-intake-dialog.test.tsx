import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MedRegimen } from "@/types/regimen";
import { LogIntakeDialog } from "./log-intake-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

function regimen(overrides: Partial<MedRegimen> = {}): MedRegimen {
  return {
    id: "reg-1",
    person_id: "person-1",
    custom_name: "Vitamin D",
    status: "active",
    intake_unit: "pill",
    dose_definition: { intake: { amount: 2, unit: "pill" }, active: [] },
    intake_advice_type: "none",
    intake_advice_text: null,
    schedule: { mode: "daily_times", times: ["09:00"], amounts: [2] },
    duration: { type: "endless", start_date: "2026-01-01" },
    reminder_prefs: null,
    inventory: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("LogIntakeDialog", () => {
  it("submits taken amount and note", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <LogIntakeDialog open onOpenChange={onOpenChange} regimen={regimen()} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText(/medications\.logIntakeAmount/), {
      target: { value: "2.1" },
    });
    fireEvent.change(screen.getByLabelText("medications.note"), {
      target: { value: "after meal" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        regimen_id: "reg-1",
        amount: 2.1,
        skipped: false,
        note: "after meal",
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits skipped intake with zero amount and hides amount field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<LogIntakeDialog open onOpenChange={vi.fn()} regimen={regimen()} onSubmit={onSubmit} />);

    await user.click(screen.getByLabelText("medications.logIntakeSkipped"));
    expect(screen.queryByLabelText("medications.logIntakeAmount")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        regimen_id: "reg-1",
        amount: 0,
        skipped: true,
        note: null,
      });
    });
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MedDoseEventWithRegimen } from "@/types/regimen";
import { EditIntakeDialog } from "./edit-intake-dialog";

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

function event(overrides: Partial<MedDoseEventWithRegimen> = {}): MedDoseEventWithRegimen {
  return {
    id: "event-1",
    person_id: "person-1",
    regimen_id: "reg-1",
    scheduled_at: "2026-02-22T09:00:00.000Z",
    actual_at: "2026-02-22T09:00:00.000Z",
    planned_intake: { intake: { amount: 1, unit: "pill" }, active: [] },
    status: "taken",
    taken_at: "2026-02-22T09:10:00.000Z",
    note: "initial",
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

describe("EditIntakeDialog", () => {
  it("submits edited taken intake with amount and note", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <EditIntakeDialog open onOpenChange={onOpenChange} event={event()} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText("medications.editIntakeTime"), {
      target: { value: "2026-02-22T10:15" },
    });
    fireEvent.change(screen.getByLabelText("medications.editIntakeAmount"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("medications.note"), {
      target: { value: "updated note" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        takenAt: new Date("2026-02-22T10:15").toISOString(),
        amountTaken: 3,
        note: "updated note",
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps a fractional amount instead of truncating it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<EditIntakeDialog open onOpenChange={vi.fn()} event={event()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("medications.editIntakeAmount"), {
      target: { value: "0.5" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amountTaken: 0.5 }));
    });
  });

  it("submits skipped intake without amount", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <EditIntakeDialog
        open
        onOpenChange={onOpenChange}
        event={event({ status: "skipped", taken_at: null })}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText("medications.editIntakeAmount")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("medications.editIntakeTime"), {
      target: { value: "2026-02-22T11:00" },
    });
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        takenAt: new Date("2026-02-22T11:00").toISOString(),
        amountTaken: undefined,
        note: "initial",
      });
    });
  });

  it("does not submit when datetime value is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<EditIntakeDialog open onOpenChange={vi.fn()} event={event()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("medications.editIntakeTime"), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

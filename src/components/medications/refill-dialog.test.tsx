import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MedRegimen } from "@/types/regimen";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("RefillDialog", () => {
  it("submits refill amount, closes dialog, and resets amount", async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    const { RefillDialog } = await import("./refill-dialog");
    const { rerender } = render(
      <RefillDialog
        open
        onOpenChange={onOpenChange}
        regimen={{ custom_name: "Vitamin D", intake_unit: "pill" } as MedRegimen}
        onSubmit={onSubmit}
      />,
    );

    const user = userEvent.setup();
    const amountInput = screen.getByLabelText("medications.refillAmountLabel");
    await user.clear(amountInput);
    await user.type(amountInput, "5");
    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(5);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    rerender(
      <RefillDialog
        open
        onOpenChange={onOpenChange}
        regimen={{ custom_name: "Vitamin D", intake_unit: "pill" } as MedRegimen}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText("medications.refillAmountLabel")).toHaveValue("1");
  });

  it("keeps invalid refills open and accepts a negative inventory correction", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const medication = { custom_name: "Vitamin D", intake_unit: "pill" } as MedRegimen;
    const { RefillDialog } = await import("./refill-dialog");
    function ControlledDialog({ regimen }: { regimen: MedRegimen | null }) {
      const [open, setOpen] = React.useState(true);
      return (
        <RefillDialog open={open} onOpenChange={setOpen} regimen={regimen} onSubmit={onSubmit} />
      );
    }
    const { rerender } = render(<ControlledDialog regimen={medication} />);

    const user = userEvent.setup();
    const amountInput = screen.getByLabelText("medications.refillAmountLabel");
    await user.clear(amountInput);
    await user.type(amountInput, "0");
    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.clear(amountInput);
    await user.type(amountInput, "abc");
    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();

    rerender(<ControlledDialog regimen={null} />);
    await user.type(amountInput, "-3");
    expect(amountInput).toHaveValue("-3");
    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();

    rerender(<ControlledDialog regimen={medication} />);
    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(-3);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows pending state during submit and supports cancel close", async () => {
    const onOpenChange = vi.fn();
    let resolveSubmit: (() => void) | null = null;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { RefillDialog } = await import("./refill-dialog");
    render(
      <RefillDialog
        open
        onOpenChange={onOpenChange}
        regimen={{ custom_name: "Vitamin D", intake_unit: "pill" } as MedRegimen}
        onSubmit={onSubmit}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "medications.refillButton" }));
    expect(screen.getByRole("button", { name: "medications.refillButton" })).toBeDisabled();
    expect(document.querySelector(".animate-spin")).toBeTruthy();

    (resolveSubmit as (() => void) | null)?.();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

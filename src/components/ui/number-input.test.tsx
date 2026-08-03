import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NumberInput, parseNumericInput, sanitizeNumericInput } from "./number-input";

describe("sanitizeNumericInput", () => {
  it("keeps digits and a single decimal point", () => {
    expect(sanitizeNumericInput("1.5")).toBe("1.5");
  });

  it("normalises a decimal comma to a dot", () => {
    expect(sanitizeNumericInput("0,5")).toBe("0.5");
  });

  it("preserves incomplete input so typing can continue", () => {
    expect(sanitizeNumericInput("1.")).toBe("1.");
    expect(sanitizeNumericInput("")).toBe("");
  });

  // Truncating rather than skipping matters for dosing: joining digits across a
  // dropped character would turn a half-pill into twelve pills.
  it("truncates at the first character that cannot continue the number", () => {
    expect(sanitizeNumericInput("1/2")).toBe("1");
    expect(sanitizeNumericInput("1.5.2")).toBe("1.5");
    expect(sanitizeNumericInput("1a2 pills")).toBe("1");
    expect(sanitizeNumericInput("5 pills")).toBe("5");
    expect(sanitizeNumericInput("abc")).toBe("");
  });

  it("truncates at the separator in integer mode rather than joining digits", () => {
    expect(sanitizeNumericInput("1.5", { integer: true })).toBe("1");
    expect(sanitizeNumericInput("1,5", { integer: true })).toBe("1");
  });

  it("allows a leading minus only when permitted", () => {
    expect(sanitizeNumericInput("-3", { allowNegative: true })).toBe("-3");
    expect(sanitizeNumericInput("-3")).toBe("");
    expect(sanitizeNumericInput("3-4", { allowNegative: true })).toBe("3");
  });
});

describe("parseNumericInput", () => {
  it("parses complete numbers", () => {
    expect(parseNumericInput("0.5")).toBe(0.5);
    expect(parseNumericInput("-3")).toBe(-3);
  });

  it("treats empty and incomplete input as null", () => {
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput(".")).toBeNull();
    expect(parseNumericInput("-")).toBeNull();
  });
});

/** Mirrors how callers hold numeric state: ignore null so the field can be cleared. */
function Harness({
  initial = 1,
  ...props
}: { initial?: number } & Partial<React.ComponentProps<typeof NumberInput>>) {
  const [value, setValue] = React.useState(initial);
  return (
    <NumberInput
      aria-label="amount"
      value={value}
      onValueChange={(n) => {
        if (n !== null) setValue(n);
      }}
      {...props}
    />
  );
}

describe("NumberInput", () => {
  it("accepts a fractional dose typed with a dot", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("amount");

    await user.clear(input);
    await user.type(input, "1.5");

    expect(input).toHaveValue("1.5");
  });

  it("accepts a decimal comma", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<NumberInput aria-label="amount" value={1} onValueChange={onValueChange} />);

    const user2 = user;
    await user2.clear(screen.getByLabelText("amount"));
    await user2.type(screen.getByLabelText("amount"), "0,5");

    expect(onValueChange).toHaveBeenLastCalledWith(0.5, "0.5");
  });

  it("stays empty while focused after clearing — the field is not re-filled", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("amount");

    await user.clear(input);

    expect(input).toHaveValue("");
  });

  it("replaces the default value instead of appending to it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("amount");

    // Tapping an unfocused field selects its contents, so typing replaces
    // the default "1" instead of producing "12".
    await user.type(input, "2");

    expect(input).toHaveValue("2");
  });

  it("restores the last accepted value when the user clears and leaves", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness initial={3} />
        <button type="button">elsewhere</button>
      </>,
    );
    const input = screen.getByLabelText("amount");

    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(input).toHaveValue("3");
  });

  it("adopts external value changes while unfocused", () => {
    const { rerender } = render(
      <NumberInput aria-label="amount" value={1} onValueChange={vi.fn()} />,
    );
    rerender(<NumberInput aria-label="amount" value={2.5} onValueChange={vi.fn()} />);

    expect(screen.getByLabelText("amount")).toHaveValue("2.5");
  });

  it("uses a decimal keypad by default and a numeric one in integer mode", () => {
    const { rerender } = render(
      <NumberInput aria-label="amount" value={1} onValueChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("amount")).toHaveAttribute("inputmode", "decimal");

    rerender(<NumberInput aria-label="amount" integer value={1} onValueChange={vi.fn()} />);
    expect(screen.getByLabelText("amount")).toHaveAttribute("inputmode", "numeric");
  });
});

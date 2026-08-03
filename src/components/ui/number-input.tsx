"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * Keep the leading run of characters that forms a number, normalising the
 * decimal comma (Russian keyboards emit ",") to a dot. Intermediate states like
 * "", "1." and "-" are intentionally preserved so the user can keep typing.
 *
 * Input is truncated at the first character that cannot continue the number
 * rather than having that character skipped. Skipping would join digits across
 * the gap and silently inflate the value — pasting "1/2" would become 12 pills
 * rather than a half, and "1.5" in integer mode would become 15 days. Keeping
 * only the valid prefix can only ever yield a value at or below what was typed.
 */
export function sanitizeNumericInput(
  raw: string,
  options: { integer?: boolean; allowNegative?: boolean } = {},
): string {
  const { integer = false, allowNegative = false } = options;
  let out = "";
  let seenDot = false;
  for (const char of raw.replace(/,/g, ".")) {
    if (char >= "0" && char <= "9") {
      out += char;
      continue;
    }
    if (char === "-" && allowNegative && out === "") {
      out += char;
      continue;
    }
    if (char === "." && !integer && !seenDot) {
      seenDot = true;
      out += char;
      continue;
    }
    break;
  }
  return out;
}

/** Parse a sanitized buffer, treating incomplete input ("", "-", ".") as empty. */
export function parseNumericInput(raw: string): number | null {
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBuffer(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  return String(value);
}

export interface NumberInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> {
  /** Current value. The component keeps its own raw buffer and re-syncs from this when unfocused. */
  value: number | string | null | undefined;
  /** Called on every keystroke with the parsed number (null while the input is empty/incomplete). */
  onValueChange: (parsed: number | null, raw: string) => void;
  /** Whole numbers only — drops the decimal separator and uses the numeric keypad. */
  integer?: boolean;
  /** Allow a leading minus (used by the refill dialog, where -3 is a correction). */
  allowNegative?: boolean;
  /** Select the current contents on focus so typing replaces them. Defaults to true. */
  selectOnFocus?: boolean;
}

/**
 * Numeric field backed by a raw string buffer.
 *
 * Deliberately `type="text"` rather than `type="number"`: a controlled
 * `type="number"` input reports `value === ""` while the user is mid-way
 * through typing "1.", so any numeric coercion wipes the pending dot and makes
 * the field impossible to clear. `inputMode` still gives phones a numeric
 * keypad, and dropping `step` removes the native validity check that rejects
 * fractional amounts.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onValueChange,
      integer = false,
      allowNegative = false,
      selectOnFocus = true,
      onFocus,
      onBlur,
      ...props
    },
    forwardedRef,
  ) => {
    const [buffer, setBuffer] = React.useState(() => toBuffer(value));
    const focusedRef = React.useRef(false);

    // Adopt external changes (dialog reopen, schedule-mode switch, quick-set
    // chips) but never while the field has focus — re-syncing mid-edit would
    // restore the value the user just cleared.
    React.useEffect(() => {
      if (focusedRef.current) return;
      setBuffer(toBuffer(value));
    }, [value]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = sanitizeNumericInput(event.target.value, { integer, allowNegative });
      setBuffer(next);
      onValueChange(parseNumericInput(next), next);
    };

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      focusedRef.current = true;
      if (selectOnFocus) event.target.select();
      onFocus?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      focusedRef.current = false;
      // Restore the last accepted value: normalises "1." to "1" and puts back
      // the previous number when the user cleared the field and walked away.
      setBuffer(toBuffer(value));
      onBlur?.(event);
    };

    return (
      <Input
        {...props}
        ref={forwardedRef}
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        value={buffer}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";

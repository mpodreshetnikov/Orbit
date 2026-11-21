import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats using Intl for valid currency", () => {
    expect(formatMoney(1234.5, "USD", "en-US")).toBe("$1,234.50");
  });

  it("falls back to simple format for invalid currency", () => {
    expect(formatMoney(12.3, "INVALID", "en-US")).toBe("12.30 INVALID");
  });

  it("guards NaN amount", () => {
    // Intl uses a non-breaking space between currency code and amount for RUB.
    expect(formatMoney(Number.NaN, "RUB", "en-US")).toBe("RUB\u00a00.00");
  });
});

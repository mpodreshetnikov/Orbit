import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats using Intl for valid currency", () => {
    const result = formatMoney(1234.5, "USD", "en-US");
    expect(result).toContain("$");
  });

  it("falls back to simple format for invalid currency", () => {
    const result = formatMoney(12.3, "INVALID", "en-US");
    expect(result).toBe("12.30 INVALID");
  });

  it("guards NaN amount", () => {
    const result = formatMoney(Number.NaN, "RUB", "en-US");
    expect(result).toContain("0");
  });
});

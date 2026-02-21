import { describe, expect, it } from "vitest";
import { getAppSection, isMoneySection } from "./app-section";

describe("app-section", () => {
  it("defaults to health for empty pathname", () => {
    expect(getAppSection()).toBe("health");
    expect(getAppSection(null)).toBe("health");
  });

  it("resolves money section by pathname prefix", () => {
    expect(getAppSection("/money")).toBe("money");
    expect(getAppSection("/money/transactions")).toBe("money");
    expect(isMoneySection("/money/accounts")).toBe(true);
  });

  it("keeps health for non-money paths", () => {
    expect(getAppSection("/health")).toBe("health");
    expect(isMoneySection("/health/records")).toBe(false);
  });
});

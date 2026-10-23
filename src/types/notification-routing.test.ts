import { describe, expect, it } from "vitest";
import { normalizeReminderTime, routingEnabled, routingUpsert } from "./notification-routing";

describe("notification routing", () => {
  it("follows a stored row, and otherwise turns on only the account's own person", () => {
    const row = { person_id: "p", enabled: false, custom_prefix: null };
    expect(routingEnabled(row, "me", "me")).toBe(false);
    expect(routingEnabled(undefined, "me", "me")).toBe(true);
    expect(routingEnabled(undefined, "someone", "me")).toBe(false);
    expect(routingEnabled(undefined, null, null)).toBe(false);
  });

  it("keeps a prefix only for someone else, and only when it says something", () => {
    expect(routingUpsert("p", true, " Пёс ", false)).toEqual({
      person_id: "p",
      enabled: true,
      custom_prefix: "Пёс",
    });
    expect(routingUpsert("p", true, "  ", false).custom_prefix).toBeNull();
    expect(routingUpsert("p", false, "Я", true).custom_prefix).toBeNull();
  });

  it("writes a reminder time as HH:MM", () => {
    expect(normalizeReminderTime("9:5")).toBe("09:05");
    expect(normalizeReminderTime(" ")).toBe("09:00");
    expect(normalizeReminderTime("7")).toBe("07:00");
    expect(normalizeReminderTime("ab:cd")).toBe("09:00");
  });
});

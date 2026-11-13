import { assertEquals } from "std/assert/assert-equals";
import { isNotificationWindowForUser } from "./window.ts";

Deno.test("isNotificationWindowForUser matches same-day windows", () => {
  const now = new Date(2026, 1, 21, 9, 10, 0, 0);
  assertEquals(isNotificationWindowForUser(now, "09:00", null), true);
  assertEquals(isNotificationWindowForUser(now, "08:00", null), false);
});

Deno.test("isNotificationWindowForUser uses half-open end (< not <=) at +30 minutes", () => {
  // Window is [start, start+30). At exactly +30 the user is outside — catches a <= regression.
  const atEnd = new Date(2026, 1, 21, 9, 30, 0, 0);
  assertEquals(isNotificationWindowForUser(atEnd, "09:00", null), false);
  const justInside = new Date(2026, 1, 21, 9, 29, 0, 0);
  assertEquals(isNotificationWindowForUser(justInside, "09:00", null), true);
});

Deno.test("isNotificationWindowForUser handles windows crossing midnight", () => {
  const now = new Date(2026, 1, 21, 0, 5, 0, 0);
  assertEquals(isNotificationWindowForUser(now, "23:45", null), true);
  assertEquals(isNotificationWindowForUser(now, "23:00", null), false);
});

Deno.test("isNotificationWindowForUser uses timezone conversion when provided", () => {
  const nowUtc = new Date("2026-02-21T14:05:00.000Z"); // 09:05 in America/New_York (EST)
  assertEquals(isNotificationWindowForUser(nowUtc, "09:00", "America/New_York"), true);
  assertEquals(isNotificationWindowForUser(nowUtc, "10:00", "America/New_York"), false);
});

Deno.test("isNotificationWindowForUser falls back for malformed notification time", () => {
  const now = new Date(2026, 1, 21, 9, 10, 0, 0);
  assertEquals(isNotificationWindowForUser(now, "not-a-time", null), true);
  assertEquals(isNotificationWindowForUser(now, "9", null), true);
});

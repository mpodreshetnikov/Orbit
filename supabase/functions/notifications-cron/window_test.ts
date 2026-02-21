import { assertEquals } from "std/assert/assert-equals";
import { isNotificationWindowForUser } from "./window.ts";

Deno.test("isNotificationWindowForUser matches same-day windows", () => {
  const now = new Date(2026, 1, 21, 9, 10, 0, 0);
  assertEquals(isNotificationWindowForUser(now, "09:00", null), true);
  assertEquals(isNotificationWindowForUser(now, "08:00", null), false);
});

Deno.test("isNotificationWindowForUser handles windows crossing midnight", () => {
  const now = new Date(2026, 1, 21, 0, 5, 0, 0);
  assertEquals(isNotificationWindowForUser(now, "23:45", null), true);
  assertEquals(isNotificationWindowForUser(now, "23:00", null), false);
});

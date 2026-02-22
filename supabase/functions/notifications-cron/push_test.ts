import { assertEquals } from "std/assert/assert-equals";
import { aggregateMedicationNotifications, buildPushPayload } from "./push.ts";
import type { NotificationItem } from "./digest.ts";

Deno.test(
  "aggregateMedicationNotifications groups by person and preserves earliest schedule",
  () => {
    const notifications: NotificationItem[] = [
      {
        id: "dig-1",
        type: "medication",
        title: "Meds",
        body: "",
        url: "/",
        scheduledAt: "2026-01-01T09:05:00.000Z",
        personId: "p1",
        personName: "Alice",
        dose_event_id: "dose-1",
        medicationName: "Vitamin D",
        amount: "1",
        unit: "pill",
        timeStr: "09:00",
      },
      {
        id: "dig-2",
        type: "medication",
        title: "Meds",
        body: "",
        url: "/",
        scheduledAt: "2026-01-01T08:55:00.000Z",
        personId: "p1",
        personName: "Alice",
        dose_event_id: "dose-2",
        medicationName: "Magnesium",
        amount: "2",
        unit: "pill",
        timeStr: "09:00",
      },
    ];

    const grouped = aggregateMedicationNotifications(notifications);
    assertEquals(grouped.length, 1);
    assertEquals(grouped[0].scheduledAt, "2026-01-01T08:55:00.000Z");
    assertEquals(grouped[0].dose_event_ids, ["dose-1", "dose-2"]);
    assertEquals(grouped[0].medItems.length, 2);
  },
);

Deno.test("buildPushPayload combines aggregated medication and regular notifications", () => {
  const notifications: NotificationItem[] = [
    {
      id: "dig-1",
      type: "medication",
      title: "Meds",
      body: "",
      url: "/",
      scheduledAt: "2026-01-01T09:00:00.000Z",
      personId: "p1",
      dose_event_id: "dose-1",
      medicationName: "Vitamin D",
      amount: "1",
      unit: "pill",
      timeStr: "09:00",
    },
    {
      id: "dig-2",
      type: "checkup",
      title: "Checkup reminder",
      body: "Time for checkup",
      url: "/health/checkups",
      scheduledAt: "2026-01-01T09:00:00.000Z",
      personId: "p1",
    },
  ];

  const payload = buildPushPayload(notifications);
  assertEquals(payload.length, 2);
  const first = payload[0] as { type: string };
  const second = payload[1] as { type: string };
  assertEquals(first.type, "medication");
  assertEquals(second.type, "checkup");
});

Deno.test("aggregateMedicationNotifications handles unknown person and body fallback", () => {
  const notifications: NotificationItem[] = [
    {
      id: "dig-1",
      type: "medication",
      title: "Meds",
      body: "",
      url: "/",
      scheduledAt: "2026-01-01T09:00:00.000Z",
      personId: null,
      personName: null,
      titlePrefix: null,
      medicationName: "Omega 3",
      amount: "2",
      unit: "capsule",
      timeStr: "09:00",
    },
    {
      id: "dig-2",
      type: "medication_snoozed",
      title: "Meds",
      body: "Take immediately",
      url: "/",
      scheduledAt: "2026-01-01T09:10:00.000Z",
      personId: null,
      personName: null,
      titlePrefix: null,
      medicationName: null,
      amount: null,
      unit: null,
      timeStr: null,
    },
  ];

  const grouped = aggregateMedicationNotifications(notifications);
  assertEquals(grouped.length, 1);
  assertEquals(grouped[0].person_id, null);
  assertEquals(grouped[0].medItems.length, 2);
  assertEquals(grouped[0].medItems[0].body, "2 capsule · 09:00");
  assertEquals(grouped[0].medItems[1].body, "Take immediately");
});

Deno.test("buildPushPayload includes dose_event_ids only when available", () => {
  const payload = buildPushPayload([
    {
      id: "dig-1",
      type: "checkup",
      title: "Checkup",
      body: "Time",
      url: "/health/checkups",
      scheduledAt: "2026-01-01T10:00:00.000Z",
      personId: "p1",
      dose_event_id: "dose-1",
    },
    {
      id: "dig-2",
      type: "checkup",
      title: "Checkup 2",
      body: "Time",
      url: "/health/checkups",
      scheduledAt: "2026-01-01T10:10:00.000Z",
      personId: "p1",
    },
  ]);

  assertEquals(payload.length, 2);
  const withDose = payload[0] as { dose_event_ids?: string[] };
  const withoutDose = payload[1] as { dose_event_ids?: string[] };
  assertEquals(withDose.dose_event_ids, ["dose-1"]);
  assertEquals(withoutDose.dose_event_ids, undefined);
});

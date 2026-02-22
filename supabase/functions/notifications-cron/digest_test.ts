import { assertEquals } from "std/assert/assert-equals";
import {
  filterUnsentRowsByAllowedPersons,
  mapDigestRowsToNotifications,
  type NotificationDigestRow,
  type RoutedPersonRow,
} from "./digest.ts";

Deno.test("filterUnsentRowsByAllowedPersons keeps global rows and allowed person rows", () => {
  const rows: NotificationDigestRow[] = [
    {
      id: "global",
      type: "checkup",
      scheduled_at: "2026-01-01T00:00:00.000Z",
      payload_json: {},
      person_id: null,
    },
    {
      id: "allowed",
      type: "checkup",
      scheduled_at: "2026-01-01T00:00:00.000Z",
      payload_json: {},
      person_id: "p1",
    },
    {
      id: "blocked",
      type: "checkup",
      scheduled_at: "2026-01-01T00:00:00.000Z",
      payload_json: {},
      person_id: "p2",
    },
  ];

  const routedPersons: RoutedPersonRow[] = [
    { person_id: "p1", person_name: "Alice", custom_prefix: null, person_owner_user_id: "u1" },
  ];

  const filtered = filterUnsentRowsByAllowedPersons(rows, routedPersons);
  assertEquals(
    filtered.map((item) => item.id),
    ["global", "allowed"],
  );
});

Deno.test(
  "mapDigestRowsToNotifications expands medication doses and filters refill outside window",
  () => {
    const rows: NotificationDigestRow[] = [
      {
        id: "med-1",
        type: "medication",
        scheduled_at: "2026-01-01T09:00:00.000Z",
        person_id: "p1",
        payload_json: {
          title: "Medication",
          body: "take meds",
          url: "/",
          doses: [
            {
              dose_event_id: "dose-1",
              medication_name: "Vitamin D",
              amount: "1",
              unit: "pill",
              time_str: "09:00",
            },
            {
              dose_event_id: "dose-2",
              medication_name: "Magnesium",
              amount: "2",
              unit: "pill",
              time_str: "09:00",
            },
          ],
        },
      },
      {
        id: "refill-1",
        type: "medication_refill",
        scheduled_at: "2026-01-01T09:00:00.000Z",
        person_id: "p1",
        payload_json: {
          title: "Refill",
          body: "buy meds",
          url: "/health/medications",
        },
      },
    ];

    const routedPersons: RoutedPersonRow[] = [
      { person_id: "p1", person_name: "Alice", custom_prefix: null, person_owner_user_id: "u1" },
    ];

    const notificationsOutsideWindow = mapDigestRowsToNotifications(
      rows,
      routedPersons,
      "u1",
      false,
    );
    assertEquals(notificationsOutsideWindow.length, 2);
    assertEquals(
      notificationsOutsideWindow.map((item) => item.dose_event_id),
      ["dose-1", "dose-2"],
    );

    const notificationsInWindow = mapDigestRowsToNotifications(rows, routedPersons, "u1", true);
    assertEquals(notificationsInWindow.length, 3);
    assertEquals(notificationsInWindow[2].type, "medication_refill");
  },
);

Deno.test(
  "mapDigestRowsToNotifications handles medication payload without doses and title-prefix rules",
  () => {
    const rows: NotificationDigestRow[] = [
      {
        id: "med-single",
        type: "medication_snoozed",
        scheduled_at: "2026-01-01T10:00:00.000Z",
        person_id: "p1",
        payload_json: {
          title: "Medication",
          body: "Take now",
          url: "/health/medications",
          dose_event_id: "dose-9",
          medication_name: "Vitamin C",
          amount: "1",
          unit: "pill",
          time_str: "10:00",
          is_overdue_reminder: true,
          title_prefix: "Custom",
        },
      },
      {
        id: "check-1",
        type: "checkup",
        scheduled_at: "2026-01-01T09:00:00.000Z",
        person_id: "p2",
        payload_json: {
          title: "Checkup",
          body: "Do checkup",
          url: "/health/checkups",
        },
      },
    ];

    const routedPersons: RoutedPersonRow[] = [
      { person_id: "p1", person_name: "Alice", custom_prefix: "Alice", person_owner_user_id: "u1" },
      { person_id: "p2", person_name: "Bob", custom_prefix: "For Bob", person_owner_user_id: "u2" },
    ];

    const notifications = mapDigestRowsToNotifications(rows, routedPersons, "u1", true);
    assertEquals(notifications.length, 2);
    assertEquals(notifications[0].type, "medication_snoozed");
    assertEquals(notifications[0].dose_event_id, "dose-9");
    assertEquals(notifications[0].isOverdueReminder, true);
    assertEquals(notifications[0].titlePrefix, null); // own person ignores prefix
    assertEquals(notifications[1].titlePrefix, "For Bob");
  },
);

Deno.test(
  "mapDigestRowsToNotifications uses payload person fallback and defaults for empty payload",
  () => {
    const rows: NotificationDigestRow[] = [
      {
        id: "check-empty",
        type: "checkup",
        scheduled_at: "2026-01-01T09:00:00.000Z",
        person_id: null,
        payload_json: null,
      },
      {
        id: "check-payload-person",
        type: "checkup",
        scheduled_at: "2026-01-01T09:10:00.000Z",
        person_id: null,
        payload_json: {
          person_id: "p3",
          title: "Checkup",
        },
      },
    ];

    const routedPersons: RoutedPersonRow[] = [
      {
        person_id: "p3",
        person_name: "Cara",
        custom_prefix: "For Cara",
        person_owner_user_id: "u9",
      },
    ];

    const notifications = mapDigestRowsToNotifications(rows, routedPersons, "u1", true);
    assertEquals(notifications.length, 2);
    assertEquals(notifications[0].title, "");
    assertEquals(notifications[0].body, "");
    assertEquals(notifications[0].url, "/");
    assertEquals(notifications[1].personId, "p3");
    assertEquals(notifications[1].personName, "Cara");
    assertEquals(notifications[1].titlePrefix, "For Cara");
  },
);

Deno.test(
  "mapDigestRowsToNotifications keeps explicit null title_prefix and dose payload fallbacks",
  () => {
    const rows: NotificationDigestRow[] = [
      {
        id: "med-doses-fallback",
        type: "medication",
        scheduled_at: "2026-01-01T09:00:00.000Z",
        person_id: "p1",
        payload_json: {
          title: "Medication",
          body: "Use fallback body",
          title_prefix: null,
          doses: [
            {
              dose_event_id: "dose-1",
              medication_name: "Vitamin D",
            },
          ],
        },
      },
    ];

    const routedPersons: RoutedPersonRow[] = [
      {
        person_id: "p1",
        person_name: "Alice",
        custom_prefix: "For Alice",
        person_owner_user_id: "u2",
      },
    ];

    const notifications = mapDigestRowsToNotifications(rows, routedPersons, "u1", true);
    assertEquals(notifications.length, 1);
    assertEquals(notifications[0].titlePrefix, null);
    assertEquals(notifications[0].body, "Use fallback body");
    assertEquals(notifications[0].url, "/");
    assertEquals(notifications[0].amount, null);
    assertEquals(notifications[0].unit, null);
    assertEquals(notifications[0].timeStr, null);
  },
);

Deno.test(
  "mapDigestRowsToNotifications handles non-medication rows and own-person prefix removal",
  () => {
    const rows: NotificationDigestRow[] = [
      {
        id: "check-own",
        type: "checkup",
        scheduled_at: "2026-01-01T11:00:00.000Z",
        person_id: "p1",
        payload_json: {
          title: "Checkup",
          body: "Time",
          url: "/health/checkups",
        },
      },
    ];

    const routedPersons: RoutedPersonRow[] = [
      {
        person_id: "p1",
        person_name: "Alice",
        custom_prefix: "For Alice",
        person_owner_user_id: "u1",
      },
    ];

    const notifications = mapDigestRowsToNotifications(rows, routedPersons, "u1", true);
    assertEquals(notifications.length, 1);
    assertEquals(notifications[0].title, "Checkup");
    assertEquals(notifications[0].url, "/health/checkups");
    assertEquals(notifications[0].titlePrefix, null);
  },
);

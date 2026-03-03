import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface ServiceWorkerHarness {
  dispatchPush: (notifications: Record<string, unknown>[]) => Promise<void>;
  getActiveNotificationTags: () => string[];
}

function buildMedicationNotification(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "digest-1",
    type: "medication",
    title: "Medications",
    body: "",
    url: "/health/medications",
    scheduledAt: new Date().toISOString(),
    person_id: "person-1",
    dose_event_ids: ["dose-1"],
    medItems: [
      {
        medicationName: "Vitamin D",
        amount: "1",
        unit: "pill",
        body: "Vitamin D - 1 pill",
      },
    ],
    ...overrides,
  };
}

function createServiceWorkerHarness(options?: {
  forceEmptyGetNotifications?: boolean;
}): ServiceWorkerHarness {
  const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  const listeners = new Map<string, (event: unknown) => void>();
  const activeNotifications: Array<{
    options: NotificationOptions;
    data: unknown;
    close: () => void;
  }> = [];

  const registration = {
    scope: "https://example.test/",
    getNotifications: vi.fn(async () =>
      options?.forceEmptyGetNotifications ? [] : [...activeNotifications],
    ),
    showNotification: vi.fn(async (_title: string, optionsArg?: NotificationOptions) => {
      const options = optionsArg ?? {};
      const tag = typeof options.tag === "string" ? options.tag : null;
      if (tag) {
        for (let index = activeNotifications.length - 1; index >= 0; index -= 1) {
          if (activeNotifications[index].options.tag === tag) {
            activeNotifications[index].close();
          }
        }
      }

      const record = {
        options,
        data: options.data ?? {},
        close: () => {
          const itemIndex = activeNotifications.indexOf(record);
          if (itemIndex >= 0) {
            activeNotifications.splice(itemIndex, 1);
          }
        },
      };
      activeNotifications.push(record);
    }),
  };

  const selfObject = {
    location: { origin: "https://example.test" },
    navigator: { language: "en-US" },
    registration,
    Notification: { maxActions: 2 },
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    skipWaiting: vi.fn(),
    caches: undefined,
  };

  const context = {
    self: selfObject,
    Notification: selfObject.Notification,
    fetch: vi.fn(async () => ({ ok: true, status: 200 })),
    URL,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    Set,
    Date,
    Promise,
    Array,
    Object,
    Math,
  };
  vm.runInNewContext(source, context);

  return {
    dispatchPush: async (notifications) => {
      const pushHandler = listeners.get("push");
      if (!pushHandler) {
        throw new Error("Missing push event listener in service worker");
      }

      const waitUntilTasks: Promise<unknown>[] = [];
      pushHandler({
        data: {
          json: () => ({ notifications }),
        },
        waitUntil: (promise: Promise<unknown>) => {
          waitUntilTasks.push(Promise.resolve(promise));
        },
      });
      await Promise.all(waitUntilTasks);
    },
    getActiveNotificationTags: () =>
      activeNotifications
        .map((item) => item.options.tag)
        .filter((tag): tag is string => typeof tag === "string"),
  };
}

describe("service worker medication notification replacement", () => {
  it("uses a stable medication tag per person so repeat reminders replace prior ones", async () => {
    const harness = createServiceWorkerHarness({ forceEmptyGetNotifications: true });

    await harness.dispatchPush([buildMedicationNotification({ id: "digest-1" })]);
    await harness.dispatchPush([buildMedicationNotification({ id: "digest-2" })]);

    expect(harness.getActiveNotificationTags()).toEqual(["medication-person-1"]);
  });

  it("keeps medication notifications separated per person", async () => {
    const harness = createServiceWorkerHarness({ forceEmptyGetNotifications: true });

    await harness.dispatchPush([
      buildMedicationNotification({ id: "digest-1", person_id: "person-1" }),
    ]);
    await harness.dispatchPush([
      buildMedicationNotification({ id: "digest-2", person_id: "person-2" }),
    ]);

    expect(harness.getActiveNotificationTags()).toEqual(
      expect.arrayContaining(["medication-person-1", "medication-person-2"]),
    );
  });

  it("reuses no-person medication tag when person id is missing", async () => {
    const harness = createServiceWorkerHarness({ forceEmptyGetNotifications: true });

    await harness.dispatchPush([buildMedicationNotification({ id: "digest-1", person_id: null })]);
    await harness.dispatchPush([buildMedicationNotification({ id: "digest-2", person_id: null })]);

    expect(harness.getActiveNotificationTags()).toEqual(["medication-no-person"]);
  });

  it("treats medication_snoozed as medication for replacement semantics", async () => {
    const harness = createServiceWorkerHarness({ forceEmptyGetNotifications: true });

    await harness.dispatchPush([
      buildMedicationNotification({ id: "digest-1", type: "medication" }),
    ]);
    await harness.dispatchPush([
      buildMedicationNotification({ id: "digest-2", type: "medication_snoozed" }),
    ]);

    expect(harness.getActiveNotificationTags()).toEqual(["medication-person-1"]);
  });
});

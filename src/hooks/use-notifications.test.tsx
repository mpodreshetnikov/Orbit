import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationForDevice } from "@/types";

describe("use-notifications", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("uses service worker controller to request notification display", async () => {
    const postMessageMock = vi.fn();
    const addEventListenerMock = vi.fn();
    const removeEventListenerMock = vi.fn();

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: { postMessage: postMessageMock },
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
        getRegistration: vi.fn().mockResolvedValue(null),
      },
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        notifications: [
          {
            id: "notif-1",
            title: "Take medicine",
            body: "Body",
            person_id: "person-1",
            person_name: "Alex",
            scheduledAt: new Date().toISOString(),
            url: "/health",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { useNotifications } = await import("./use-notifications");
    const { unmount } = renderHook(() => useNotifications());

    await waitFor(() =>
      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "showNotification",
          notification: expect.objectContaining({ id: "notif-1" }),
        }),
      ),
    );
    expect(addEventListenerMock).toHaveBeenCalledWith("message", expect.any(Function));

    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("falls back to registration.showNotification and marks shown", async () => {
    const showNotificationMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: undefined,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getRegistration: vi.fn().mockResolvedValue({
          showNotification: showNotificationMock,
        }),
      },
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
      },
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/notifications?")) {
        return {
          ok: true,
          json: async () => ({
            notifications: [
              {
                id: "notif-2",
                title: "Checkup due",
                body: "Body",
                person_id: "person-1",
                title_prefix: "Alex",
                scheduledAt: new Date().toISOString(),
                url: "/health/checkups",
              },
            ],
          }),
        };
      }
      if (url === "/api/notifications/mark-shown") {
        return {
          ok: true,
          json: async () => ({}),
        };
      }
      return {
        ok: false,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useNotifications } = await import("./use-notifications");
    renderHook(() => useNotifications());

    await waitFor(() => expect(showNotificationMock).toHaveBeenCalled());
    expect(showNotificationMock).toHaveBeenCalledWith(
      "(Alex) Checkup due",
      expect.objectContaining({
        body: "Body",
        requireInteraction: true,
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications/mark-shown",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const shown = JSON.parse(localStorage.getItem("notifications_shown") || "{}") as {
      ids?: string[];
    };
    expect(shown.ids).toContain("notif-2");
  });

  it("covers helper utilities for prefixing and shown-today storage", async () => {
    const {
      applyTitlePrefix,
      resolveTitlePrefix,
      getShownToday,
      markShownToday,
      NOTIFICATIONS_STORAGE_KEY,
    } = await import("./use-notifications");

    expect(resolveTitlePrefix({ title_prefix: "Alex" } as NotificationForDevice)).toBe("Alex");
    expect(
      resolveTitlePrefix({ title_prefix: null, person_name: "Ignored" } as NotificationForDevice),
    ).toBeNull();
    expect(resolveTitlePrefix({ person_name: "Sam" } as NotificationForDevice)).toBe("Sam");
    expect(resolveTitlePrefix({} as NotificationForDevice)).toBeNull();

    expect(applyTitlePrefix("Title", null)).toBe("Title");
    expect(applyTitlePrefix("Title", "   ")).toBe("Title");
    expect(applyTitlePrefix("(Alex) Title", "Alex")).toBe("(Alex) Title");
    expect(applyTitlePrefix("Title", "Alex")).toBe("(Alex) Title");

    localStorage.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify({ date: "1999-01-01", ids: ["old"] }),
    );
    expect(Array.from(getShownToday())).toEqual([]);

    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, "{bad json");
    expect(Array.from(getShownToday())).toEqual([]);

    localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
    markShownToday("a");
    markShownToday("b");
    expect(Array.from(getShownToday()).sort()).toEqual(["a", "b"]);
  });

  it("fetches notifications and handles non-ok responses", async () => {
    const { fetchNotifications } = await import("./use-notifications");

    const fetchOk = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notifications: [{ id: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchOk);
    await expect(fetchNotifications()).resolves.toEqual([{ id: "x" }]);

    const fetchNoNotifications = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchNoNotifications);
    await expect(fetchNotifications()).resolves.toEqual([]);

    const fetchBad = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchBad);
    await expect(fetchNotifications()).resolves.toEqual([]);
  });

  it("uses Notification constructor fallback when SW registration is unavailable", async () => {
    const shownCtor = vi.fn();
    const NotificationMock = Object.assign(
      function NotificationCtor(this: unknown, title: string, options: NotificationOptions) {
        shownCtor(title, options);
      },
      { permission: "granted" as NotificationPermission },
    );

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: NotificationMock,
    });
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: undefined,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getRegistration: vi.fn().mockResolvedValue(null),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    const { showNotificationFallback, getShownToday } = await import("./use-notifications");
    await showNotificationFallback({
      id: "notif-fallback",
      title: "Hello",
      body: "World",
      person_id: "person-1",
      title_prefix: "   ",
      scheduledAt: new Date().toISOString(),
      url: "https://example.test/absolute",
      tag: "explicit-tag",
    } as NotificationForDevice);

    expect(shownCtor).toHaveBeenCalledWith(
      "Hello",
      expect.objectContaining({
        tag: "explicit-tag",
        data: { url: "https://example.test/absolute" },
      }),
    );
    expect(Array.from(getShownToday())).toContain("notif-fallback");
  });

  it("uses stable medication fallback tags so repeat reminders can replace prior cards", async () => {
    const showNotificationMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: undefined,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getRegistration: vi.fn().mockResolvedValue({
          showNotification: showNotificationMock,
        }),
      },
    });
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    const { showNotificationFallback } = await import("./use-notifications");
    const scheduledAt = new Date().toISOString();

    await showNotificationFallback({
      id: "med-1",
      type: "medication",
      title: "Medications",
      body: "Dose 1",
      person_id: "person-1",
      scheduledAt,
      url: "/health/medications",
    } as NotificationForDevice);
    await showNotificationFallback({
      id: "med-2",
      type: "medication_snoozed",
      title: "Medications",
      body: "Dose 2",
      person_id: "person-1",
      scheduledAt,
      url: "/health/medications",
    } as NotificationForDevice);

    expect(showNotificationMock).toHaveBeenNthCalledWith(
      1,
      "Medications",
      expect.objectContaining({ tag: "medication-person-1" }),
    );
    expect(showNotificationMock).toHaveBeenNthCalledWith(
      2,
      "Medications",
      expect.objectContaining({ tag: "medication-person-1" }),
    );
  });

  it("keeps non-medication fallback tags digest-scoped", async () => {
    const showNotificationMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: undefined,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getRegistration: vi.fn().mockResolvedValue({
          showNotification: showNotificationMock,
        }),
      },
    });
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    const { showNotificationFallback } = await import("./use-notifications");
    const scheduledAt = new Date().toISOString();

    await showNotificationFallback({
      id: "checkup-1",
      type: "checkup",
      title: "Checkup",
      body: "Body",
      person_id: "person-9",
      scheduledAt,
      url: "/health/checkups",
    } as NotificationForDevice);
    await showNotificationFallback({
      id: "checkup-2",
      type: "checkup",
      title: "Checkup",
      body: "Body",
      person_id: "person-9",
      scheduledAt,
      url: "/health/checkups",
    } as NotificationForDevice);

    expect(showNotificationMock).toHaveBeenNthCalledWith(
      1,
      "Checkup",
      expect.objectContaining({ tag: "notification-person-9-checkup-1" }),
    );
    expect(showNotificationMock).toHaveBeenNthCalledWith(
      2,
      "Checkup",
      expect.objectContaining({ tag: "notification-person-9-checkup-2" }),
    );
  });

  it("returns early in fallback when notification permission is denied", async () => {
    const shownCtor = vi.fn();
    const NotificationMock = Object.assign(
      function NotificationCtor(this: unknown, title: string, options: NotificationOptions) {
        shownCtor(title, options);
      },
      { permission: "denied" as NotificationPermission },
    );
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: NotificationMock,
    });
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: undefined,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getRegistration: vi.fn().mockResolvedValue(null),
      },
    });

    const { showNotificationFallback } = await import("./use-notifications");
    await showNotificationFallback({
      id: "notif-denied",
      title: "Denied",
      body: "Body",
      person_id: "person-1",
      scheduledAt: new Date().toISOString(),
      url: "/health",
    } as NotificationForDevice);

    expect(shownCtor).not.toHaveBeenCalled();
  });

  it("handles service worker message payloads and skips already shown/future notifications", async () => {
    const postMessageMock = vi.fn();
    let messageListener: ((event: MessageEvent) => void) | null = null;
    const addEventListenerMock = vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") messageListener = listener;
    });
    const removeEventListenerMock = vi.fn();

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: { postMessage: postMessageMock },
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
        getRegistration: vi.fn().mockResolvedValue(null),
      },
    });
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
      },
    });

    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: "already-shown",
              title: "Shown",
              body: "Body",
              person_id: "person-1",
              scheduledAt: now,
              url: "/a",
            },
            {
              id: "future-notif",
              title: "Future",
              body: "Body",
              person_id: "person-1",
              scheduledAt: future,
              url: "/b",
            },
            {
              id: "due-notif",
              title: "Due",
              body: "Body",
              person_id: "person-1",
              scheduledAt: now,
              url: "/c",
            },
          ],
        }),
      }),
    );

    localStorage.setItem(
      "notifications_shown",
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        ids: ["already-shown"],
      }),
    );

    const { useNotifications, getShownToday } = await import("./use-notifications");
    const { unmount } = renderHook(() => useNotifications());

    await waitFor(() =>
      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "showNotification",
          notification: expect.objectContaining({ id: "due-notif" }),
        }),
      ),
    );
    expect(postMessageMock).toHaveBeenCalledTimes(1);

    expect(messageListener).toBeTruthy();
    (messageListener as unknown as ((ev: MessageEvent) => void) | null)?.(
      new MessageEvent("message", {
        data: { type: "notificationShown", ids: ["from-array", 42] },
      }),
    );
    (messageListener as unknown as ((ev: MessageEvent) => void) | null)?.(
      new MessageEvent("message", {
        data: { type: "notificationShown", id: "from-id" },
      }),
    );
    expect(Array.from(getShownToday()).sort()).toEqual(
      expect.arrayContaining(["already-shown", "from-array", "from-id"]),
    );

    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("returns early when Notification API is unavailable", async () => {
    const addEventListenerMock = vi.fn();
    const originalNotification = (globalThis as { Notification?: unknown }).Notification;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        controller: undefined,
        addEventListener: addEventListenerMock,
        removeEventListener: vi.fn(),
        getRegistration: vi.fn().mockResolvedValue(null),
      },
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    // The hook checks `"Notification" in window`, so remove the key entirely.
    delete (window as { Notification?: unknown }).Notification;

    const { useNotifications } = await import("./use-notifications");
    renderHook(() => useNotifications());
    expect(addEventListenerMock).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: originalNotification,
    });
  });
});

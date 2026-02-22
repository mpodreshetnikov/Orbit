import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("use-ensure-push-subscription", () => {
  const originalVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  afterEach(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = originalVapidKey;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does nothing when VAPID key is missing", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    const getRegistrationMock = vi.fn();
    const registerMock = vi.fn();
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        getRegistration: getRegistrationMock,
        register: registerMock,
      },
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
        static requestPermission = vi.fn().mockResolvedValue("granted");
      },
    });

    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      writable: true,
      value: class PushManagerMock {},
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    renderHook(() => useEnsurePushSubscription());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getRegistrationMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("subscribes and syncs subscription to api", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-vapid";

    const subscription = {
      toJSON: () => ({
        endpoint: "https://push.example/endpoint",
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      }),
    };
    const subscribeMock = vi.fn().mockResolvedValue(subscription);
    const getSubscriptionMock = vi.fn().mockResolvedValue(null);
    const registration = {
      pushManager: {
        getSubscription: getSubscriptionMock,
        subscribe: subscribeMock,
      },
    };
    const getRegistrationMock = vi.fn().mockResolvedValue(null);
    const registerMock = vi.fn().mockResolvedValue(registration);

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        getRegistration: getRegistrationMock,
        register: registerMock,
      },
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
        static requestPermission = vi.fn().mockResolvedValue("granted");
      },
    });

    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      writable: true,
      value: class PushManagerMock {},
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    renderHook(() => useEnsurePushSubscription());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/push-subscribe",
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect(registerMock).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(subscribeMock).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: "test-vapid",
    });
  });

  it("skips service worker work when notification permission is denied", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-vapid";

    const getRegistrationMock = vi.fn();
    const registerMock = vi.fn();
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        getRegistration: getRegistrationMock,
        register: registerMock,
      },
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "denied";
        static requestPermission = vi.fn().mockResolvedValue("denied");
      },
    });

    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      writable: true,
      value: class PushManagerMock {},
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    renderHook(() => useEnsurePushSubscription());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getRegistrationMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops when pushManager.subscribe throws", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-vapid";

    const subscribeMock = vi.fn().mockRejectedValue(new Error("subscribe failed"));
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: subscribeMock,
      },
    };
    const getRegistrationMock = vi.fn().mockResolvedValue(registration);
    const registerMock = vi.fn();

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        getRegistration: getRegistrationMock,
        register: registerMock,
      },
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: class NotificationMock {
        static permission: NotificationPermission = "granted";
        static requestPermission = vi.fn().mockResolvedValue("granted");
      },
    });

    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      writable: true,
      value: class PushManagerMock {},
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    renderHook(() => useEnsurePushSubscription());

    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    expect(getRegistrationMock).toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

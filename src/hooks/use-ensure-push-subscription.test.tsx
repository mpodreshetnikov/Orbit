import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const subscriptionPayload = {
  endpoint: "https://push.example/endpoint",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

function stubPushBrowser({
  permission = "granted",
  hasRegistration = false,
  subscriptionError,
}: {
  permission?: NotificationPermission;
  hasRegistration?: boolean;
  subscriptionError?: Error;
} = {}) {
  const subscription = { toJSON: () => subscriptionPayload };
  let activeSubscription: typeof subscription | null = null;
  const subscribe = vi.fn(async () => {
    if (subscriptionError) throw subscriptionError;
    activeSubscription = subscription;
    return subscription;
  });
  const registration = {
    pushManager: { getSubscription: async () => activeSubscription, subscribe },
  };
  let registeredWorker = hasRegistration ? registration : null;
  const getRegistration = vi.fn(async () => registeredWorker);
  const register = vi.fn(async () => {
    registeredWorker = registration;
    return registration;
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration, register },
  });

  const requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", class PushManagerStub {});

  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    requests.push(new Request(new URL(url, window.location.origin), options));
    return new Response(null, { status: 204 });
  });

  return {
    getRegistration,
    register,
    requestPermission,
    requests,
    subscribe,
    getRegisteredWorker: () => registeredWorker,
    getActiveSubscription: () => activeSubscription,
  };
}

describe("use-ensure-push-subscription", () => {
  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does nothing when VAPID key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", undefined);
    const browser = stubPushBrowser({ permission: "default" });

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    await act(async () => {
      renderHook(() => useEnsurePushSubscription());
    });

    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(browser.getRegistration).not.toHaveBeenCalled();
    expect(browser.getRegisteredWorker()).toBeNull();
    expect(browser.requests).toEqual([]);
  });

  it("subscribes and syncs the endpoint and keys to the API", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-vapid");
    const browser = stubPushBrowser();

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    renderHook(() => useEnsurePushSubscription());

    await waitFor(() => expect(browser.requests).toHaveLength(1));
    const [request] = browser.requests;
    expect(new URL(request.url).pathname).toBe("/api/push-subscribe");
    expect(request.method).toBe("POST");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    await expect(request.json()).resolves.toEqual(subscriptionPayload);
    expect(browser.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(browser.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: "test-vapid",
    });
  });

  it("skips service worker work when notification permission is denied", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-vapid");
    const browser = stubPushBrowser({ permission: "denied" });

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    await act(async () => {
      renderHook(() => useEnsurePushSubscription());
    });

    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(browser.getRegistration).not.toHaveBeenCalled();
    expect(browser.getRegisteredWorker()).toBeNull();
    expect(browser.requests).toEqual([]);
  });

  it("keeps the existing worker and skips the API sync when subscription fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-vapid");
    const browser = stubPushBrowser({
      hasRegistration: true,
      subscriptionError: new Error("subscribe failed"),
    });
    const existingWorker = browser.getRegisteredWorker();

    const { useEnsurePushSubscription } = await import("./use-ensure-push-subscription");
    await act(async () => {
      renderHook(() => useEnsurePushSubscription());
    });

    expect(browser.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: "test-vapid",
    });
    expect(browser.register).not.toHaveBeenCalled();
    expect(browser.getRegisteredWorker()).toBe(existingWorker);
    expect(browser.getActiveSubscription()).toBeNull();
    expect(browser.requests).toEqual([]);
  });
});

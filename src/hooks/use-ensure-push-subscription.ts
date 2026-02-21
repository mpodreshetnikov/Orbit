"use client";

import { useEffect } from "react";
import type { PushSubscriptionInput } from "@/types";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

async function sendSubscriptionToApi(input: PushSubscriptionInput): Promise<void> {
  const res = await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Push subscribe failed: ${res.status}`);
}

/**
 * Ensures notification permission is granted; if not, asks the user.
 * Returns the permission after requesting. Skips (returns current) if already denied.
 */
async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

/**
 * On every app run (when mounted):
 * - Checks notification permission; if not granted, asks the user for it.
 * - If permission granted, ensures an active push subscription and syncs to API.
 */
export function useEnsurePushSubscription(): void {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      return;
    }
    if (!VAPID_KEY) return;

    let cancelled = false;

    const run = async () => {
      const permission = await ensureNotificationPermission();
      if (cancelled || permission !== "granted") return;

      let reg: ServiceWorkerRegistration | null | undefined =
        await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await registerServiceWorker();
      if (!reg || cancelled) return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: VAPID_KEY,
          });
        } catch {
          return;
        }
      }
      if (cancelled || !sub) return;

      const subscription = sub.toJSON();
      if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) return;

      try {
        await sendSubscriptionToApi({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        });
      } catch {
        // e.g. 401 when not logged in; ignore
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);
}

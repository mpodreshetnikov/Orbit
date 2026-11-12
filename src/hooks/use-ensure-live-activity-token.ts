"use client";

import { useEffect } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  isNativeIosLiveActivityAvailable,
  LiveActivity,
  type LiveActivityTokenEvent,
} from "@/lib/live-activity-plugin";

async function sendTokenToApi(event: LiveActivityTokenEvent): Promise<void> {
  const res = await fetch("/api/notifications/live-activity-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pushToStartToken: event.token,
      bundleId: event.bundleId,
      apnsEnvironment: event.apnsEnvironment,
    }),
  });
  if (!res.ok) throw new Error(`Live Activity token register failed: ${res.status}`);
}

/**
 * On the Capacitor iOS shell, register the ActivityKit push-to-start token with the server.
 * No-ops in the browser and when the native plugin is absent — Web Push stays untouched.
 * Listens for rotations (notifyListeners) as well as the first Promise resolve.
 */
export function useEnsureLiveActivityToken(): void {
  useEffect(() => {
    if (typeof window === "undefined" || !isNativeIosLiveActivityAvailable()) {
      return;
    }

    let cancelled = false;
    let listener: PluginListenerHandle | undefined;

    const onToken = (event: LiveActivityTokenEvent) => {
      if (cancelled || !event?.token) return;
      void sendTokenToApi(event).catch(() => {
        // Plugin missing, ActivityKit unavailable, or 401 when logged out — ignore.
      });
    };

    const run = async () => {
      try {
        listener = await LiveActivity.addListener("pushToStartToken", onToken);
        const event = await LiveActivity.watchPushToStartToken();
        onToken(event);
      } catch {
        // Plugin missing, ActivityKit unavailable, or 401 when logged out — ignore.
      }
    };

    void run();
    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, []);
}

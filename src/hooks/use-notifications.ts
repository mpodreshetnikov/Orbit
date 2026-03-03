"use client";

import { useEffect, useRef, useCallback } from "react";
import type { NotificationForDevice } from "@/types";

export const NOTIFICATIONS_STORAGE_KEY = "notifications_shown";
export const BUFFER_MS = 60 * 1000;

export function resolveTitlePrefix(notification: NotificationForDevice): string | null {
  if ("title_prefix" in notification) {
    return notification.title_prefix ?? null;
  }
  return notification.person_name ?? null;
}

export function applyTitlePrefix(title: string, prefix?: string | null): string {
  if (!prefix) return title;
  const trimmed = prefix.trim();
  if (!trimmed) return title;
  const prefixText = `(${trimmed}) `;
  return title.startsWith(prefixText) ? title : `${prefixText}${title}`;
}

export function isMedicationNotificationType(type: string | undefined): boolean {
  return type === "medication" || type === "medication_snoozed";
}

export function resolveFallbackNotificationTag(notification: NotificationForDevice): string {
  if (notification.tag) return notification.tag;

  if (isMedicationNotificationType(notification.type)) {
    const personKey = notification.person_id ?? "no-person";
    return `medication-${personKey}`;
  }

  return notification.person_id
    ? `notification-${notification.person_id}-${notification.id}`
    : `notification-${notification.id}`;
}

export function getShownToday(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const { date, ids } = JSON.parse(raw) as { date: string; ids: string[] };
    const today = new Date().toISOString().slice(0, 10);
    if (date !== today) return new Set();
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export function markShownToday(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shown = getShownToday();
    shown.add(id);
    localStorage.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify({ date: today, ids: Array.from(shown) }),
    );
  } catch {
    // ignore
  }
}

export async function fetchNotifications(): Promise<NotificationForDevice[]> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 2);
  const res = await fetch(`/api/notifications?from=${start.toISOString()}&to=${end.toISOString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.notifications ?? [];
}

export async function callMarkShown(id: string): Promise<void> {
  try {
    await fetch("/api/notifications/mark-shown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  } catch {
    // ignore
  }
}

/** Ask the SW to show a notification (reuses SW buildNotificationOptions + show + mark-shown). */
export function requestSwShowNotification(notification: NotificationForDevice): void {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  controller.postMessage({ type: "showNotification", notification });
}

/** Fallback when no SW: show a basic notification and mark shown. */
export async function showNotificationFallback(notification: NotificationForDevice): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = notification.url?.startsWith("/")
    ? `${origin}${notification.url}`
    : (notification.url ?? `${origin}/`);
  const baseTitle = notification.title || "Notification";
  const prefix = resolveTitlePrefix(notification);
  const title = applyTitlePrefix(baseTitle, prefix);
  const options: NotificationOptions = {
    body: notification.body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: { url },
    tag: resolveFallbackNotificationTag(notification),
    requireInteraction: true,
  };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) {
    await reg.showNotification(title, options);
  } else {
    new Notification(title, options);
  }
  await callMarkShown(notification.id);
  markShownToday(notification.id);
}

/** Hook for any notification type (checkup, medication, etc.). Fetches unsent digests, shows due/overdue, marks shown. */
export function useNotifications(): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(async () => {
    try {
      const notifications = await fetchNotifications();
      if (notifications.length === 0) return;
      const now = Date.now();
      const hasSw = !!navigator.serviceWorker?.controller;
      for (const n of notifications) {
        if (getShownToday().has(n.id)) continue;
        const scheduledAt = new Date(n.scheduledAt).getTime();
        if (scheduledAt <= now + BUFFER_MS) {
          if (hasSw) {
            requestSwShowNotification(n);
          } else {
            await showNotificationFallback(n);
          }
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "notificationShown") {
        if (Array.isArray(data.ids)) {
          data.ids.forEach((id: string) => {
            if (typeof id === "string") markShownToday(id);
          });
          return;
        }
        if (typeof data.id === "string") {
          markShownToday(data.id);
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    run();
    const onOnline = () => run();
    window.addEventListener("online", onOnline);
    intervalRef.current = setInterval(run, 60 * 60 * 1000);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [run]);
}

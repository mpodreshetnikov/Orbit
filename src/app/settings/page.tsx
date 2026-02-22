"use client";

import React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  BellOff,
  Bug,
  CheckCircle,
  XCircle,
  RefreshCw,
  Smartphone,
  Download,
  ArrowLeft,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useIntlLocale } from "@/lib/date-locale";
import {
  useUserPreferences,
  useUpdateUserPreferences,
  usePushSubscribe,
  usePersons,
  useNotificationRouting,
  useUpdateNotificationRouting,
} from "@/hooks";

type PermissionStatus = "default" | "granted" | "denied" | "unsupported";
type ServiceWorkerStatus = "checking" | "registered" | "not-registered" | "unsupported";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const intlLocale = useIntlLocale();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("default");
  const [swStatus, setSwStatus] = useState<ServiceWorkerStatus>("checking");
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [lastNotificationTime, setLastNotificationTime] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const checkNotificationSupport = useCallback(() => {
    if (typeof window === "undefined") return;

    if (!("Notification" in window)) {
      setPermissionStatus("unsupported");
      return;
    }

    setPermissionStatus(Notification.permission as PermissionStatus);
  }, []);

  const registerServiceWorker = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      return registration;
    } catch (error) {
      console.error("Service worker registration failed:", error);
      return null;
    }
  }, []);

  const checkServiceWorker = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!("serviceWorker" in navigator)) {
      setSwStatus("unsupported");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        setSwStatus("registered");
        setSwRegistration(registration);
      } else {
        setSwStatus("not-registered");
      }
    } catch {
      setSwStatus("not-registered");
    }
  }, []);

  useEffect(() => {
    checkNotificationSupport();
    checkServiceWorker();
  }, [checkNotificationSupport, checkServiceWorker]);

  const handleRegisterSW = async () => {
    setIsRegistering(true);
    const registration = await registerServiceWorker();
    if (registration) {
      setSwStatus("registered");
      setSwRegistration(registration);
    }
    setIsRegistering(false);
  };

  const requestPermission = async () => {
    if (!("Notification" in window)) {
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission as PermissionStatus);
    } catch (error) {
      console.error("Error requesting notification permission:", error);
    }
  };

  const sendTestNotification = async () => {
    if (permissionStatus !== "granted") {
      return;
    }

    const notificationOptions: NotificationOptions & {
      image?: string;
      actions?: Array<{ action: string; title: string; icon?: string }>;
    } = {
      body: t("pwa.testNotificationBodyRich"),
      icon: "/icons/icon-512x512.png",
      badge: "/icons/icon-512x512.png",
      image: "/icons/icon-512x512.png",
      tag: "test-notification",
      requireInteraction: true,
      data: {
        url: "/",
        actionBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
      },
      actions: [
        { action: "open", title: t("pwa.notificationActionOpen") },
        { action: "settings", title: t("pwa.notificationActionSettings") },
        { action: "dismiss", title: t("pwa.notificationActionDismiss") },
      ],
    };

    try {
      if (swRegistration) {
        await swRegistration.showNotification(t("pwa.testNotificationTitle"), notificationOptions);
      } else {
        new Notification(t("pwa.testNotificationTitle"), notificationOptions);
      }
      setLastNotificationTime(new Date().toLocaleTimeString(intlLocale));
    } catch (error) {
      console.error("Error sending notification:", error);
      try {
        new Notification(t("pwa.testNotificationTitle"), notificationOptions);
        setLastNotificationTime(new Date().toLocaleTimeString(intlLocale));
      } catch (fallbackError) {
        console.error("Fallback notification also failed:", fallbackError);
      }
    }
  };

  const getPermissionBadge = () => {
    switch (permissionStatus) {
      case "granted":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("pwa.permissionGranted")}
          </Badge>
        );
      case "denied":
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            {t("pwa.permissionDenied")}
          </Badge>
        );
      case "unsupported":
        return <Badge variant="secondary">{t("pwa.permissionUnsupported")}</Badge>;
      default:
        return <Badge variant="outline">{t("pwa.permissionDefault")}</Badge>;
    }
  };

  const getSwStatusBadge = () => {
    switch (swStatus) {
      case "registered":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("pwa.swRegistered")}
          </Badge>
        );
      case "not-registered":
        return (
          <Badge variant="outline">
            <XCircle className="w-3 h-3 mr-1" />
            {t("pwa.swNotRegistered")}
          </Badge>
        );
      case "unsupported":
        return <Badge variant="secondary">{t("pwa.swUnsupported")}</Badge>;
      default:
        return (
          <Badge variant="outline">
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            {t("pwa.swChecking")}
          </Badge>
        );
    }
  };

  const refreshStatus = () => {
    setSwStatus("checking");
    checkNotificationSupport();
    checkServiceWorker();
  };

  // Checkup reminders: time + timezone
  const { data: preferences } = useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  const pushSubscribe = usePushSubscribe();
  const [notificationTime, setNotificationTime] = useState("09:00");
  const [notificationTimezone, setNotificationTimezone] = useState("");
  const [isEnablingReminders, setIsEnablingReminders] = useState(false);
  const { data: persons } = usePersons();
  const { data: routingState } = useNotificationRouting();
  const updateRouting = useUpdateNotificationRouting();
  const [prefixByPerson, setPrefixByPerson] = useState<Record<string, string>>({});
  const routingRows = useMemo(() => routingState?.rows ?? [], [routingState?.rows]);
  const currentUserId = routingState?.userId ?? null;
  const routingByPersonId = useMemo(
    () => new Map(routingRows.map((row) => [row.person_id, row] as const)),
    [routingRows],
  );

  useEffect(() => {
    if (!routingRows) return;
    const next: Record<string, string> = {};
    for (const row of routingRows) {
      next[row.person_id] = row.custom_prefix ?? "";
    }
    setPrefixByPerson((prev) => ({ ...next, ...prev }));
  }, [routingRows]);

  useEffect(() => {
    if (preferences) {
      setNotificationTime(preferences.checkup_notification_time?.slice(0, 5) ?? "09:00");
      setNotificationTimezone(preferences.checkup_notification_timezone ?? "");
    }
  }, [preferences]);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      !preferences?.checkup_notification_timezone &&
      notificationTimezone === ""
    ) {
      try {
        setNotificationTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        setNotificationTimezone("UTC");
      }
    }
  }, [preferences?.checkup_notification_timezone, notificationTimezone]);

  const handleSaveCheckupReminders = async () => {
    const timeValue = notificationTime.trim() || "09:00";
    const [h, m] = timeValue.split(":").map(Number);
    const normalized = `${String(h ?? 9).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
    await updatePreferences.mutateAsync({
      checkup_notification_time: normalized,
      checkup_notification_timezone: notificationTimezone.trim() || null,
    });
  };

  const handleEnableCheckupReminders = async () => {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    )
      return;
    setIsEnablingReminders(true);
    try {
      if (Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setIsEnablingReminders(false);
          return;
        }
      }
      let reg: ServiceWorkerRegistration | null | undefined =
        await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await registerServiceWorker();
      if (!reg) throw new Error("Service worker not registered");
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("VAPID public key not configured");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });
      const subscription = sub.toJSON();
      await pushSubscribe.mutateAsync({
        endpoint: subscription.endpoint!,
        keys: { p256dh: subscription.keys!.p256dh!, auth: subscription.keys!.auth! },
      });
      await handleSaveCheckupReminders();
    } catch (e) {
      console.error("Enable checkup reminders failed:", e);
    } finally {
      setIsEnablingReminders(false);
    }
  };

  const isPersonEnabled = (personId: string, personOwnerId: string | null | undefined) => {
    const row = routingByPersonId.get(personId);
    if (row) return row.enabled;
    return currentUserId != null && personOwnerId === currentUserId;
  };

  const handleToggleRouting = async (
    personId: string,
    personOwnerId: string | null | undefined,
  ) => {
    const enabled = !isPersonEnabled(personId, personOwnerId);
    const isOwnPerson = currentUserId != null && personOwnerId === currentUserId;
    const customPrefix = prefixByPerson[personId] ?? "";
    await updateRouting.mutateAsync({
      person_id: personId,
      enabled,
      custom_prefix: isOwnPerson ? null : customPrefix.trim() ? customPrefix.trim() : null,
    });
  };

  const handlePrefixSave = async (personId: string, personOwnerId: string | null | undefined) => {
    const enabled = isPersonEnabled(personId, personOwnerId);
    const isOwnPerson = currentUserId != null && personOwnerId === currentUserId;
    const customPrefix = prefixByPerson[personId] ?? "";
    await updateRouting.mutateAsync({
      person_id: personId,
      enabled,
      custom_prefix: isOwnPerson ? null : customPrefix.trim() ? customPrefix.trim() : null,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/health">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{t("appSettings")}</h1>
            <p className="text-sm text-muted-foreground">{t("appSettingsDescription")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshStatus}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {tCommon("refresh")}
          </Button>
        </div>

        {/* PWA Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              {t("pwa.status")}
            </CardTitle>
            <CardDescription>{t("pwa.statusDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("pwa.serviceWorker")}</span>
              {getSwStatusBadge()}
            </div>
            {swRegistration && (
              <div className="text-xs text-muted-foreground">
                {t("pwa.swScope")}: {swRegistration.scope}
              </div>
            )}
            {swStatus === "not-registered" && (
              <Button
                onClick={handleRegisterSW}
                disabled={isRegistering}
                variant="outline"
                size="sm"
              >
                <Download className="w-4 h-4 mr-2" />
                {isRegistering ? t("pwa.swRegistering") : t("pwa.registerSW")}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Notifications Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              {t("pwa.notifications")}
            </CardTitle>
            <CardDescription>{t("pwa.notificationsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("pwa.permissionStatus")}</span>
              {getPermissionBadge()}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={requestPermission}
                disabled={permissionStatus === "granted" || permissionStatus === "unsupported"}
                variant="outline"
                className="flex-1"
              >
                {permissionStatus === "denied" ? (
                  <>
                    <BellOff className="w-4 h-4 mr-2" />
                    {t("pwa.permissionDeniedHelp")}
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4 mr-2" />
                    {t("pwa.requestPermission")}
                  </>
                )}
              </Button>

              <Button
                onClick={sendTestNotification}
                disabled={permissionStatus !== "granted"}
                className="flex-1"
              >
                <Bell className="w-4 h-4 mr-2" />
                {t("pwa.sendTestNotification")}
              </Button>
            </div>

            {permissionStatus === "denied" && (
              <p className="text-xs text-muted-foreground">{t("pwa.deniedInstructions")}</p>
            )}

            {lastNotificationTime && (
              <p className="text-xs text-muted-foreground">
                {t("pwa.lastNotification")}: {lastNotificationTime}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Checkup reminders Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5" />
              {t("pwa.checkupReminders")}
            </CardTitle>
            <CardDescription>{t("pwa.checkupRemindersDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="notification-time">{t("pwa.notificationTime")}</Label>
              <Input
                id="notification-time"
                type="time"
                value={notificationTime}
                onChange={(e) => setNotificationTime(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("pwa.notificationTimeHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notification-timezone">{t("pwa.notificationTimezone")}</Label>
              <Input
                id="notification-timezone"
                type="text"
                placeholder="UTC"
                value={notificationTimezone}
                onChange={(e) => setNotificationTimezone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("pwa.notificationTimezoneHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSaveCheckupReminders} disabled={updatePreferences.isPending}>
                {updatePreferences.isPending ? tCommon("loading") : t("pwa.saveCheckupReminders")}
              </Button>
              <Button
                variant="outline"
                onClick={handleEnableCheckupReminders}
                disabled={isEnablingReminders || permissionStatus !== "granted"}
              >
                {isEnablingReminders ? tCommon("loading") : t("pwa.enableCheckupReminders")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("pwa.enableCheckupRemindersDescription")}
            </p>
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <Link href="/settings/notifications-debug">
                <Bug className="w-4 h-4 mr-2" />
                {t("pwa.notificationsDebug")}
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Notification routing Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              {t("pwa.routingTitle")}
            </CardTitle>
            <CardDescription>{t("pwa.routingDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(persons ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{t("pwa.routingNoPersons")}</p>
            )}
            {(persons ?? []).map((person) => {
              const enabled = isPersonEnabled(person.id, person.auth_user_id);
              const prefixValue = prefixByPerson[person.id] ?? "";
              const isOwnPerson = currentUserId != null && person.auth_user_id === currentUserId;
              return (
                <div key={person.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{person.name}</p>
                      {person.kind === "pet" && person.species && (
                        <p className="text-xs text-muted-foreground">{person.species}</p>
                      )}
                    </div>
                    <Button
                      variant={enabled ? "default" : "outline"}
                      size="sm"
                      disabled={updateRouting.isPending}
                      onClick={() => handleToggleRouting(person.id, person.auth_user_id)}
                    >
                      {enabled ? t("pwa.routingEnabled") : t("pwa.routingDisabled")}
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`routing-prefix-${person.id}`}>
                      {t("pwa.routingPrefixLabel")}
                    </Label>
                    <Input
                      id={`routing-prefix-${person.id}`}
                      type="text"
                      placeholder={t("pwa.routingPrefixPlaceholder")}
                      value={prefixValue}
                      disabled={!enabled || updateRouting.isPending || isOwnPerson}
                      onChange={(e) =>
                        setPrefixByPerson((prev) => ({
                          ...prev,
                          [person.id]: e.target.value,
                        }))
                      }
                      onBlur={() => handlePrefixSave(person.id, person.auth_user_id)}
                    />
                    <p className="text-xs text-muted-foreground">{t("pwa.routingPrefixHint")}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Install Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("pwa.installInstructions")}</CardTitle>
            <CardDescription>{t("pwa.installDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>iOS Safari:</strong> {t("pwa.iosInstructions")}
            </p>
            <p>
              <strong>Android Chrome:</strong> {t("pwa.androidInstructions")}
            </p>
            <p>
              <strong>Desktop Chrome/Edge:</strong> {t("pwa.desktopInstructions")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

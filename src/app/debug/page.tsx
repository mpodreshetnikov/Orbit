"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff, CheckCircle, XCircle, RefreshCw, Smartphone, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";

type PermissionStatus = "default" | "granted" | "denied" | "unsupported";
type ServiceWorkerStatus = "checking" | "registered" | "not-registered" | "unsupported";

export default function DebugPage() {
  const t = useTranslations("debug");
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

    const notificationOptions: NotificationOptions = {
      body: t("testNotificationBody"),
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      tag: "test-notification",
      requireInteraction: false,
    };

    try {
      // Try to send via service worker first (for better PWA experience)
      if (swRegistration) {
        await swRegistration.showNotification(t("testNotificationTitle"), notificationOptions);
      } else {
        // Fallback to regular notification
        new Notification(t("testNotificationTitle"), notificationOptions);
      }
      setLastNotificationTime(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Error sending notification:", error);
      // Fallback to regular notification
      try {
        new Notification(t("testNotificationTitle"), notificationOptions);
        setLastNotificationTime(new Date().toLocaleTimeString());
      } catch (fallbackError) {
        console.error("Fallback notification also failed:", fallbackError);
      }
    }
  };

  const getPermissionBadge = () => {
    switch (permissionStatus) {
      case "granted":
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />{t("permissionGranted")}</Badge>;
      case "denied":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{t("permissionDenied")}</Badge>;
      case "unsupported":
        return <Badge variant="secondary">{t("permissionUnsupported")}</Badge>;
      default:
        return <Badge variant="outline">{t("permissionDefault")}</Badge>;
    }
  };

  const getSwStatusBadge = () => {
    switch (swStatus) {
      case "registered":
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />{t("swRegistered")}</Badge>;
      case "not-registered":
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" />{t("swNotRegistered")}</Badge>;
      case "unsupported":
        return <Badge variant="secondary">{t("swUnsupported")}</Badge>;
      default:
        return <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />{t("swChecking")}</Badge>;
    }
  };

  const refreshStatus = () => {
    setSwStatus("checking");
    checkNotificationSupport();
    checkServiceWorker();
  };

  return (
    <AppShell>
      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <Button variant="outline" size="sm" onClick={refreshStatus}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("refresh")}
          </Button>
        </div>

        {/* PWA Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              {t("pwaStatus")}
            </CardTitle>
            <CardDescription>{t("pwaStatusDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("serviceWorker")}</span>
              {getSwStatusBadge()}
            </div>
            {swRegistration && (
              <div className="text-xs text-muted-foreground">
                {t("swScope")}: {swRegistration.scope}
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
                {isRegistering ? t("swRegistering") : t("registerSW")}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Notifications Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              {t("notifications")}
            </CardTitle>
            <CardDescription>{t("notificationsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("permissionStatus")}</span>
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
                    {t("permissionDeniedHelp")}
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4 mr-2" />
                    {t("requestPermission")}
                  </>
                )}
              </Button>

              <Button
                onClick={sendTestNotification}
                disabled={permissionStatus !== "granted"}
                className="flex-1"
              >
                <Bell className="w-4 h-4 mr-2" />
                {t("sendTestNotification")}
              </Button>
            </div>

            {permissionStatus === "denied" && (
              <p className="text-xs text-muted-foreground">
                {t("deniedInstructions")}
              </p>
            )}

            {lastNotificationTime && (
              <p className="text-xs text-muted-foreground">
                {t("lastNotification")}: {lastNotificationTime}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Install Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("installInstructions")}</CardTitle>
            <CardDescription>{t("installDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p><strong>iOS Safari:</strong> {t("iosInstructions")}</p>
            <p><strong>Android Chrome:</strong> {t("androidInstructions")}</p>
            <p><strong>Desktop Chrome/Edge:</strong> {t("desktopInstructions")}</p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

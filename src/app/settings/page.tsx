"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff, CheckCircle, XCircle, RefreshCw, Smartphone, Download, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type PermissionStatus = "default" | "granted" | "denied" | "unsupported";
type ServiceWorkerStatus = "checking" | "registered" | "not-registered" | "unsupported";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
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
      body: t("pwa.testNotificationBody"),
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      tag: "test-notification",
      requireInteraction: false,
    };

    try {
      if (swRegistration) {
        await swRegistration.showNotification(t("pwa.testNotificationTitle"), notificationOptions);
      } else {
        new Notification(t("pwa.testNotificationTitle"), notificationOptions);
      }
      setLastNotificationTime(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Error sending notification:", error);
      try {
        new Notification(t("pwa.testNotificationTitle"), notificationOptions);
        setLastNotificationTime(new Date().toLocaleTimeString());
      } catch (fallbackError) {
        console.error("Fallback notification also failed:", fallbackError);
      }
    }
  };

  const getPermissionBadge = () => {
    switch (permissionStatus) {
      case "granted":
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />{t("pwa.permissionGranted")}</Badge>;
      case "denied":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{t("pwa.permissionDenied")}</Badge>;
      case "unsupported":
        return <Badge variant="secondary">{t("pwa.permissionUnsupported")}</Badge>;
      default:
        return <Badge variant="outline">{t("pwa.permissionDefault")}</Badge>;
    }
  };

  const getSwStatusBadge = () => {
    switch (swStatus) {
      case "registered":
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />{t("pwa.swRegistered")}</Badge>;
      case "not-registered":
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" />{t("pwa.swNotRegistered")}</Badge>;
      case "unsupported":
        return <Badge variant="secondary">{t("pwa.swUnsupported")}</Badge>;
      default:
        return <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />{t("pwa.swChecking")}</Badge>;
    }
  };

  const refreshStatus = () => {
    setSwStatus("checking");
    checkNotificationSupport();
    checkServiceWorker();
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
              <p className="text-xs text-muted-foreground">
                {t("pwa.deniedInstructions")}
              </p>
            )}

            {lastNotificationTime && (
              <p className="text-xs text-muted-foreground">
                {t("pwa.lastNotification")}: {lastNotificationTime}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Install Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("pwa.installInstructions")}</CardTitle>
            <CardDescription>{t("pwa.installDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p><strong>iOS Safari:</strong> {t("pwa.iosInstructions")}</p>
            <p><strong>Android Chrome:</strong> {t("pwa.androidInstructions")}</p>
            <p><strong>Desktop Chrome/Edge:</strong> {t("pwa.desktopInstructions")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Bug, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function NotificationsDebugPage() {
  const t = useTranslations("settings.notificationsDebug");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; processed?: number; error?: string; details?: unknown } | null>(null);

  const runCron = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/notifications/run-cron", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Request failed", details: data.details });
        return;
      }
      setResult({ ok: data.ok, processed: data.processed, details: data });
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
        details: undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/settings">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bug className="w-6 h-6" />
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("runCronTitle")}</CardTitle>
            <CardDescription>{t("runCronDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runCron}
              disabled={loading}
            >
              {loading ? (
                tCommon("loading")
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  {t("runCron")}
                </>
              )}
            </Button>
            {result && (
              <div className="rounded-lg border p-3 text-sm font-mono bg-muted/50">
                {result.ok !== false ? (
                  <p className="text-green-600 dark:text-green-400">
                    {t("runCronSuccess")} {result.processed != null && `(${result.processed} users processed)`}
                  </p>
                ) : (
                  <p className="text-destructive">{t("runCronError")}: {result.error}</p>
                )}
                {result.details != null && (
                  <pre className="mt-2 text-xs overflow-auto max-h-40">
                    {JSON.stringify(result.details, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Button variant="outline" asChild>
          <Link href="/settings">{t("backToSettings")}</Link>
        </Button>
      </div>
    </div>
  );
}

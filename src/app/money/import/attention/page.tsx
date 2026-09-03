"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { MONEY_ACCOUNT_SOURCES } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  pingExtension,
  requestExtensionAttention,
  requestExtensionRun,
  setExtensionStaleAfter,
  type ExtensionAttention,
  type ExtensionAttentionSource,
} from "@/lib/money/extension-bridge";

/**
 * What the extension cannot do alone, listed for the person who can.
 *
 * Unattended import runs while the bank keeps the browser signed in. Once the bank signs it out,
 * every attempt lands on the login screen and the extension goes quiet -- by design, since nobody
 * asked for those runs. This page is where the extension sends the person when a source has been
 * quiet for longer than they allow: each stale source with an Update that opens the bank, and the
 * promise that signing in is all they have to do.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** While a requested run is waiting on a sign-in, the page asks again this often to see it land. */
const PENDING_REFRESH_MS = 20_000;

type Translate = ReturnType<typeof useTranslations>;
type PageState = "loading" | "inactive" | "unavailable" | "ready";
type RequestState = { kind: "sent" } | { kind: "failed"; error: string | null };

function formatMoment(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "dd.MM.yyyy HH:mm");
}

/** The bank's name as the other money screens give it; the raw id for one they do not know. */
function sourceLabel(t: Translate, sourceId: string): string {
  const accountSource = sourceId.replace(/_web$/, "");
  if ((MONEY_ACCOUNT_SOURCES as readonly string[]).includes(accountSource)) {
    const key = `money.accountSource${accountSource.charAt(0).toUpperCase()}${accountSource.slice(1)}`;
    return t(key);
  }
  return sourceId;
}

function describeFreshness(source: ExtensionAttentionSource, t: Translate): string {
  if (source.last_ok_at === null) {
    return t("money.importAttentionNeverRan", { date: formatMoment(source.since) });
  }
  if (source.stale) {
    return t("money.importAttentionStale", {
      days: Math.floor(source.stale_for_ms / DAY_MS),
      date: formatMoment(source.last_ok_at),
    });
  }
  return t("money.importAttentionFresh", { date: formatMoment(source.last_ok_at) });
}

function thresholdDaysOf(staleAfterMs: number): number {
  return Math.max(1, Math.round(staleAfterMs / DAY_MS));
}

export default function MoneyImportAttentionPage() {
  const t = useTranslations();
  const [state, setState] = useState<PageState>("loading");
  const [attention, setAttention] = useState<ExtensionAttention | null>(null);
  const [requests, setRequests] = useState<Record<string, RequestState>>({});
  const [thresholdDays, setThresholdDays] = useState("1");
  const [thresholdNotice, setThresholdNotice] = useState<string | null>(null);
  // A value the person is typing is not overwritten by a refresh landing mid-keystroke.
  const thresholdTouched = useRef(false);

  const refresh = useCallback(async () => {
    const alive = await pingExtension();
    if (!alive) {
      setState("inactive");
      setAttention(null);
      return;
    }
    // The ping answered, so the extension is there; a status it cannot give is an older
    // version or a slow service-worker wake, not an absence.
    const next = await requestExtensionAttention();
    if (!next) {
      setState("unavailable");
      setAttention(null);
      return;
    }
    setAttention(next);
    setState("ready");
    if (!thresholdTouched.current) setThresholdDays(String(thresholdDaysOf(next.stale_after_ms)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingRun = attention?.sources.some((source) => source.run_requested) ?? false;
  useEffect(() => {
    if (state !== "ready" || !pendingRun) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, PENDING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [state, pendingRun, refresh]);

  const handleUpdate = useCallback(
    async (sourceId: string) => {
      const reply = await requestExtensionRun(sourceId);
      setRequests((previous) => ({
        ...previous,
        [sourceId]: reply.ok ? { kind: "sent" } : { kind: "failed", error: reply.error },
      }));
      if (reply.ok) void refresh();
    },
    [refresh],
  );

  const handleSaveThreshold = useCallback(async () => {
    const days = Number(thresholdDays);
    if (!Number.isInteger(days) || days < 1) {
      setThresholdNotice(t("money.importAttentionThresholdInvalid"));
      return;
    }
    const stored = await setExtensionStaleAfter(days * DAY_MS);
    if (stored === null) {
      setThresholdNotice(t("money.importAutoStatusUnavailable"));
      return;
    }
    thresholdTouched.current = false;
    setThresholdNotice(t("money.importAttentionThresholdSaved", { days: thresholdDaysOf(stored) }));
    void refresh();
  }, [thresholdDays, refresh, t]);

  const grant = attention?.grant ?? null;
  const sources = attention?.sources ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{t("money.importAttentionTitle")}</h1>
        <Button variant="outline" asChild>
          <Link href="/money/import">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("money.importAttentionOpenImport")}
          </Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("money.importAttentionIntro")}</p>

      <Card data-testid="money-import-attention">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t("money.importAttentionSourcesTitle")}</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
            {t("common.refresh")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {state === "loading" && (
            <p className="text-muted-foreground">{t("money.importExtensionChecking")}</p>
          )}
          {state === "inactive" && (
            <p className="text-muted-foreground">{t("money.importAutoStatusExtensionInactive")}</p>
          )}
          {state === "unavailable" && (
            <p className="text-muted-foreground">{t("money.importAutoStatusUnavailable")}</p>
          )}
          {state === "ready" && !grant && (
            <p className="text-muted-foreground">{t("money.importAutoStatusNoGrant")}</p>
          )}
          {state === "ready" && grant && sources.length === 0 && (
            <p className="text-muted-foreground">{t("money.importAttentionNoSources")}</p>
          )}
          {state === "ready" && grant && sources.length > 0 && attention?.stale_count === 0 && (
            <p className="text-muted-foreground">{t("money.importAttentionAllFresh")}</p>
          )}
          {state === "ready" &&
            sources.map((source) => {
              const request = requests[source.source_id];
              const requested = request?.kind === "sent" || source.run_requested;
              return (
                <div
                  key={source.source_id}
                  className="space-y-2 rounded-md border px-3 py-2"
                  data-testid={`money-import-attention-${source.source_id}`}
                  data-stale={source.stale ? "true" : "false"}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium">{sourceLabel(t, source.source_id)}</div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleUpdate(source.source_id)}
                    >
                      {t("money.importAttentionUpdate")}
                    </Button>
                  </div>
                  <p className={source.stale ? "text-destructive" : "text-muted-foreground"}>
                    {describeFreshness(source, t)}
                  </p>
                  {requested && (
                    <p className="text-muted-foreground">{t("money.importAttentionRequested")}</p>
                  )}
                  {request?.kind === "failed" && (
                    <p className="text-destructive">
                      {t("money.importAttentionRequestFailed", {
                        error: request.error ?? t("money.importAutoStatusUnavailable"),
                      })}
                    </p>
                  )}
                </div>
              );
            })}
          {state === "ready" && grant && (
            <p className="text-xs text-muted-foreground">{t("money.importAttentionUpdateHint")}</p>
          )}
        </CardContent>
      </Card>

      {state === "ready" && (
        <Card data-testid="money-import-attention-settings">
          <CardHeader>
            <CardTitle className="text-base">{t("money.importAttentionSettingsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <Label htmlFor="money-import-attention-threshold">
                  {t("money.importAttentionThresholdLabel")}
                </Label>
                <Input
                  id="money-import-attention-threshold"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  className="w-28"
                  value={thresholdDays}
                  onChange={(event) => {
                    thresholdTouched.current = true;
                    setThresholdDays(event.target.value);
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={() => void handleSaveThreshold()}>
                {t("common.save")}
              </Button>
            </div>
            {thresholdNotice && <p className="text-muted-foreground">{thresholdNotice}</p>}
            <p className="text-xs text-muted-foreground">{t("money.importAttentionBadgeHint")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

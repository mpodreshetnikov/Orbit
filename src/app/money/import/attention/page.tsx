"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { MONEY_ACCOUNT_SOURCES } from "@/types";
import { useUIStore } from "@/stores/ui-store";
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
  // The last refresh got no answer; what is shown is the answer before it.
  const [refreshMissed, setRefreshMissed] = useState(false);
  const [thresholdDays, setThresholdDays] = useState("1");
  const [thresholdNotice, setThresholdNotice] = useState<string | null>(null);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  // A value the person is typing is not overwritten by a refresh landing mid-keystroke.
  const thresholdTouched = useRef(false);
  const selectedPersonId = useUIStore((store) => store.selectedPersonId);

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
      // One missed answer after a good one is a slow wake, not a lost extension: the last
      // answer stays on the screen and the polling below keeps asking. Only a page that never
      // got an answer says the extension cannot give one.
      setRefreshMissed(true);
      setState((current) => (current === "ready" ? current : "unavailable"));
      return;
    }
    setRefreshMissed(false);
    setAttention(next);
    setState("ready");
    // A request the extension no longer holds has settled -- the run succeeded, or the hour
    // passed -- so the page stops telling the person to sign in for it.
    setRequests((previous) => {
      const settled = next.sources.filter(
        (source) => !source.run_requested && previous[source.source_id]?.kind === "sent",
      );
      if (settled.length === 0) return previous;
      const reconciled = { ...previous };
      for (const source of settled) delete reconciled[source.source_id];
      return reconciled;
    });
    if (!thresholdTouched.current) setThresholdDays(String(thresholdDaysOf(next.stale_after_ms)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pending as the extension reports it, or as this page asked -- a missed refresh must not
  // stop the asking, or a run that finishes during a slow wake is never seen finishing.
  const pendingRun =
    (attention?.sources.some((source) => source.run_requested) ?? false) ||
    Object.values(requests).some((request) => request.kind === "sent");
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
    const submitted = thresholdDays;
    const days = Number(submitted);
    if (!Number.isInteger(days) || days < 1) {
      setThresholdNotice(t("money.importAttentionThresholdInvalid"));
      return;
    }
    setThresholdSaving(true);
    try {
      const stored = await setExtensionStaleAfter(days * DAY_MS);
      if (stored === null) {
        setThresholdNotice(t("money.importAutoStatusUnavailable"));
        return;
      }
      // The field is handed back to the refresh only if it still shows what was saved; an
      // edit made while the save was in flight is the person's, and stays.
      setThresholdDays((current) => {
        if (current === submitted) thresholdTouched.current = false;
        return current;
      });
      setThresholdNotice(
        t("money.importAttentionThresholdSaved", { days: thresholdDaysOf(stored) }),
      );
      void refresh();
    } finally {
      setThresholdSaving(false);
    }
  }, [thresholdDays, refresh, t]);

  const grant = attention?.grant ?? null;
  // A key held for someone else is not this person's: its sources are not shown as theirs,
  // and Update would import for the key's person, whatever the app shell says.
  const grantIsForSelectedPerson = Boolean(grant && grant.person_id === selectedPersonId);
  const sources = grantIsForSelectedPerson ? (attention?.sources ?? []) : [];

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
          {state === "ready" && grant && !grantIsForSelectedPerson && (
            <p className="text-muted-foreground" data-testid="money-import-attention-other-person">
              {t("money.importAutoStatusGrantOtherPerson", {
                date: formatMoment(grant.received_at),
              })}
            </p>
          )}
          {state === "ready" && grantIsForSelectedPerson && sources.length === 0 && (
            <p className="text-muted-foreground">{t("money.importAttentionNoSources")}</p>
          )}
          {state === "ready" &&
            grantIsForSelectedPerson &&
            sources.length > 0 &&
            attention?.stale_count === 0 && (
              <p className="text-muted-foreground">{t("money.importAttentionAllFresh")}</p>
            )}
          {state === "ready" && refreshMissed && (
            <p className="text-muted-foreground" data-testid="money-import-attention-missed">
              {t("money.importAttentionRefreshMissed")}
            </p>
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
          {state === "ready" && grantIsForSelectedPerson && (
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
              <Button
                type="button"
                variant="outline"
                disabled={thresholdSaving}
                onClick={() => void handleSaveThreshold()}
              >
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

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { importBankOfSource } from "@/types/money-import-sources";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateMoneyImportGrant,
  useMoneyImportGrants,
  useRevokeMoneyImportGrant,
  type MoneyImportGrant,
} from "@/hooks/use-money-import-grants";

interface MoneyImportGrantsProps {
  t: (key: string, values?: Record<string, string | number>) => string;
  personId: string | null;
  /** Extension-backed sources a grant may be issued for. */
  availableSources: Array<{ sourceId: string; label: string }>;
  /**
   * Hands the key to the extension, resolving on its acknowledgement. False means the extension
   * did not take it -- not installed, too old, or it refused the payload -- and the key is then
   * only recoverable from this screen, so the panel says so instead of claiming delivery.
   */
  onSendToExtension: (grant: {
    token: string;
    personId: string;
    allowedSources: string[];
  }) => Promise<boolean>;
}

type GrantState = "active" | "expired" | "revoked";

function grantState(grant: MoneyImportGrant, nowMs: number): GrantState {
  if (grant.revoked_at) return "revoked";
  if (grant.expires_at) {
    // A present expiry that cannot be read is not "no expiry". `timestamptz` accepts `infinity`,
    // which parses to NaN here, and the Edge Function's isGrantUsable already refuses such a
    // grant — so reading it as Active would make the screen disagree with authentication.
    const expiresAtMs = new Date(grant.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return "expired";
  }
  return "active";
}

const STATE_ORDER: Record<GrantState, number> = { active: 0, expired: 1, revoked: 2 };

function timeOf(value: string | null): number {
  const ms = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Keys in use first, the most recently used on top; expired after them, revoked at the end. */
export function orderGrants(grants: MoneyImportGrant[], nowMs: number): MoneyImportGrant[] {
  return [...grants].sort(
    (a, b) =>
      STATE_ORDER[grantState(a, nowMs)] - STATE_ORDER[grantState(b, nowMs)] ||
      timeOf(b.last_used_at) - timeOf(a.last_used_at) ||
      timeOf(b.created_at) - timeOf(a.created_at),
  );
}

/** When the key last let the extension in: today and yesterday by time, older ones by date. */
function describeLastUse(
  lastUsedAt: string | null,
  t: MoneyImportGrantsProps["t"],
  nowMs: number,
): string {
  const used = lastUsedAt ? new Date(lastUsedAt) : null;
  if (!used || !Number.isFinite(used.getTime())) return t("money.importGrantNeverUsed");
  const time = format(used, "HH:mm");
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  if (used.getTime() >= today.getTime()) return t("money.importGrantUsedToday", { time });
  if (used.getTime() >= today.getTime() - dayMs)
    return t("money.importGrantUsedYesterday", { time });
  return t("money.importGrantUsedOn", { date: format(used, "dd.MM.yyyy") });
}

/**
 * Issues and revokes the long-lived credentials the extension uses to start an import on its
 * own. The token is shown exactly once — only its hash is stored — so the only recovery from
 * losing it is issuing another one.
 */
export function MoneyImportGrants({
  t,
  personId,
  availableSources,
  onSendToExtension,
}: MoneyImportGrantsProps) {
  const { data: grants, isLoading, isError, refetch } = useMoneyImportGrants();
  const createGrant = useCreateMoneyImportGrant();
  const revokeGrant = useRevokeMoneyImportGrant();

  const [label, setLabel] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>(() =>
    availableSources.map((source) => source.sourceId),
  );
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  // The token authorises imports for the person it was issued for. Leaving it on screen after
  // the page's selected person changes would present it in the new person's context -- the list
  // and the form beneath it have already switched -- which is how a credential ends up saved
  // against the wrong payer.
  useEffect(() => {
    setIssuedToken(null);
  }, [personId]);
  // Read by an in-flight issuance, which cannot see the state it was started with.
  const personIdRef = useRef(personId);
  useEffect(() => {
    personIdRef.current = personId;
  }, [personId]);

  // Frozen at first render this reported an expired grant as Active for as long as the page
  // stayed open, while the backend had already begun refusing it. A minute is finer than any
  // expiry a person would set and costs one comparison.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const visibleGrants = useMemo(
    () =>
      personId
        ? orderGrants(
            (grants ?? []).filter((grant) => grant.person_id === personId),
            nowMs,
          )
        : [],
    [grants, personId, nowMs],
  );
  // Revoked keys only pile up; they wait folded under one line so the list stays short.
  const liveGrants = visibleGrants.filter((grant) => !grant.revoked_at);
  const revokedGrants = visibleGrants.filter((grant) => grant.revoked_at);
  const [showRevoked, setShowRevoked] = useState(false);
  const sourceLabels = useMemo(
    () => new Map(availableSources.map((source) => [source.sourceId, source.label])),
    [availableSources],
  );
  // A key names the banks it may import from, by the names the rest of the page uses.
  const bankName = (sourceId: string) => {
    const bank = importBankOfSource(sourceId);
    if (bank === "tbank") return t("money.importBankTbank");
    if (bank === "alfa") return t("money.importBankAlfa");
    return sourceLabels.get(sourceId) ?? sourceId;
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSources((current) =>
      current.includes(sourceId)
        ? current.filter((value) => value !== sourceId)
        : [...current, sourceId],
    );
  };

  const handleCreate = async () => {
    if (!personId) return;
    if (!label.trim()) {
      toast.error(t("money.importGrantLabelRequired"));
      return;
    }
    if (selectedSources.length === 0) {
      toast.error(t("money.importGrantSourcesRequired"));
      return;
    }

    try {
      const issuedForPersonId = personId;
      // The sources the grant is issued for: a checkbox toggled while the request is in flight
      // must not reach the extension as the grant's, since the row keeps what was submitted.
      const issuedSources = selectedSources;
      const created = await createGrant.mutateAsync({
        personId: issuedForPersonId,
        label,
        allowedSources: issuedSources,
      });
      // The mutation captured the person it was submitted for. If the selection moved on while
      // it was in flight, showing the key now would put one person's credential in another
      // person's panel -- the effect above already cleared it once for exactly that reason.
      if (personIdRef.current !== issuedForPersonId) {
        toast.success(t("money.importGrantCreatedForOtherPerson"));
        setLabel("");
        return;
      }
      setLabel("");
      // The key exists to be handed to the extension, and a person should not have to carry it
      // there by hand (2026-10-18: "why am I even seeing a key"). It is shown only when no
      // extension took it: on a device without one, the screen is the one way to copy it.
      setDelivering(true);
      let delivered = false;
      try {
        delivered = await onSendToExtension({
          token: created.token,
          personId: issuedForPersonId,
          allowedSources: created.grant.allowed_sources ?? issuedSources,
        });
      } finally {
        setDelivering(false);
      }
      // The selection may have moved on during the probe as well; the same rule holds.
      if (personIdRef.current !== issuedForPersonId) {
        toast.success(
          t(
            delivered
              ? "money.importGrantSentToExtension"
              : "money.importGrantCreatedForOtherPerson",
          ),
        );
        return;
      }
      if (delivered) {
        // An older key still on screen from an issuance nothing took would otherwise stay
        // offered, and sending it would overwrite the key the extension just received.
        setIssuedToken(null);
        toast.success(t("money.importGrantSentToExtension"));
        return;
      }
      setIssuedToken(created.token);
      toast.message(t("money.importGrantShownToCopy"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.importGrantCreateFailed"));
    }
  };

  const [sending, setSending] = useState(false);
  // A new key is being handed to the extension; the panel says so instead of showing the key.
  const [delivering, setDelivering] = useState(false);

  const handleSendToExtension = async () => {
    if (!issuedToken || !personId) return;
    setSending(true);
    try {
      const delivered = await onSendToExtension({
        token: issuedToken,
        personId,
        allowedSources: selectedSources,
      });
      if (delivered) {
        toast.success(t("money.importGrantSentToExtension"));
        setIssuedToken(null);
        return;
      }
      toast.error(t("money.importGrantSendFailed"));
    } finally {
      setSending(false);
    }
  };

  const handleCopyToken = async () => {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      toast.success(t("money.importGrantCopied"));
    } catch {
      // A refused clipboard is not a failure worth a red toast: the token is on screen and can
      // be selected. Saying nothing would be worse than saying it did not copy.
      toast.error(t("money.importGrantCopyFailed"));
    }
  };

  const handleRevoke = async (grantId: string) => {
    // The database makes this one-way -- the authority trigger refuses to clear or rewrite
    // revoked_at -- so the only recovery from a stray click is issuing and distributing a new
    // key. Naming the grant in the prompt is the point: it is what tells you it is the wrong one.
    const grant = visibleGrants.find((candidate) => candidate.id === grantId);
    if (!globalThis.confirm(t("money.importGrantRevokeConfirm", { label: grant?.label ?? "" }))) {
      return;
    }

    try {
      await revokeGrant.mutateAsync(grantId);
      toast.success(t("money.importGrantRevoked"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.importGrantRevokeFailed"));
    }
  };

  const renderGrant = (grant: MoneyImportGrant) => {
    const state = grantState(grant, nowMs);
    const banks = grant.allowed_sources.map((sourceId) => bankName(sourceId)).join(", ");
    return (
      <li
        key={grant.id}
        className={`flex items-center gap-3 px-3 py-2 ${state === "active" ? "" : "text-muted-foreground"}`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{grant.label}</div>
          <div className="text-xs text-muted-foreground">
            {state === "revoked"
              ? t("money.importGrantRevoked")
              : state === "expired"
                ? t("money.importGrantExpired")
                : describeLastUse(grant.last_used_at, t, nowMs)}
            {banks && <span className="whitespace-nowrap"> · {banks}</span>}
          </div>
        </div>
        {!grant.revoked_at && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => void handleRevoke(grant.id)}
            disabled={revokeGrant.isPending}
          >
            {t("money.importGrantRevoke")}
          </Button>
        )}
      </li>
    );
  };

  return (
    <Card data-testid="money-import-grants">
      <CardContent className="space-y-4 p-0">
        <p className="text-xs text-muted-foreground">{t("money.importGrantsDescription")}</p>

        {delivering && (
          <p className="text-sm text-muted-foreground" data-testid="money-import-grant-delivering">
            {t("money.importGrantDelivering")}
          </p>
        )}

        {issuedToken && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium">{t("money.importGrantTokenShownOnce")}</p>
            <code
              className="block overflow-x-auto rounded bg-background px-2 py-1 font-mono text-xs"
              data-testid="money-import-grant-token"
            >
              {issuedToken}
            </code>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSendToExtension()}
                disabled={sending}
              >
                {t("money.importGrantSendToExtension")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleCopyToken}>
                {t("money.importGrantCopy")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIssuedToken(null)}
              >
                {t("common.close")}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

        {!isLoading && isError && (
          // "No grants yet" on a failed read would hide live credentials and their revoke
          // buttons on the only screen that has them, and would look exactly like having none.
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-sm">{t("money.importGrantsLoadFailed")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}

        {!isLoading && !isError && visibleGrants.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("money.importGrantsEmpty")}</p>
        )}

        {liveGrants.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="money-import-grant-list">
            {liveGrants.map(renderGrant)}
          </ul>
        )}
        {revokedGrants.length > 0 && (
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={showRevoked}
              onClick={() => setShowRevoked((open) => !open)}
            >
              {showRevoked ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {t("money.importGrantRevokedToggle", { count: revokedGrants.length })}
            </button>
            {showRevoked && (
              <ul
                className="mt-2 divide-y rounded-lg border"
                data-testid="money-import-grant-revoked-list"
              >
                {revokedGrants.map(renderGrant)}
              </ul>
            )}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="money-import-grant-label">{t("money.importGrantLabel")}</Label>
            <Input
              id="money-import-grant-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("money.importGrantLabelPlaceholder")}
            />
          </div>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!personId || createGrant.isPending}
          >
            {createGrant.isPending ? t("common.loading") : t("money.importGrantCreate")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-4">
          {availableSources.map((source) => (
            <label key={source.sourceId} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selectedSources.includes(source.sourceId)}
                onCheckedChange={() => toggleSource(source.sourceId)}
              />
              {source.label}
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

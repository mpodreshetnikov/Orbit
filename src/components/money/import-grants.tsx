"use client";

import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateMoneyImportGrant,
  useMoneyImportGrants,
  useRevokeMoneyImportGrant,
  type MoneyImportGrant,
} from "@/hooks/use-money-import-grants";
import { getFunctionUrl } from "@/app/money/import/money-import-client";

const EXTENSION_WEBAPP_SOURCE = "orbit-webapp";

interface MoneyImportGrantsProps {
  t: (key: string, values?: Record<string, string | number>) => string;
  personId: string | null;
  /** Extension-backed sources a grant may be issued for. */
  availableSources: Array<{ sourceId: string; label: string }>;
}

function describeGrantState(
  grant: MoneyImportGrant,
  t: MoneyImportGrantsProps["t"],
  nowMs: number,
): { label: string; tone: "active" | "inactive" } {
  if (grant.revoked_at) return { label: t("money.importGrantRevoked"), tone: "inactive" };
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= nowMs) {
    return { label: t("money.importGrantExpired"), tone: "inactive" };
  }
  return { label: t("money.importGrantActive"), tone: "active" };
}

/**
 * Issues and revokes the long-lived credentials the extension uses to start an import on its
 * own. The token is shown exactly once — only its hash is stored — so the only recovery from
 * losing it is issuing another one.
 */
export function MoneyImportGrants({ t, personId, availableSources }: MoneyImportGrantsProps) {
  const { data: grants, isLoading } = useMoneyImportGrants();
  const createGrant = useCreateMoneyImportGrant();
  const revokeGrant = useRevokeMoneyImportGrant();

  const [label, setLabel] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>(() =>
    availableSources.map((source) => source.sourceId),
  );
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const nowMs = useMemo(() => Date.now(), []);
  const visibleGrants = useMemo(
    () => (personId ? (grants ?? []).filter((grant) => grant.person_id === personId) : []),
    [grants, personId],
  );

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
      const created = await createGrant.mutateAsync({
        personId,
        label,
        allowedSources: selectedSources,
      });
      setIssuedToken(created.token);
      setLabel("");
      toast.success(t("money.importGrantCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.importGrantCreateFailed"));
    }
  };

  const handleSendToExtension = () => {
    if (!issuedToken) return;
    window.postMessage(
      {
        source: EXTENSION_WEBAPP_SOURCE,
        type: "MONEY_IMPORT_SET_GRANT",
        grant: {
          token: issuedToken,
          person_id: personId,
          allowed_sources: selectedSources,
          app_origin: window.location.origin,
          // Without this the extension stores the grant with no endpoint to call, and both
          // the visit-triggered run and the daily sweep return immediately — the grant would
          // exist and never do anything.
          function_url: getFunctionUrl("money-import"),
        },
      },
      "*",
    );
    toast.success(t("money.importGrantSentToExtension"));
  };

  const handleRevoke = async (grantId: string) => {
    try {
      await revokeGrant.mutateAsync(grantId);
      toast.success(t("money.importGrantRevoked"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.importGrantRevokeFailed"));
    }
  };

  return (
    <Card data-testid="money-import-grants">
      <CardHeader>
        <CardTitle className="text-base">{t("money.importGrantsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("money.importGrantsDescription")}</p>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
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
              <Button type="button" size="sm" onClick={handleSendToExtension}>
                {t("money.importGrantSendToExtension")}
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

        {!isLoading && visibleGrants.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("money.importGrantsEmpty")}</p>
        )}

        {visibleGrants.map((grant) => {
          const state = describeGrantState(grant, t, nowMs);
          return (
            <div
              key={grant.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{grant.label}</div>
                <div className="text-xs text-muted-foreground">
                  {grant.allowed_sources.join(", ") || "-"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={state.tone === "active" ? "default" : "secondary"}>
                  {state.label}
                </Badge>
                {!grant.revoked_at && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRevoke(grant.id)}
                    disabled={revokeGrant.isPending}
                  >
                    {t("money.importGrantRevoke")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

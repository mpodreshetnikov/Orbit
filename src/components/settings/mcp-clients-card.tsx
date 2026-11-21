"use client";

import React from "react";
import { Plug, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIntlLocale } from "@/lib/date-locale";
import { useMcpClients, useRevokeMcpClient } from "@/hooks/use-mcp-clients";
import type { McpConnectedClient } from "@/types/mcp-clients";

function formatWhen(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(locale);
}

function clientDisplayName(
  client: McpConnectedClient,
  unnamed: string,
): string {
  return client.clientName?.trim() || unnamed;
}

function ClientRow({
  client,
  revoking,
  onRevoke,
}: {
  client: McpConnectedClient;
  revoking: boolean;
  onRevoke: (client: McpConnectedClient) => void;
}) {
  const t = useTranslations("settings.mcp");
  const locale = useIntlLocale();
  const name = clientDisplayName(client, t("unnamedClient"));
  const lastUsed = formatWhen(client.lastUsedAt, locale);
  const connected = formatWhen(client.createdAt, locale);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`mcp-client-${client.grantId}`}
    >
      <div className="min-w-0 space-y-1">
        <p className="font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">
          {lastUsed ? t("lastUsed", { when: lastUsed }) : t("neverUsed")}
          {connected ? ` · ${t("connectedAt", { when: connected })}` : null}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={revoking}
        onClick={() => onRevoke(client)}
        data-testid={`mcp-client-revoke-${client.grantId}`}
      >
        <Unplug className="w-4 h-4 mr-2" />
        {revoking ? t("revoking") : t("revoke")}
      </Button>
    </div>
  );
}

export function McpClientsCard() {
  const t = useTranslations("settings.mcp");
  const tCommon = useTranslations("common");
  const { data: clients, isPending, isError, error, refetch, isFetching } = useMcpClients();
  const revoke = useRevokeMcpClient();
  const [pendingGrantId, setPendingGrantId] = React.useState<string | null>(null);
  const [confirmClient, setConfirmClient] = React.useState<McpConnectedClient | null>(null);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);

  const handleConfirmRevoke = async () => {
    if (!confirmClient) return;
    const grantId = confirmClient.grantId;
    setPendingGrantId(grantId);
    setRevokeError(null);
    try {
      await revoke.mutateAsync(grantId);
      setConfirmClient(null);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : t("revokeErrorFallback"));
    } finally {
      setPendingGrantId(null);
    }
  };

  return (
    <Card data-testid="mcp-clients-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="w-5 h-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? <p className="text-sm text-muted-foreground">{tCommon("loading")}</p> : null}

        {isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {t("loadError", {
                error: error instanceof Error ? error.message : t("loadErrorFallback"),
              })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {tCommon("refresh")}
            </Button>
          </div>
        ) : null}

        {revokeError ? (
          <p className="text-sm text-destructive" data-testid="mcp-clients-revoke-error">
            {t("revokeError", { error: revokeError })}
          </p>
        ) : null}

        {!isPending && !isError && (clients?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="mcp-clients-empty">
            {t("empty")}
          </p>
        ) : null}

        {!isPending && !isError
          ? (clients ?? []).map((client) => (
              <ClientRow
                key={client.grantId}
                client={client}
                revoking={pendingGrantId === client.grantId && revoke.isPending}
                onRevoke={(next) => {
                  setRevokeError(null);
                  setConfirmClient(next);
                }}
              />
            ))
          : null}
      </CardContent>

      <AlertDialog
        open={confirmClient != null}
        onOpenChange={(open) => {
          if (!open && pendingGrantId == null) setConfirmClient(null);
        }}
      >
        <AlertDialogContent data-testid="mcp-client-revoke-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("revokeConfirmTitle", {
                name: confirmClient
                  ? clientDisplayName(confirmClient, t("unnamedClient"))
                  : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("revokeConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingGrantId != null}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmRevoke();
              }}
              disabled={pendingGrantId != null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="mcp-client-revoke-confirm-action"
            >
              {pendingGrantId != null ? t("revoking") : t("revokeConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

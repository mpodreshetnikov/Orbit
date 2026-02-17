"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDropzone } from "react-dropzone";
import {
  CheckCircle2,
  FileSpreadsheet,
  HelpCircle,
  LinkIcon,
  Plus,
  Upload,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import {
  useMoneyAccounts,
  useCreateMoneyAccount,
  useMoneyCardsByAccountIds,
  useCreateMoneyCard,
} from "@/hooks";
import { createClient } from "@/lib/supabase";
import { getConnectors } from "@/lib/import/connector-types";
import type {
  BatchTransactionRow,
  CanonicalTransactionRow,
  MoneyImportApplyResult,
  MoneyImportSessionCreateResult,
  MoneyImportSessionStatus,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { format } from "date-fns";

import "@/lib/import/connectors/tbank-csv";
import "@/lib/import/connectors/tbank-web";

const TBANK_ICON_URL =
  "https://cdn.tbank.ru/static/pfa-multimedia/images/ae288629-59d7-4eb6-b074-8bb0549a43b6.svg";

const EXTENSION_WEBAPP_SOURCE = "orbit-webapp";
const EXTENSION_BRIDGE_SOURCE = "orbit-extension";
const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? "";

function getFunctionUrl(functionName: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");
  return `${base}/functions/v1/${functionName}`;
}

async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

async function callMoneyImportAction<T>(
  action: Record<string, unknown>,
  accessToken: string
): Promise<T> {
  const response = await fetch(getFunctionUrl("money-import"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(action),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Money import request failed"));
  }
  return payload as T;
}

function computeProgressPercent(status: MoneyImportSessionStatus | null): number {
  if (!status?.batch) return 0;
  if (typeof status.batch.progress_percent === "number") {
    return Math.max(0, Math.min(100, status.batch.progress_percent));
  }

  const from = status.batch.window_from
    ? new Date(status.batch.window_from).getTime()
    : Number.NaN;
  const to = status.batch.window_to
    ? new Date(status.batch.window_to).getTime()
    : Number.NaN;
  const parsed = status.batch.parsed_through_at
    ? new Date(status.batch.parsed_through_at).getTime()
    : Number.NaN;

  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(parsed)) {
    return 0;
  }
  if (to <= from) return parsed <= from ? 100 : 0;

  const done = to - parsed;
  const total = to - from;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export default function MoneyImportPage() {
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const createAccountMutation = useCreateMoneyAccount();
  const createCardMutation = useCreateMoneyCard();

  const connectors = getConnectors();

  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<{
    transactions: CanonicalTransactionRow[];
    errors?: string[];
  } | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [accountMapping, setAccountMapping] = useState<Record<string, string>>({});
  const [defaultAccountId, setDefaultAccountId] = useState<string>("");

  const [extensionActive, setExtensionActive] = useState<boolean | null>(null);
  const [extensionStatusMessage, setExtensionStatusMessage] = useState<string | null>(null);
  const [isStartingExtension, setIsStartingExtension] = useState(false);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<MoneyImportSessionStatus | null>(null);

  const pollingRef = useRef<number | null>(null);

  const selectedConnector = useMemo(
    () => connectors.find((c) => c.sourceId === selectedSourceId),
    [connectors, selectedSourceId]
  );

  const isFileConnector = selectedConnector?.kind === "file";
  const isExtensionConnector = selectedConnector?.kind === "extension";

  const sourceAccounts = useMemo(() => {
    if (!accounts || !selectedConnector) return [];
    const source = selectedConnector.sourceId === "tbank_web" ? "tbank" : selectedConnector.sourceId;
    return accounts.filter((a) => a.source === source);
  }, [accounts, selectedConnector]);

  const sourceAccountIds = useMemo(() => sourceAccounts.map((a) => a.id), [sourceAccounts]);
  const { data: cardsForImport } = useMoneyCardsByAccountIds(sourceAccountIds);

  const hintToAccountIdFromCards = useMemo(() => {
    const map: Record<string, string> = {};
    (cardsForImport ?? []).forEach((card) => {
      map[card.last4] = card.account_id;
    });
    return map;
  }, [cardsForImport]);

  useEffect(() => {
    if (!parseResult?.transactions.length) return;
    setAccountMapping((prev) => ({ ...hintToAccountIdFromCards, ...prev }));
    if (sourceAccounts.length === 1 && !defaultAccountId) {
      setDefaultAccountId(sourceAccounts[0].id);
    }
  }, [parseResult?.transactions.length, hintToAccountIdFromCards, sourceAccounts, defaultAccountId]);

  useEffect(() => {
    if (!activeSessionId) return;

    const poll = async () => {
      try {
        const accessToken = await getAccessToken();
        const status = await callMoneyImportAction<MoneyImportSessionStatus>(
          {
            action: "session_status",
            session_id: activeSessionId,
          },
          accessToken
        );

        setSessionStatus(status);
        if (status.batch?.id) {
          setActiveBatchId(status.batch.id);
        }

        if (status.batch?.status === "completed" && status.batch.id) {
          if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          router.push(`/money/import/reports/${status.batch.id}`);
        }
      } catch (error) {
        setExtensionStatusMessage(error instanceof Error ? error.message : "Failed to poll session status");
      }
    };

    poll();
    pollingRef.current = window.setInterval(poll, 2000);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeSessionId, router]);

  useEffect(() => {
    const onBridgeMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;

      if (data.type === "MONEY_IMPORT_PROGRESS" && typeof data.parsed_transactions_count === "number") {
        setSessionStatus((prev) => {
          if (!prev?.batch) return prev;
          return {
            ...prev,
            batch: {
              ...prev.batch,
              parsed_transactions_count: data.parsed_transactions_count as number,
              parsed_through_at:
                typeof data.parsed_through_at === "string"
                  ? (data.parsed_through_at as string)
                  : prev.batch.parsed_through_at,
            },
          };
        });
      }

      if (data.type === "MONEY_IMPORT_DONE" && typeof data.batch_id === "string") {
        router.push(`/money/import/reports/${data.batch_id}`);
      }

      if (data.type === "MONEY_IMPORT_ERROR") {
        setExtensionStatusMessage(
          typeof data.error === "string" ? data.error : "Extension import failed"
        );
      }
    };

    window.addEventListener("message", onBridgeMessage);
    return () => window.removeEventListener("message", onBridgeMessage);
  }, [router]);

  const uniqueHints = useMemo(() => {
    if (!parseResult?.transactions.length) return [];
    const set = new Set<string>();
    parseResult.transactions.forEach((row) => {
      const hint = row.account_hint?.trim() || "";
      if (hint) set.add(hint);
    });
    return Array.from(set).sort();
  }, [parseResult?.transactions]);

  const resolveAccountId = useCallback(
    (row: CanonicalTransactionRow): string | null => {
      const hint = row.account_hint?.trim() || "";
      if (hint && accountMapping[hint]) return accountMapping[hint];
      return defaultAccountId || null;
    },
    [accountMapping, defaultAccountId]
  );

  const allRowsResolved = useMemo(() => {
    if (!parseResult?.transactions.length) return false;
    return parseResult.transactions.every((row) => resolveAccountId(row));
  }, [parseResult?.transactions, resolveAccountId]);

  const normalizeLast4 = useCallback((hint: string | null | undefined): string => {
    const digits = (hint ?? "").replace(/\D/g, "");
    return digits.slice(-4);
  }, []);

  const parseFile = useCallback(
    async (f: File) => {
      if (!selectedConnector || selectedConnector.kind !== "file") return;
      setFile(f);
      setParseResult(null);
      setIsParsing(true);
      try {
        const result = await selectedConnector.parse(f);
        setParseResult(result);
      } catch {
        setParseResult({
          transactions: [],
          errors: [t("money.importParseError")],
        });
      } finally {
        setIsParsing(false);
      }
    },
    [selectedConnector, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: isFileConnector
      ? selectedConnector?.fileAccept ?? {
          "text/csv": [".csv"],
        }
      : undefined,
    maxFiles: 1,
    disabled: !isFileConnector || isParsing,
    onDropAccepted: (acceptedFiles) => {
      const f = acceptedFiles[0];
      if (f) parseFile(f);
    },
  });

  const ensureCardsForRows = useCallback(
    async (rows: BatchTransactionRow[]) => {
      const cardIdByKey = new Map<string, string>();
      (cardsForImport ?? []).forEach((card) => {
        cardIdByKey.set(`${card.account_id}:${card.last4}`, card.id);
      });

      const uniqueAccountLast4 = new Map<string, { accountId: string; last4: string }>();
      rows.forEach((row) => {
        const last4 = normalizeLast4((row.raw_payload?.account_hint as string | undefined) ?? null);
        if (!last4) return;
        const key = `${row.account_id}:${last4}`;
        if (!uniqueAccountLast4.has(key)) {
          uniqueAccountLast4.set(key, { accountId: row.account_id, last4 });
        }
      });

      for (const { accountId, last4 } of uniqueAccountLast4.values()) {
        const key = `${accountId}:${last4}`;
        if (cardIdByKey.has(key)) continue;
        const card = await createCardMutation.mutateAsync({
          account_id: accountId,
          last4,
        });
        cardIdByKey.set(key, card.id);
      }

      return cardIdByKey;
    },
    [cardsForImport, createCardMutation, normalizeLast4]
  );

  const buildBatchRows = useCallback((): BatchTransactionRow[] => {
    if (!parseResult?.transactions.length) return [];
    return parseResult.transactions.map((row) => {
      const accountId = resolveAccountId(row);
      if (!accountId) throw new Error("Unresolved account mapping");
      return {
        account_id: accountId,
        card_id: row.card_id ?? null,
        source: row.source,
        external_id: row.external_id ?? null,
        posted_at: row.posted_at,
        amount: row.amount,
        currency: row.currency,
        transaction_type: row.transaction_type,
        status: row.status,
        merchant_name: row.merchant_name ?? null,
        mcc: row.mcc ?? null,
        comment: row.comment ?? null,
        is_transfer: row.is_transfer,
        transfer_group_id: row.transfer_group_id ?? null,
        raw_payload: {
          ...(row.raw_payload ?? {}),
          account_hint: row.account_hint ?? null,
        },
        dedupe_hash: row.dedupe_hash ?? null,
        line_items: row.line_items,
      };
    });
  }, [parseResult?.transactions, resolveAccountId]);

  const handleApplyFileImport = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "file") return;
    if (!parseResult?.transactions.length || !allRowsResolved) return;

    setIsSubmitting(true);
    setExtensionStatusMessage(null);

    try {
      const accessToken = await getAccessToken();
      const rows = buildBatchRows();
      await ensureCardsForRows(rows);

      const result = await callMoneyImportAction<MoneyImportApplyResult>(
        {
          action: "apply_rows",
          source: selectedConnector.sourceId,
          payer_person_id: selectedPersonId,
          import_type: "file",
          file_path: file?.name ?? null,
          rows,
        },
        accessToken
      );

      router.push(`/money/import/reports/${result.batch_id}`);
    } catch (error) {
      setParseResult((prev) => ({
        transactions: prev?.transactions ?? [],
        errors: [error instanceof Error ? error.message : "Import failed"],
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    allRowsResolved,
    buildBatchRows,
    ensureCardsForRows,
    file?.name,
    parseResult?.transactions,
    router,
    selectedConnector,
    selectedPersonId,
  ]);

  const pingExtension = useCallback(async (): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(false);
      }, 1500);

      const onMessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
        if (data.type !== "MONEY_IMPORT_PONG") return;

        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(true);
      };

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: EXTENSION_WEBAPP_SOURCE,
          type: "MONEY_IMPORT_PING",
          ts: Date.now(),
        },
        "*"
      );
    });
  }, []);

  const checkExtension = useCallback(async () => {
    setExtensionActive(null);
    const isActive = await pingExtension();
    setExtensionActive(isActive);
    setExtensionStatusMessage(isActive ? null : t("money.importExtensionInactive"));
  }, [pingExtension, t]);

  useEffect(() => {
    if (!isExtensionConnector) return;
    void checkExtension();
  }, [checkExtension, isExtensionConnector]);

  const sendSessionToExtension = useCallback(
    async (payload: MoneyImportSessionCreateResult): Promise<boolean> => {
      return await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve(false);
        }, 3000);

        const onMessage = (event: MessageEvent) => {
          const data = event.data as Record<string, unknown> | null;
          if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
          if (data.type !== "MONEY_IMPORT_SESSION_ACK") return;

          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          resolve(true);
        };

        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            source: EXTENSION_WEBAPP_SOURCE,
            type: "MONEY_IMPORT_START_SESSION",
            session: {
              session_id: payload.session_id,
              session_token: payload.session_token,
              batch_id: payload.batch_id,
              source: payload.source,
              payer_person_id: payload.payer_person_id,
              expires_at: payload.expires_at,
              last_imported_at: payload.last_imported_at,
              function_url: getFunctionUrl("money-import"),
            },
          },
          "*"
        );
      });
    },
    []
  );

  const launchExtensionFallback = useCallback(
    (payload: MoneyImportSessionCreateResult): boolean => {
      if (!EXTENSION_ID) return false;
      const launchUrl =
        `chrome-extension://${EXTENSION_ID}/popup.html` +
        `?session_token=${encodeURIComponent(payload.session_token)}` +
        `&session_id=${encodeURIComponent(payload.session_id)}` +
        `&batch_id=${encodeURIComponent(payload.batch_id)}` +
        `&source=${encodeURIComponent(payload.source)}` +
        `&function_url=${encodeURIComponent(getFunctionUrl("money-import"))}` +
        `&payer_person_id=${encodeURIComponent(payload.payer_person_id)}` +
        `&expires_at=${encodeURIComponent(payload.expires_at)}` +
        `&last_imported_at=${encodeURIComponent(payload.last_imported_at ?? "")}`;

      window.open(launchUrl, "_blank", "noopener,noreferrer");
      return true;
    },
    []
  );

  const handleStartExtensionImport = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "extension") return;

    setIsStartingExtension(true);
    setExtensionStatusMessage(null);

    try {
      if (selectedConnector.websiteUrl) {
        window.open(selectedConnector.websiteUrl, "_blank", "noopener,noreferrer");
      }

      const accessToken = await getAccessToken();
      const session = await callMoneyImportAction<MoneyImportSessionCreateResult>(
        {
          action: "create_session",
          source: selectedConnector.sourceId,
          payer_person_id: selectedPersonId,
        },
        accessToken
      );

      setActiveSessionId(session.session_id);
      setActiveBatchId(session.batch_id);

      const deliveredByMessage = await sendSessionToExtension(session);
      if (deliveredByMessage) {
        setExtensionStatusMessage(t("money.importExtensionSessionCreated"));
        return;
      }

      const launched = launchExtensionFallback(session);
      if (launched) {
        setExtensionStatusMessage(t("money.importExtensionSessionCreated"));
      } else {
        setExtensionStatusMessage(t("money.importExtensionOpenPopupManual"));
      }
    } catch (error) {
      setExtensionStatusMessage(error instanceof Error ? error.message : "Failed to start extension import");
    } finally {
      setIsStartingExtension(false);
    }
  }, [
    launchExtensionFallback,
    selectedPersonId,
    selectedConnector,
    sendSessionToExtension,
    t,
  ]);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-xl font-semibold">{t("money.importTitle")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("money.importSelectSource")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {connectors.map((connector) => (
            <Button
              key={connector.sourceId}
              type="button"
              variant={selectedSourceId === connector.sourceId ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => {
                setSelectedSourceId(connector.sourceId);
                setFile(null);
                setParseResult(null);
                setAccountMapping({});
                setDefaultAccountId("");
                setExtensionActive(null);
                setExtensionStatusMessage(null);
                setActiveSessionId(null);
                setActiveBatchId(null);
                setSessionStatus(null);
              }}
            >
              {connector.sourceId.startsWith("tbank") ? (
                // eslint-disable-next-line @next/next/no-img-element -- external T-Bank CDN not in next.config images
                <img src={TBANK_ICON_URL} alt="" width={20} height={24} className="inline-block" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {connector.displayName}
              <Badge variant="secondary" className="ml-1">
                {connector.kind === "file"
                  ? t("money.importSourceTypeFile")
                  : t("money.importSourceTypeExtension")}
              </Badge>
            </Button>
          ))}
        </CardContent>
      </Card>

      {!selectedConnector && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("money.importNoConnector")}
          </CardContent>
        </Card>
      )}

      {isFileConnector && selectedConnector && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("money.importUploadFile")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div
                {...getRootProps()}
                className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
                data-drag-active={isDragActive || undefined}
              >
                <input {...getInputProps()} />
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {isDragActive
                    ? t("money.importUploadFile")
                    : file
                      ? `${file.name} (${file.size} bytes)`
                      : t("money.importUploadFile")}
                </p>
              </div>
              {isParsing && (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              )}
            </CardContent>
          </Card>

          {parseResult && parseResult.errors && parseResult.errors.length > 0 && (
            <Card className="border-destructive/50">
              <CardContent className="pt-4">
                <ul className="text-sm text-destructive list-disc list-inside">
                  {parseResult.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {parseResult && parseResult.transactions.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{t("money.importPreview")}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(parseResult.transactions[0].posted_at), "dd.MM.yyyy HH:mm")}
                    {" - "}
                    {format(
                      new Date(
                        parseResult.transactions[parseResult.transactions.length - 1].posted_at
                      ),
                      "dd.MM.yyyy HH:mm"
                    )}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {sourceAccounts.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      {t("money.importNoAccounts")}
                      <span
                        className="inline-flex text-muted-foreground cursor-help"
                        title={t("money.importNoAccountsTooltip")}
                      >
                        <HelpCircle className="h-4 w-4" />
                      </span>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={createAccountMutation.isPending}
                      onClick={async () => {
                        await createAccountMutation.mutateAsync({
                          owner_person_id: selectedPersonId,
                          source:
                            selectedConnector.sourceId === "tbank"
                              ? "tbank"
                              : selectedConnector.sourceId,
                          account_kind: "debit",
                          account_label: selectedConnector.displayName,
                          currency: "RUB",
                        });
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      {t("money.importCreateTbankAccount")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        {t("money.importDefaultAccount")}
                      </label>
                      <Select value={defaultAccountId} onValueChange={setDefaultAccountId}>
                        <SelectTrigger className="w-full max-w-xs">
                          <SelectValue placeholder={t("money.selectAccount")} />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.account_label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {uniqueHints.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("money.importMapAccount")}</label>
                        <div className="flex flex-wrap gap-3">
                          {uniqueHints.map((hint) => (
                            <div key={hint} className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">*{hint}:</span>
                              <Select
                                value={accountMapping[hint] ?? ""}
                                onValueChange={(value) =>
                                  setAccountMapping((mapping) => ({ ...mapping, [hint]: value }))
                                }
                              >
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue placeholder={t("money.importUnknownCard")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {sourceAccounts.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                      {account.account_label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="p-2 text-left">{t("money.postedAt")}</th>
                            <th className="p-2 text-right">{t("money.amount")}</th>
                            <th className="p-2 text-left">{t("money.merchant")}</th>
                            <th className="p-2 text-left">{t("money.importMapAccount")}</th>
                            <th className="p-2 text-left">{t("money.type")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parseResult.transactions.slice(0, 20).map((row, index) => (
                            <tr key={index} className="border-b">
                              <td className="p-2">
                                {format(new Date(row.posted_at), "dd.MM.yyyy HH:mm")}
                              </td>
                              <td className="p-2 text-right">
                                {formatMoney(row.amount, row.currency, "ru-RU")}
                              </td>
                              <td className="p-2">{row.merchant_name ?? "-"}</td>
                              <td className="p-2">{row.account_hint ? `*${row.account_hint}` : "-"}</td>
                              <td className="p-2">{row.transaction_type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parseResult.transactions.length > 20 && (
                        <p className="p-2 text-xs text-muted-foreground">
                          ... and {parseResult.transactions.length - 20} more
                        </p>
                      )}
                    </div>

                    <Button
                      onClick={handleApplyFileImport}
                      disabled={!allRowsResolved || isSubmitting}
                      className="gap-2"
                    >
                      {isSubmitting ? (
                        t("common.loading")
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          {t("money.importConfirm")}
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isExtensionConnector && selectedConnector && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("money.importExtensionTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {extensionActive === null && (
              <p className="text-sm text-muted-foreground">{t("money.importExtensionChecking")}</p>
            )}

            {extensionActive === true && (
              <div className="space-y-4">
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                  <li>{t("money.importExtensionStep1")}</li>
                  <li>{t("money.importExtensionStep2")}</li>
                  <li>{t("money.importExtensionStep3")}</li>
                </ol>
                <Button
                  className="gap-2"
                  onClick={handleStartExtensionImport}
                  disabled={isStartingExtension}
                >
                  {isStartingExtension
                    ? t("common.loading")
                    : t("money.importStartImport")}
                </Button>
              </div>
            )}

            {extensionActive === false && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {typeof window !== "undefined" && window.location.hostname === "localhost"
                    ? t("money.importExtensionInstallDev")
                    : t("money.importExtensionInstallProd")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("money.importExtensionReloadHint")}
                </p>
                <Button variant="outline" size="sm" className="gap-2" onClick={checkExtension}>
                  <LinkIcon className="h-4 w-4" />
                  {t("money.importExtensionRetryCheck")}
                </Button>
              </div>
            )}

            {extensionActive === false && (
              <Badge variant="destructive">
                {t("money.importExtensionInactive")}
              </Badge>
            )}

            {extensionStatusMessage && extensionActive === true && (
              <p className="text-sm text-muted-foreground">{extensionStatusMessage}</p>
            )}

            {activeSessionId && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t("money.importProgress")}</span>
                  <span className="text-sm text-muted-foreground">
                    {computeProgressPercent(sessionStatus)}%
                  </span>
                </div>
                <Progress value={computeProgressPercent(sessionStatus)} />
                <div className="text-sm text-muted-foreground">
                  {t("money.importParsedTransactionsCount", {
                    count: sessionStatus?.batch?.parsed_transactions_count ?? 0,
                  })}
                </div>
                {activeBatchId && (
                  <Button variant="outline" asChild>
                    <Link href={`/money/import/reports/${activeBatchId}`}>
                      {t("money.importOpenCurrentReport")}
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

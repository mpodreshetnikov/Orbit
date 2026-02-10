"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDropzone } from "react-dropzone";
import { FileSpreadsheet, CheckCircle2, Upload, HelpCircle, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/stores/ui-store";
import { useMoneyAccounts, useCreateMoneyAccount, useMoneyCardsByAccountIds, useCreateMoneyCard } from "@/hooks";
import { createClient } from "@/lib/supabase";
import { getConnectors } from "@/lib/import/connector-types";
import type {
  CanonicalTransactionRow,
  BatchTransactionRow,
  MoneyUpsertRowResult,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { format } from "date-fns";

// Register T-Bank connector when this page loads
import "@/lib/import/connectors/tbank-csv";

const TBANK_ICON_URL =
  "https://cdn.tbank.ru/static/pfa-multimedia/images/ae288629-59d7-4eb6-b074-8bb0549a43b6.svg";

export default function MoneyImportPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
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
  const [accountMapping, setAccountMapping] = useState<Record<string, string>>(
    {}
  );
  const [defaultAccountId, setDefaultAccountId] = useState<string>("");
  const [confirmResult, setConfirmResult] = useState<{
    inserted: number;
    skipped: number;
    row_results: MoneyUpsertRowResult[];
  } | null>(null);
  const [importStep, setImportStep] = useState<"upload" | "results">("upload");
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedConnector = useMemo(
    () => connectors.find((c) => c.sourceId === selectedSourceId),
    [connectors, selectedSourceId]
  );

  const tbankAccounts = useMemo(() => {
    if (!accounts || !selectedConnector) return [];
    return accounts.filter(
      (a) => a.source === selectedConnector.sourceId
    );
  }, [accounts, selectedConnector]);

  const tbankAccountIds = useMemo(
    () => tbankAccounts.map((a) => a.id),
    [tbankAccounts]
  );
  const { data: cardsForImport } = useMoneyCardsByAccountIds(tbankAccountIds);

  const hintToAccountIdFromCards = useMemo(() => {
    const map: Record<string, string> = {};
    if (!cardsForImport) return map;
    cardsForImport.forEach((c) => {
      map[c.last4] = c.account_id;
    });
    return map;
  }, [cardsForImport]);

  const appliedCardMappingRef = useRef<number>(0);
  useEffect(() => {
    if (!parseResult) appliedCardMappingRef.current = 0;
  }, [parseResult]);
  useEffect(() => {
    if (
      !parseResult?.transactions.length ||
      appliedCardMappingRef.current === parseResult.transactions.length
    )
      return;
    appliedCardMappingRef.current = parseResult.transactions.length;
    setAccountMapping((prev) => {
      const next = { ...prev };
      Object.entries(hintToAccountIdFromCards).forEach(([hint, accountId]) => {
        next[hint] = accountId;
      });
      return next;
    });
    if (tbankAccounts.length === 1) {
      setDefaultAccountId(tbankAccounts[0].id);
    }
  }, [
    parseResult?.transactions.length,
    hintToAccountIdFromCards,
    tbankAccounts,
  ]);

  const uniqueHints = useMemo(() => {
    if (!parseResult?.transactions.length) return [];
    const set = new Set<string>();
    parseResult.transactions.forEach((row) => {
      const h = row.account_hint?.trim() || "";
      if (h) set.add(h);
    });
    return Array.from(set).sort();
  }, [parseResult?.transactions]);

  const resolveAccountId = useCallback(
    (row: CanonicalTransactionRow): string | null => {
      const hint = row.account_hint?.trim() || "";
      const mapped = hint ? accountMapping[hint] : null;
      if (mapped) return mapped;
      return defaultAccountId || null;
    },
    [accountMapping, defaultAccountId]
  );

  const allRowsResolved = useMemo(() => {
    if (!parseResult?.transactions.length) return false;
    return parseResult.transactions.every((row) =>
      resolveAccountId(row)
    );
  }, [parseResult?.transactions, resolveAccountId]);

  const parseFile = useCallback(
    async (f: File) => {
      if (!selectedConnector) return;
      setFile(f);
      setParseResult(null);
      setConfirmResult(null);
      setImportStep("upload");
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
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".csv"],
      "application/vnd.ms-excel": [".csv"],
    },
    maxFiles: 1,
    disabled: isParsing || !selectedConnector,
    onDropAccepted: (acceptedFiles) => {
      const f = acceptedFiles[0];
      if (f) parseFile(f);
    },
  });

  const normalizeLast4 = useCallback((hint: string | null | undefined): string => {
    const digits = (hint ?? "").replace(/\D/g, "");
    return digits.slice(-4);
  }, []);

  const buildBatchRows = useCallback(
    (cardIdByKey?: Map<string, string>): BatchTransactionRow[] => {
      if (!parseResult?.transactions.length) return [];
      return parseResult.transactions.map((row) => {
        const accountId = resolveAccountId(row);
        if (!accountId) throw new Error("Unresolved account");
        const last4 = normalizeLast4(row.account_hint);
        const cardId = last4 ? (cardIdByKey?.get(`${accountId}:${last4}`) ?? null) : null;
        return {
          account_id: accountId,
          card_id: cardId ?? undefined,
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
          raw_payload: row.raw_payload ?? null,
          dedupe_hash: row.dedupe_hash,
          line_item: row.line_item,
        };
      });
    },
    [parseResult?.transactions, resolveAccountId, normalizeLast4]
  );

  const handleConfirm = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || !parseResult?.transactions.length || !allRowsResolved) return;

    setIsSubmitting(true);
    setConfirmResult(null);
    const supabase = createClient();

    try {
      const normalizeL4 = (h: string | null | undefined) =>
        (h ?? "").replace(/\D/g, "").slice(-4);
      const cardIdByKey = new Map<string, string>();
      (cardsForImport ?? []).forEach((c) => {
        cardIdByKey.set(`${c.account_id}:${c.last4}`, c.id);
      });
      const uniqueAccountLast4 = new Map<string, { accountId: string; last4: string }>();
      parseResult.transactions.forEach((row) => {
        const accountId = resolveAccountId(row);
        if (!accountId) return;
        const last4 = normalizeL4(row.account_hint);
        if (!last4) return;
        const key = `${accountId}:${last4}`;
        if (!uniqueAccountLast4.has(key)) {
          uniqueAccountLast4.set(key, { accountId, last4 });
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

      const rows = buildBatchRows(cardIdByKey);
      if (!rows.length) return;

      const { data: batch, error: batchError } = await supabase
        .from("money_import_batches")
        .insert({
          source: selectedConnector.sourceId,
          payer_person_id: selectedPersonId,
          import_type: "file",
          file_path: file?.name ?? null,
          meta: { rowCount: rows.length },
        })
        .select("id")
        .single();

      if (batchError) throw new Error(batchError.message);
      if (!batch?.id) throw new Error("Batch not created");

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "money_upsert_transactions_batch",
        {
          p_batch_id: batch.id,
          p_payer_person_id: selectedPersonId,
          p_rows: rows.map((r) => ({
            account_id: r.account_id,
            card_id: r.card_id ?? null,
            source: r.source,
            external_id: r.external_id,
            posted_at: r.posted_at,
            amount: r.amount,
            currency: r.currency,
            transaction_type: r.transaction_type,
            status: r.status,
            merchant_name: r.merchant_name,
            mcc: r.mcc,
            comment: r.comment,
            is_transfer: r.is_transfer,
            transfer_group_id: r.transfer_group_id,
            raw_payload: r.raw_payload,
            dedupe_hash: r.dedupe_hash,
            line_item: r.line_item,
          })),
        }
      );

      if (rpcError) throw new Error(rpcError.message);
      const result = rpcData as {
        inserted: number;
        skipped: number;
        row_results?: MoneyUpsertRowResult[];
      };
      setConfirmResult({
        inserted: result.inserted ?? 0,
        skipped: result.skipped ?? 0,
        row_results: result.row_results ?? [],
      });
      setImportStep("results");
      if (selectedPersonId) {
        queryClient.invalidateQueries({
          queryKey: ["money-transactions", selectedPersonId],
        });
        queryClient.invalidateQueries({
          queryKey: ["money-accounts", selectedPersonId],
        });
        queryClient.invalidateQueries({
          queryKey: ["money-cards-by-accounts"],
        });
      }
    } catch (err) {
      setConfirmResult(null);
      setParseResult((prev) => ({
        transactions: prev?.transactions ?? [],
        errors: [err instanceof Error ? err.message : "Import failed"],
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    selectedPersonId,
    selectedConnector,
    parseResult?.transactions,
    allRowsResolved,
    buildBatchRows,
    resolveAccountId,
    cardsForImport,
    createCardMutation,
    file?.name,
    queryClient,
  ]);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  const resultRows =
    importStep === "results" && confirmResult && parseResult
      ? parseResult.transactions.map((tx, i) => ({
          tx,
          result:
            confirmResult!.row_results.find((r) => r.idx === i) ?? {
              idx: i,
              status: "error" as const,
              message: "Unknown",
            },
        }))
      : [];

  if (importStep === "results" && confirmResult && parseResult) {
    return (
      <div className="space-y-6 max-w-4xl">
        <h1 className="text-xl font-semibold">{t("money.importTitle")}</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("money.importResultsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("money.importResultsSummary", {
                inserted: confirmResult.inserted,
                skipped: confirmResult.skipped,
              })}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left w-12">#</th>
                    <th className="p-2 text-left">{t("money.postedAt")}</th>
                    <th className="p-2 text-right">{t("money.amount")}</th>
                    <th className="p-2 text-left">{t("money.importResultPurpose")}</th>
                    <th className="p-2 text-left">{t("money.importResultStatus")}</th>
                    <th className="p-2 text-left">{t("money.importResultMessage")}</th>
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map(({ tx, result }, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 text-muted-foreground">{i + 1}</td>
                      <td className="p-2">
                        {format(
                          new Date(tx.posted_at),
                          "dd.MM.yyyy HH:mm",
                          { locale: undefined }
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {formatMoney(tx.amount, tx.currency, "ru-RU")}
                      </td>
                      <td className="p-2">
                        {tx.merchant_name?.trim() ||
                          tx.line_item?.title?.trim() ||
                          "—"}
                      </td>
                      <td className="p-2">
                        {result.status === "inserted" && (
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                            {t("money.importResultRowInserted")}
                          </Badge>
                        )}
                        {result.status === "skipped" && (
                          <Badge variant="secondary">
                            {t("money.importResultRowSkipped")}
                          </Badge>
                        )}
                        {result.status === "error" && (
                          <Badge variant="destructive">
                            {t("money.importResultRowError")}
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground text-xs">
                        {result.message ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setImportStep("upload");
                setConfirmResult(null);
                setParseResult(null);
                setFile(null);
              }}
            >
              <Upload className="h-4 w-4" />
              {t("money.importAnotherFile")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-xl font-semibold">{t("money.importTitle")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("money.importSelectSource")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {connectors.map((conn) => (
            <Button
              key={conn.sourceId}
              type="button"
              variant={selectedSourceId === conn.sourceId ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => {
                setSelectedSourceId(conn.sourceId);
                setFile(null);
                setParseResult(null);
                setConfirmResult(null);
                setImportStep("upload");
              }}
            >
              {conn.sourceId === "tbank" ? (
                // eslint-disable-next-line @next/next/no-img-element -- external T-Bank CDN not in next.config images
                <img
                  src={TBANK_ICON_URL}
                  alt=""
                  width={20}
                  height={24}
                  className="inline-block"
                />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {conn.displayName}
            </Button>
          ))}
        </CardContent>
      </Card>

      {selectedConnector && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("money.importUploadFile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid w-full max-w-sm gap-2">
              <div
                {...getRootProps()}
                className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[drag-active]:border-primary data-[drag-active]:bg-muted/50"
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
                <p className="text-sm text-muted-foreground">Parsing…</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {parseResult && (
        <>
          {parseResult.errors && parseResult.errors.length > 0 && (
            <Card className="border-destructive/50">
              <CardContent className="pt-4">
                <ul className="text-sm text-destructive list-disc list-inside">
                  {parseResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {parseResult.transactions.length > 0 && (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{t("money.importPreview")}</CardTitle>
                    {parseResult.transactions.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(parseResult.transactions[0].posted_at), "dd.MM.yyyy")}
                        {" — "}
                        {format(
                          new Date(parseResult.transactions[parseResult.transactions.length - 1].posted_at),
                          "dd.MM.yyyy"
                        )}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {tbankAccounts.length === 0 ? (
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
                      {selectedPersonId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          disabled={createAccountMutation.isPending}
                          onClick={async () => {
                            if (!selectedPersonId) return;
                            await createAccountMutation.mutateAsync({
                              owner_person_id: selectedPersonId,
                              source: "tbank",
                              account_kind: "debit",
                              account_label: "T-Bank",
                              currency: "RUB",
                            });
                          }}
                        >
                          <Plus className="h-4 w-4" />
                          {t("money.importCreateTbankAccount")}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          {t("money.importDefaultAccount")}
                        </label>
                        <Select
                          value={defaultAccountId}
                          onValueChange={setDefaultAccountId}
                        >
                          <SelectTrigger className="w-full max-w-xs">
                            <SelectValue placeholder={t("money.selectAccount")} />
                          </SelectTrigger>
                          <SelectContent>
                            {tbankAccounts.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id}>
                                {acc.account_label}
                                {acc.external_account_id
                                  ? ` (*${acc.external_account_id})`
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {uniqueHints.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            {t("money.importMapAccount")}
                          </label>
                          <div className="flex flex-wrap gap-3">
                            {uniqueHints.map((hint) => (
                              <div
                                key={hint}
                                className="flex items-center gap-2"
                              >
                                <span className="text-sm text-muted-foreground">
                                  *{hint}:
                                </span>
                                <Select
                                  value={accountMapping[hint] ?? ""}
                                  onValueChange={(v) =>
                                    setAccountMapping((m) => ({
                                      ...m,
                                      [hint]: v,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue
                                      placeholder={t("money.importUnknownCard")}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {tbankAccounts.map((acc) => (
                                      <SelectItem key={acc.id} value={acc.id}>
                                        {acc.account_label}
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
                            {parseResult.transactions.slice(0, 10).map((row, i) => (
                              <tr key={i} className="border-b">
                                <td className="p-2">
                                  {format(
                                    new Date(row.posted_at),
                                    "dd.MM.yyyy HH:mm",
                                    { locale: undefined }
                                  )}
                                </td>
                                <td className="p-2 text-right">
                                  {formatMoney(row.amount, row.currency, "ru-RU")}
                                </td>
                                <td className="p-2">{row.merchant_name ?? "—"}</td>
                                <td className="p-2">
                                  {row.account_hint ? `*${row.account_hint}` : "—"}
                                </td>
                                <td className="p-2">{row.transaction_type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {parseResult.transactions.length > 10 && (
                          <p className="p-2 text-xs text-muted-foreground">
                            … and {parseResult.transactions.length - 10} more
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={handleConfirm}
                        disabled={!allRowsResolved || isSubmitting}
                        className="gap-2"
                      >
                        {isSubmitting ? (
                          "…"
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
            </>
          )}

        </>
      )}
    </div>
  );
}

"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useDropzone } from "react-dropzone";
import { CheckCircle2, FileSpreadsheet, HelpCircle, LinkIcon, Plus, Upload } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useMoneyAccounts, useCreateMoneyAccount, useMoneyCardsByAccountIds } from "@/hooks";
import { getConnectors } from "@/lib/import/connector-types";
import {
  MoneyImportAutoStatus,
  MoneyImportGrants,
  readExtensionAutoStatus,
  type ExtensionAutoStatus,
} from "@/components/money";
import {
  isExtensionOutdated,
  normalizeExtensionRelease,
  type ExtensionRelease,
} from "@/lib/import/extension-release";
import {
  MONEY_ACCOUNT_SOURCES,
  type BatchTransactionRow,
  type CanonicalTransactionRow,
  type MoneyAccountSource,
  type MoneyImportConnector,
  type MoneyImportParseStrategy,
  type MoneyImportPreviewResult,
  type MoneyImportSessionCreateResult,
  type MoneyImportSessionStatus,
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
import { format, subMonths } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import "@/lib/import/connectors/tbank-csv";
import "@/lib/import/connectors/tbank-web";
import "@/lib/import/connectors/alfa-web";

const TBANK_ICON_URL =
  "https://cdn.tbank.ru/static/pfa-multimedia/images/ae288629-59d7-4eb6-b074-8bb0549a43b6.svg";

const EXTENSION_WEBAPP_SOURCE = "orbit-webapp";
const EXTENSION_BRIDGE_SOURCE = "orbit-extension";
const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? "";
const DEFAULT_ACCOUNT_STORAGE_PREFIX = "money-import-default-account";
const DEFAULT_TBANK_PARSE_STRATEGY: MoneyImportParseStrategy = "full";
const EXTENSION_PING_TIMEOUT_MS = 500;
const CONNECTOR_ACCOUNT_SOURCE_BY_SOURCE_ID: Record<string, MoneyAccountSource> = {
  tbank_web: "tbank",
  alfa_web: "alfa",
};

type ExtensionPingResult = {
  active: boolean;
  extensionId: string | null;
  extensionVersion: string | null;
};

function connectorSourceToAccountSource(sourceId: string): string {
  return CONNECTOR_ACCOUNT_SOURCE_BY_SOURCE_ID[sourceId] ?? sourceId;
}

function formatAccountSourceTranslationKey(source: string): `money.accountSource${string}` {
  return `money.accountSource${source.charAt(0).toUpperCase()}${source.slice(1)}`;
}

function resolveConnectorSourceLabel(
  t: ReturnType<typeof useTranslations>,
  connector: MoneyImportConnector | null | undefined,
): string {
  if (!connector) return "";
  const accountSource = connectorSourceToAccountSource(connector.sourceId);
  if ((MONEY_ACCOUNT_SOURCES as readonly string[]).includes(accountSource)) {
    return t(formatAccountSourceTranslationKey(accountSource));
  }
  return connector.displayName;
}

function buildDefaultAccountStorageKey(personId: string, sourceId: string): string {
  return `${DEFAULT_ACCOUNT_STORAGE_PREFIX}:${personId}:${sourceId}`;
}

function normalizeMaskedCardHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function normalizeOperationText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function collectOperationHintCandidates(operation: Record<string, unknown> | null): string[] {
  if (!operation) return [];
  return Array.from(
    new Set(
      [
        normalizeMaskedCardHint(operation.cardNumber),
        normalizeMaskedCardHint(
          operation.payment && typeof operation.payment === "object"
            ? (operation.payment as Record<string, unknown>).cardNumber
            : null,
        ),
        normalizeMaskedCardHint(
          operation.card && typeof operation.card === "object"
            ? (operation.card as Record<string, unknown>).panMasked
            : null,
        ),
        normalizeMaskedCardHint(
          operation.card && typeof operation.card === "object"
            ? (operation.card as Record<string, unknown>).number
            : null,
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function isAccountNativeOperation(
  row: CanonicalTransactionRow,
  operation: Record<string, unknown> | null,
): boolean {
  if (row.is_transfer) return true;
  if (!operation) return false;

  const texts = [
    normalizeOperationText(row.merchant_name),
    normalizeOperationText(
      typeof operation.description === "string" ? operation.description : null,
    ),
    normalizeOperationText(
      typeof operation.merchantKey === "string" ? operation.merchantKey : null,
    ),
    normalizeOperationText(
      typeof operation.subcategory === "string" ? operation.subcategory : null,
    ),
    normalizeOperationText(typeof operation.group === "string" ? operation.group : null),
    normalizeOperationText(
      operation.subgroup && typeof operation.subgroup === "object"
        ? (operation.subgroup as Record<string, unknown>).name
        : null,
    ),
    normalizeOperationText(
      operation.spendingCategory && typeof operation.spendingCategory === "object"
        ? (operation.spendingCategory as Record<string, unknown>).name
        : null,
    ),
    normalizeOperationText(
      operation.categoryInfo &&
        typeof operation.categoryInfo === "object" &&
        (operation.categoryInfo as Record<string, unknown>).bankCategory &&
        typeof (operation.categoryInfo as Record<string, unknown>).bankCategory === "object"
        ? ((
            (operation.categoryInfo as Record<string, unknown>).bankCategory as Record<
              string,
              unknown
            >
          ).name as unknown)
        : null,
    ),
    normalizeOperationText(
      operation.categoryInfo &&
        typeof operation.categoryInfo === "object" &&
        (operation.categoryInfo as Record<string, unknown>).metacategory &&
        typeof (operation.categoryInfo as Record<string, unknown>).metacategory === "object"
        ? ((
            (operation.categoryInfo as Record<string, unknown>).metacategory as Record<
              string,
              unknown
            >
          ).name as unknown)
        : null,
    ),
    normalizeOperationText(
      operation.category && typeof operation.category === "object"
        ? (operation.category as Record<string, unknown>).name
        : null,
    ),
    normalizeOperationText(
      operation.payment && typeof operation.payment === "object"
        ? (operation.payment as Record<string, unknown>).providerId
        : null,
    ),
    normalizeOperationText(
      operation.payment && typeof operation.payment === "object"
        ? (operation.payment as Record<string, unknown>).providerGroupId
        : null,
    ),
    normalizeOperationText(
      operation.payment && typeof operation.payment === "object"
        ? (operation.payment as Record<string, unknown>).paymentType
        : null,
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (
    /between own accounts|between my accounts|card to card|p2p|transfer-inner|внутрибанковский перевод|между своими счетами|пополнение по номеру телефона|перевод|переводы/.test(
      texts,
    )
  ) {
    return true;
  }

  return /interest|balance interest|deposit|bonus|correction|cashback payout|проценты|вклад|бонус|коррекц|пополнение вклада|закрытие вклада/.test(
    texts,
  );
}

function getAccountHint(row: CanonicalTransactionRow): string | null {
  const rawPayload =
    row.raw_payload && typeof row.raw_payload === "object"
      ? (row.raw_payload as Record<string, unknown>)
      : null;
  const rawOperation =
    rawPayload?.operation && typeof rawPayload.operation === "object"
      ? (rawPayload.operation as Record<string, unknown>)
      : null;

  if (isAccountNativeOperation(row, rawOperation)) return null;

  const directHint = normalizeMaskedCardHint(row.account_hint);
  const rawHint = normalizeMaskedCardHint(rawPayload?.account_hint);
  const operationCandidates = collectOperationHintCandidates(rawOperation);

  const uniqueHints = Array.from(
    new Set(
      [directHint, rawHint, ...operationCandidates].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  );

  if (rawOperation && uniqueHints.length > 1) return null;
  if (directHint) return directHint;
  if (rawHint) return rawHint;
  if (operationCandidates.length === 1) return operationCandidates[0];
  return null;
}

import {
  callMoneyImportAction as callMoneyImportActionClient,
  computeProgressPercent,
  getAccessToken,
  getFunctionUrl,
} from "./money-import-client";
import { getAppEnvironmentKind } from "./extension-release-client";
import type {
  MoneyImportRangePresetKey,
  MoneyImportRangeSelectionMeta,
  MoneyImportSourceContextResult,
} from "@/types";

type ExtensionRangeChoice =
  | "auto"
  | "preset:1m"
  | "preset:3m"
  | "preset:6m"
  | "preset:1y"
  | "preset:since_last_import"
  | "custom";

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
    parsed.getDate(),
  ).padStart(2, "0")}T${String(parsed.getHours()).padStart(2, "0")}:${String(
    parsed.getMinutes(),
  ).padStart(2, "0")}`;
}

function toIsoFromDateTimeInput(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolvePresetWindowFrom(
  presetKey: MoneyImportRangePresetKey,
  windowToIso: string,
  lastImportedAt: string | null,
): string | null {
  if (presetKey === "since_last_import") return lastImportedAt;
  const windowTo = new Date(windowToIso);
  if (Number.isNaN(windowTo.getTime())) return null;
  if (presetKey === "1m") return subMonths(windowTo, 1).toISOString();
  if (presetKey === "3m") return subMonths(windowTo, 3).toISOString();
  if (presetKey === "6m") return subMonths(windowTo, 6).toISOString();
  return subMonths(windowTo, 12).toISOString();
}

function defaultRangeChoiceForContext(
  context: MoneyImportSourceContextResult,
): ExtensionRangeChoice {
  if (!context.requires_history_prompt && context.recommended_mode === "auto") {
    return "auto";
  }
  return "preset:1y";
}

function buildRangeSelectionPayload(
  t: ReturnType<typeof useTranslations>,
  context: MoneyImportSourceContextResult,
  choice: ExtensionRangeChoice,
  customFromInput: string,
  customToInput: string,
): {
  windowFrom: string | null;
  windowTo: string | null;
  rangeSelectionMeta: MoneyImportRangeSelectionMeta;
} {
  if (choice === "auto") {
    return {
      windowFrom: context.window_from,
      windowTo: context.window_to,
      rangeSelectionMeta: {
        selection_mode: "auto",
        preset_key: null,
        prompted_for_history: context.requires_history_prompt,
        last_imported_at_at_decision_time: context.last_imported_at,
        stale_threshold_days: context.stale_threshold_days,
      },
    };
  }

  if (choice === "custom") {
    const windowFrom = toIsoFromDateTimeInput(customFromInput);
    const windowTo = toIsoFromDateTimeInput(customToInput) ?? context.window_to;
    if (!windowFrom || !windowTo) {
      throw new Error(t("money.importRangeCustomInvalid"));
    }
    return {
      windowFrom,
      windowTo,
      rangeSelectionMeta: {
        selection_mode: "custom",
        preset_key: null,
        prompted_for_history: context.requires_history_prompt,
        last_imported_at_at_decision_time: context.last_imported_at,
        stale_threshold_days: context.stale_threshold_days,
      },
    };
  }

  const presetKey = choice.replace("preset:", "") as MoneyImportRangePresetKey;
  const windowFrom = resolvePresetWindowFrom(
    presetKey,
    context.window_to ?? new Date().toISOString(),
    context.last_imported_at,
  );
  if (!windowFrom || !context.window_to) {
    throw new Error(t("money.importRangePresetInvalid"));
  }
  return {
    windowFrom,
    windowTo: context.window_to,
    rangeSelectionMeta: {
      selection_mode: "preset",
      preset_key: presetKey,
      prompted_for_history: context.requires_history_prompt,
      last_imported_at_at_decision_time: context.last_imported_at,
      stale_threshold_days: context.stale_threshold_days,
    },
  };
}

function formatSelectedRange(windowFrom: string | null, windowTo: string | null): string {
  if (!windowFrom || !windowTo) return "-";
  return `${format(new Date(windowFrom), "dd.MM.yyyy HH:mm")} -> ${format(new Date(windowTo), "dd.MM.yyyy HH:mm")}`;
}

export default function MoneyImportPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const createAccountMutation = useCreateMoneyAccount();

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
  const [extensionAutoStatus, setExtensionAutoStatus] = useState<{
    state: "loading" | "inactive" | "ready";
    status: ExtensionAutoStatus | null;
  }>({ state: "loading", status: null });
  const [extensionStatusMessage, setExtensionStatusMessage] = useState<string | null>(null);
  const [installedExtensionId, setInstalledExtensionId] = useState<string | null>(null);
  const [installedExtensionVersion, setInstalledExtensionVersion] = useState<string | null>(null);
  const [latestExtensionRelease, setLatestExtensionRelease] = useState<ExtensionRelease | null>(
    null,
  );
  const [isStartingExtension, setIsStartingExtension] = useState(false);
  const [extensionImportContext, setExtensionImportContext] =
    useState<MoneyImportSourceContextResult | null>(null);
  const [isLoadingExtensionImportContext, setIsLoadingExtensionImportContext] = useState(false);
  const [extensionRangeChoice, setExtensionRangeChoice] = useState<ExtensionRangeChoice>("auto");
  const [extensionParseStrategy, setExtensionParseStrategy] = useState<MoneyImportParseStrategy>(
    DEFAULT_TBANK_PARSE_STRATEGY,
  );
  const [customRangeFrom, setCustomRangeFrom] = useState("");
  const [customRangeTo, setCustomRangeTo] = useState("");

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<MoneyImportSessionStatus | null>(null);

  const pollingRef = useRef<number | null>(null);
  const appEnvironmentKind = getAppEnvironmentKind();

  const selectedConnector = useMemo(
    () => connectors.find((c) => c.sourceId === selectedSourceId),
    [connectors, selectedSourceId],
  );
  // Only extension-backed sources can run unattended, so only they are worth granting.
  const extensionConnectorOptions = useMemo(
    () =>
      connectors
        .filter((connector) => connector.kind !== "file")
        .map((connector) => ({
          sourceId: connector.sourceId,
          label: connector.displayName,
        })),
    [connectors],
  );
  const selectedConnectorSourceLabel = useMemo(
    () => resolveConnectorSourceLabel(t, selectedConnector),
    [selectedConnector, t],
  );

  const isFileConnector = selectedConnector?.kind === "file";
  const isExtensionConnector = selectedConnector?.kind === "extension";
  const isTbankExtensionConnector = selectedConnector?.sourceId === "tbank_web";
  const isProductionExtensionInstallFlow = appEnvironmentKind === "production";
  const shouldUsePublishedExtensionFlow =
    isProductionExtensionInstallFlow ||
    (process.env.NODE_ENV === "test" &&
      selectedConnector?.kind === "extension" &&
      Boolean(selectedConnector.release?.latestDownloadUrl));

  const accountSourceForSelectedConnector = useMemo(() => {
    if (!selectedConnector) return null;
    return connectorSourceToAccountSource(selectedConnector.sourceId);
  }, [selectedConnector]);

  const sourceAccounts = useMemo(() => {
    if (!accounts || !accountSourceForSelectedConnector) return [];
    const source = accountSourceForSelectedConnector;
    return accounts.filter((a) => a.source === source);
  }, [accounts, accountSourceForSelectedConnector]);

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
  }, [parseResult?.transactions.length, hintToAccountIdFromCards]);

  useEffect(() => {
    if (!selectedConnector || !selectedPersonId) {
      setDefaultAccountId("");
      return;
    }

    if (sourceAccounts.length === 0) {
      setDefaultAccountId("");
      return;
    }

    if (sourceAccounts.length === 1) {
      const singleAccountId = sourceAccounts[0].id;
      if (defaultAccountId !== singleAccountId) {
        setDefaultAccountId(singleAccountId);
      }
      return;
    }

    if (sourceAccounts.some((account) => account.id === defaultAccountId)) return;
    if (typeof window === "undefined") {
      setDefaultAccountId("");
      return;
    }

    const storedValue =
      window.localStorage
        .getItem(buildDefaultAccountStorageKey(selectedPersonId, selectedConnector.sourceId))
        ?.trim() ?? "";

    if (storedValue && sourceAccounts.some((account) => account.id === storedValue)) {
      setDefaultAccountId(storedValue);
      return;
    }

    setDefaultAccountId("");
  }, [defaultAccountId, selectedConnector, selectedPersonId, sourceAccounts]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !selectedConnector ||
      !selectedPersonId ||
      !defaultAccountId
    ) {
      return;
    }

    const isValid = sourceAccounts.some((account) => account.id === defaultAccountId);
    if (!isValid) return;

    window.localStorage.setItem(
      buildDefaultAccountStorageKey(selectedPersonId, selectedConnector.sourceId),
      defaultAccountId,
    );
  }, [defaultAccountId, selectedConnector, selectedPersonId, sourceAccounts]);

  useEffect(() => {
    if (!activeSessionId) return;

    const poll = async () => {
      try {
        const accessToken = await getAccessToken();
        const status = await callMoneyImportActionClient<MoneyImportSessionStatus>(
          {
            action: "session_status",
            session_id: activeSessionId,
          },
          accessToken,
        );

        setSessionStatus(status);
        if (status.batch?.id) {
          setActiveBatchId(status.batch.id);
        }

        if (
          (status.batch?.status === "pending" || status.batch?.status === "completed") &&
          status.batch.id
        ) {
          if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          router.push(`/money/import/reports/${status.batch.id}`);
        }
      } catch (error) {
        setExtensionStatusMessage(
          error instanceof Error ? error.message : t("money.importPollFailed"),
        );
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
  }, [activeSessionId, router, t]);

  useEffect(() => {
    const onBridgeMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;

      if (
        data.type === "MONEY_IMPORT_PROGRESS" &&
        typeof data.parsed_transactions_count === "number"
      ) {
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

      // An unattended run says so, and is not followed. Navigating on it would take the person
      // off whatever they were doing -- a manual import included -- and onto a report for a run
      // they never started.
      if (
        data.type === "MONEY_IMPORT_DONE" &&
        typeof data.batch_id === "string" &&
        data.unattended !== true
      ) {
        router.push(`/money/import/reports/${data.batch_id}`);
      }

      if (data.type === "MONEY_IMPORT_ERROR") {
        setExtensionStatusMessage(
          typeof data.error === "string" ? data.error : t("money.importExtensionFailed"),
        );
      }
    };

    window.addEventListener("message", onBridgeMessage);
    return () => window.removeEventListener("message", onBridgeMessage);
  }, [router, t]);

  const uniqueHints = useMemo(() => {
    if (!parseResult?.transactions.length) return [];
    const set = new Set<string>();
    parseResult.transactions.forEach((row) => {
      const hint = getAccountHint(row) ?? "";
      if (hint) set.add(hint);
    });
    return Array.from(set).sort();
  }, [parseResult?.transactions]);

  const resolveAccountId = useCallback(
    (row: CanonicalTransactionRow): string | null => {
      const hint = getAccountHint(row) ?? "";
      if (hint && accountMapping[hint]) return accountMapping[hint];
      return defaultAccountId || null;
    },
    [accountMapping, defaultAccountId],
  );

  const allRowsResolved = useMemo(() => {
    if (!parseResult?.transactions.length) return false;
    return parseResult.transactions.every((row) => resolveAccountId(row));
  }, [parseResult?.transactions, resolveAccountId]);

  const handleCreateSourceAccount = useCallback(async () => {
    if (!selectedConnector || !selectedPersonId) return;
    await createAccountMutation.mutateAsync({
      owner_person_id: selectedPersonId,
      source: connectorSourceToAccountSource(selectedConnector.sourceId),
      account_kind: "debit",
      account_label: selectedConnector.displayName,
      currency: "RUB",
    });
  }, [createAccountMutation, selectedConnector, selectedPersonId]);

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
    [selectedConnector, t],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: isFileConnector
      ? (selectedConnector?.fileAccept ?? {
          "text/csv": [".csv"],
        })
      : undefined,
    maxFiles: 1,
    disabled: !isFileConnector || isParsing,
    onDropAccepted: (acceptedFiles) => {
      const f = acceptedFiles[0];
      if (f) parseFile(f);
    },
  });

  const buildBatchRows = useCallback((): BatchTransactionRow[] => {
    if (!parseResult?.transactions.length) return [];
    return parseResult.transactions.map((row) => {
      const accountId = resolveAccountId(row);
      if (!accountId) throw new Error(t("money.importUnresolvedAccountMapping"));
      const accountHint = getAccountHint(row);
      return {
        account_id: accountId,
        account_hint: accountHint,
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
        source_comment: row.source_comment ?? null,
        cashback_amount: row.cashback_amount ?? null,
        cashback_currency: row.cashback_currency ?? null,
        operation_icon_url: row.operation_icon_url ?? null,
        source_category: row.source_category ?? null,
        source_brand: row.source_brand ?? null,
        is_transfer: row.is_transfer,
        transfer_group_id: row.transfer_group_id ?? null,
        raw_payload: {
          ...(row.raw_payload ?? {}),
          account_hint: accountHint,
        },
        dedupe_hash: row.dedupe_hash ?? null,
        line_items: row.line_items,
      };
    });
  }, [parseResult?.transactions, resolveAccountId, t]);

  const handleApplyFileImport = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "file") return;
    if (!parseResult?.transactions.length || !allRowsResolved) return;

    setIsSubmitting(true);
    setExtensionStatusMessage(null);

    try {
      const accessToken = await getAccessToken();
      const rows = buildBatchRows();
      const result = await callMoneyImportActionClient<MoneyImportPreviewResult>(
        {
          action: "preview_rows",
          source: selectedConnector.sourceId,
          payer_person_id: selectedPersonId,
          import_type: "file",
          file_path: file?.name ?? null,
          rows,
        },
        accessToken,
      );

      router.push(`/money/import/reports/${result.batch_id}`);
    } catch (error) {
      setParseResult((prev) => ({
        transactions: prev?.transactions ?? [],
        errors: [error instanceof Error ? error.message : t("money.importFailed")],
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    allRowsResolved,
    buildBatchRows,
    file?.name,
    parseResult?.transactions,
    router,
    selectedConnector,
    selectedPersonId,
    t,
  ]);

  const pingExtension = useCallback(async (): Promise<ExtensionPingResult> => {
    return await new Promise<ExtensionPingResult>((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({
          active: false,
          extensionId: null,
          extensionVersion: null,
        });
      }, EXTENSION_PING_TIMEOUT_MS);

      const onMessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
        if (data.type !== "MONEY_IMPORT_PONG") return;

        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve({
          active: true,
          extensionId: typeof data.extension_id === "string" ? data.extension_id : null,
          extensionVersion:
            typeof data.extension_version === "string" ? data.extension_version : null,
        });
      };

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: EXTENSION_WEBAPP_SOURCE,
          type: "MONEY_IMPORT_PING",
          ts: Date.now(),
        },
        "*",
      );
    });
  }, []);

  const loadLatestExtensionRelease = useCallback(async (): Promise<ExtensionRelease | null> => {
    if (!shouldUsePublishedExtensionFlow) {
      setLatestExtensionRelease(null);
      return null;
    }

    try {
      const response = await fetch("/api/extension-release/latest", {
        cache: "no-store",
      });
      if (!response.ok) {
        setLatestExtensionRelease(null);
        return null;
      }

      const payload = normalizeExtensionRelease(await response.json());
      setLatestExtensionRelease(payload);
      return payload;
    } catch {
      setLatestExtensionRelease(null);
      return null;
    }
  }, [shouldUsePublishedExtensionFlow]);

  const requestExtensionAutoStatus = useCallback(async (): Promise<ExtensionAutoStatus | null> => {
    return await new Promise<ExtensionAutoStatus | null>((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, EXTENSION_PING_TIMEOUT_MS);

      const onMessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
        if (data.type !== "MONEY_IMPORT_AUTO_STATUS") return;

        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(readExtensionAutoStatus(data));
      };

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: EXTENSION_WEBAPP_SOURCE,
          type: "MONEY_IMPORT_GET_AUTO_STATUS",
          ts: Date.now(),
        },
        "*",
      );
    });
  }, []);

  // The extension's own account of what it will do on its own. Asked on its own ping rather
  // than the connector's, because the grants panel above it is shown whatever source is
  // selected -- and "nothing happens" is a question people bring to this screen first.
  const refreshExtensionAutoStatus = useCallback(async () => {
    setExtensionAutoStatus({ state: "loading", status: null });
    const pingResult = await pingExtension();
    if (!pingResult.active) {
      setExtensionAutoStatus({ state: "inactive", status: null });
      return;
    }
    const status = await requestExtensionAutoStatus();
    setExtensionAutoStatus(
      status ? { state: "ready", status } : { state: "inactive", status: null },
    );
  }, [pingExtension, requestExtensionAutoStatus]);

  useEffect(() => {
    void refreshExtensionAutoStatus();
  }, [refreshExtensionAutoStatus]);

  const checkExtension = useCallback(async () => {
    setExtensionActive(null);
    setInstalledExtensionId(null);
    setInstalledExtensionVersion(null);
    const pingResult = await pingExtension();
    setExtensionActive(pingResult.active);
    setInstalledExtensionId(pingResult.extensionId);
    setInstalledExtensionVersion(pingResult.extensionVersion);
    setExtensionStatusMessage(null);
    void refreshExtensionAutoStatus();
  }, [pingExtension, refreshExtensionAutoStatus]);

  useEffect(() => {
    if (!isExtensionConnector) return;
    void checkExtension();
  }, [checkExtension, isExtensionConnector]);

  useEffect(() => {
    if (!isExtensionConnector || !shouldUsePublishedExtensionFlow) {
      setLatestExtensionRelease(null);
      return;
    }
    void loadLatestExtensionRelease();
  }, [isExtensionConnector, loadLatestExtensionRelease, shouldUsePublishedExtensionFlow]);

  const loadExtensionImportContext = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "extension") {
      setExtensionImportContext(null);
      return null;
    }

    setIsLoadingExtensionImportContext(true);
    try {
      const accessToken = await getAccessToken();
      const context = await callMoneyImportActionClient<MoneyImportSourceContextResult>(
        {
          action: "get_import_context",
          source: selectedConnector.sourceId,
          payer_person_id: selectedPersonId,
        },
        accessToken,
      );
      setExtensionImportContext(context);
      setExtensionRangeChoice(defaultRangeChoiceForContext(context));
      setCustomRangeFrom(toLocalDateTimeInput(context.window_from));
      setCustomRangeTo(toLocalDateTimeInput(context.window_to));
      return context;
    } finally {
      setIsLoadingExtensionImportContext(false);
    }
  }, [selectedConnector, selectedPersonId]);

  useEffect(() => {
    if (!isExtensionConnector || !selectedPersonId || extensionActive !== true) {
      setExtensionImportContext(null);
      setIsLoadingExtensionImportContext(false);
      setExtensionRangeChoice("auto");
      setCustomRangeFrom("");
      setCustomRangeTo("");
      return;
    }
    void loadExtensionImportContext().catch((error) => {
      setExtensionStatusMessage(
        error instanceof Error ? error.message : t("money.importContextLoadFailed"),
      );
    });
  }, [extensionActive, isExtensionConnector, loadExtensionImportContext, selectedPersonId, t]);

  const resolvedExtensionRange = useMemo(() => {
    if (!extensionImportContext) return null;
    try {
      return buildRangeSelectionPayload(
        t,
        extensionImportContext,
        extensionRangeChoice,
        customRangeFrom,
        customRangeTo,
      );
    } catch {
      return null;
    }
  }, [customRangeFrom, customRangeTo, extensionImportContext, extensionRangeChoice, t]);

  const extensionDownloadUrl = useMemo(() => {
    if (latestExtensionRelease?.downloadUrl) return latestExtensionRelease.downloadUrl;
    if (selectedConnector?.kind === "extension") {
      return (
        selectedConnector.release?.latestDownloadUrl ??
        selectedConnector.guideUrl ??
        selectedConnector.websiteUrl ??
        "#"
      );
    }
    return "#";
  }, [latestExtensionRelease?.downloadUrl, selectedConnector]);

  const extensionUpdateAvailable = useMemo(
    () => isExtensionOutdated(installedExtensionVersion, latestExtensionRelease?.version ?? null),
    [installedExtensionVersion, latestExtensionRelease?.version],
  );

  const sendGrantToExtension = useCallback(
    async (grant: {
      token: string;
      personId: string;
      allowedSources: string[];
    }): Promise<boolean> => {
      // Resolves on the extension's ack, never on the post. The panel reports delivery from
      // this, because the key it is delivering exists in exactly one place and closing the
      // panel is the end of it.
      return await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve(false);
        }, 3000);

        const onMessage = (event: MessageEvent) => {
          const data = event.data as Record<string, unknown> | null;
          if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
          if (data.type !== "MONEY_IMPORT_GRANT_ACK") return;

          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          resolve(Boolean(data.ok));
        };

        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            source: EXTENSION_WEBAPP_SOURCE,
            type: "MONEY_IMPORT_SET_GRANT",
            grant: {
              token: grant.token,
              person_id: grant.personId,
              allowed_sources: grant.allowedSources,
              app_origin: window.location.origin,
              // Without this the extension stores a credential with no endpoint to call. The
              // extension checks it against its own host permissions before keeping it.
              function_url: getFunctionUrl("money-import"),
            },
          },
          window.location.origin,
        );
      });
    },
    [],
  );

  // A key the extension just took changes what the status card should say.
  const sendGrantToExtensionAndRefresh = useCallback(
    async (grant: { token: string; personId: string; allowedSources: string[] }) => {
      const delivered = await sendGrantToExtension(grant);
      if (delivered) void refreshExtensionAutoStatus();
      return delivered;
    },
    [refreshExtensionAutoStatus, sendGrantToExtension],
  );

  const extensionSourceLabels = useMemo(
    () =>
      Object.fromEntries(
        connectors
          .filter((connector) => connector.kind !== "file")
          .map((connector) => [connector.sourceId, resolveConnectorSourceLabel(t, connector)]),
      ) as Record<string, string>,
    [connectors, t],
  );

  const sendSessionToExtension = useCallback(
    async (
      payload: MoneyImportSessionCreateResult,
      userAccessToken: string,
      defaultExtensionAccountId: string | null,
    ): Promise<boolean> => {
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
              user_access_token: userAccessToken,
              batch_id: payload.batch_id,
              source: payload.source,
              payer_person_id: payload.payer_person_id,
              expires_at: payload.expires_at,
              last_imported_at: payload.last_imported_at,
              window_from: payload.window_from,
              window_to: payload.window_to,
              parse_strategy: payload.parse_strategy ?? null,
              range_selection_meta: payload.range_selection_meta ?? null,
              default_account_id: defaultExtensionAccountId,
              function_url: getFunctionUrl("money-import"),
              app_origin: window.location.origin,
              show_source_page_widget: true,
              // The widget on the bank page carries its own strings and needs to be told which
              // language the app is showing; it cannot read the app's translations from there.
              locale,
            },
          },
          "*",
        );
      });
    },
    [locale],
  );

  const launchExtensionFallback = useCallback(
    (
      payload: MoneyImportSessionCreateResult,
      defaultExtensionAccountId: string | null,
    ): boolean => {
      const resolvedExtensionId =
        installedExtensionId ?? latestExtensionRelease?.extensionId ?? EXTENSION_ID;
      if (!resolvedExtensionId) return false;
      const launchUrl =
        `chrome-extension://${resolvedExtensionId}/popup.html` +
        `?session_token=${encodeURIComponent(payload.session_token)}` +
        `&session_id=${encodeURIComponent(payload.session_id)}` +
        `&batch_id=${encodeURIComponent(payload.batch_id)}` +
        `&source=${encodeURIComponent(payload.source)}` +
        `&function_url=${encodeURIComponent(getFunctionUrl("money-import"))}` +
        `&payer_person_id=${encodeURIComponent(payload.payer_person_id)}` +
        `&expires_at=${encodeURIComponent(payload.expires_at)}` +
        `&last_imported_at=${encodeURIComponent(payload.last_imported_at ?? "")}` +
        `&window_from=${encodeURIComponent(payload.window_from ?? "")}` +
        `&window_to=${encodeURIComponent(payload.window_to ?? "")}` +
        `&parse_strategy=${encodeURIComponent(payload.parse_strategy ?? "")}` +
        `&show_source_page_widget=${encodeURIComponent("1")}` +
        `&range_selection_meta=${encodeURIComponent(
          JSON.stringify(payload.range_selection_meta ?? null),
        )}` +
        `&default_account_id=${encodeURIComponent(defaultExtensionAccountId ?? "")}` +
        // The same field the postMessage path sends; the popup seeds a session from this URL
        // and the widget would otherwise fall back to the browser's language on this path.
        `&locale=${encodeURIComponent(locale)}`;

      window.open(launchUrl, "_blank", "noopener,noreferrer");
      return true;
    },
    [installedExtensionId, latestExtensionRelease?.extensionId, locale],
  );

  const handleStartExtensionImport = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "extension") return;
    if (sourceAccounts.length === 0) {
      setExtensionStatusMessage(
        t("money.importNoSourceAccounts", { source: selectedConnectorSourceLabel }),
      );
      return;
    }
    const selectedDefaultExtensionAccountId =
      sourceAccounts.length === 1
        ? sourceAccounts[0].id
        : defaultAccountId.trim()
          ? defaultAccountId
          : null;
    if (sourceAccounts.length > 1 && !selectedDefaultExtensionAccountId) {
      setExtensionStatusMessage(t("money.selectAccount"));
      return;
    }

    setIsStartingExtension(true);
    setExtensionStatusMessage(null);

    try {
      const importContext = extensionImportContext ?? (await loadExtensionImportContext());
      if (!importContext) {
        throw new Error(t("money.importContextUnavailable"));
      }
      const rangeSelection = buildRangeSelectionPayload(
        t,
        importContext,
        extensionRangeChoice,
        customRangeFrom,
        customRangeTo,
      );
      if (selectedConnector.websiteUrl) {
        window.open(selectedConnector.websiteUrl, "_blank", "noopener,noreferrer");
      }

      const accessToken = await getAccessToken();
      const session = await callMoneyImportActionClient<MoneyImportSessionCreateResult>(
        {
          action: "create_session",
          source: selectedConnector.sourceId,
          payer_person_id: selectedPersonId,
          window_from: rangeSelection.windowFrom,
          window_to: rangeSelection.windowTo,
          meta: {
            parse_strategy: isTbankExtensionConnector ? extensionParseStrategy : null,
            range_selection_meta: rangeSelection.rangeSelectionMeta,
          },
        },
        accessToken,
      );

      setActiveSessionId(session.session_id);
      setActiveBatchId(session.batch_id);

      const deliveredByMessage = await sendSessionToExtension(
        session,
        accessToken,
        selectedDefaultExtensionAccountId,
      );
      if (deliveredByMessage) {
        setExtensionStatusMessage(t("money.importExtensionSessionCreated"));
        return;
      }

      const launched = launchExtensionFallback(session, selectedDefaultExtensionAccountId);
      if (launched) {
        setExtensionStatusMessage(t("money.importExtensionSessionCreated"));
      } else {
        setExtensionStatusMessage(t("money.importExtensionOpenPopupManual"));
      }
    } catch (error) {
      setExtensionStatusMessage(
        error instanceof Error ? error.message : t("money.importStartFailed"),
      );
    } finally {
      setIsStartingExtension(false);
    }
  }, [
    customRangeFrom,
    customRangeTo,
    launchExtensionFallback,
    defaultAccountId,
    extensionImportContext,
    extensionParseStrategy,
    extensionRangeChoice,
    isTbankExtensionConnector,
    loadExtensionImportContext,
    selectedPersonId,
    selectedConnector,
    selectedConnectorSourceLabel,
    sendSessionToExtension,
    sourceAccounts,
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{t("money.importTitle")}</h1>
        <Button variant="outline" asChild>
          <Link href="/money/import/history">{t("money.importViewHistory")}</Link>
        </Button>
      </div>

      <MoneyImportGrants
        t={t}
        personId={selectedPersonId}
        availableSources={extensionConnectorOptions}
        onSendToExtension={sendGrantToExtensionAndRefresh}
      />

      <MoneyImportAutoStatus
        t={t}
        state={extensionAutoStatus.state}
        status={extensionAutoStatus.status}
        sourceLabels={extensionSourceLabels}
        onRefresh={() => void refreshExtensionAutoStatus()}
      />

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
                setInstalledExtensionId(null);
                setInstalledExtensionVersion(null);
                setLatestExtensionRelease(null);
                setExtensionImportContext(null);
                setIsLoadingExtensionImportContext(false);
                setExtensionRangeChoice("auto");
                setExtensionParseStrategy(DEFAULT_TBANK_PARSE_STRATEGY);
                setCustomRangeFrom("");
                setCustomRangeTo("");
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
              {isParsing && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
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
                        parseResult.transactions[parseResult.transactions.length - 1].posted_at,
                      ),
                      "dd.MM.yyyy HH:mm",
                    )}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {sourceAccounts.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      {t("money.importNoSourceAccounts", {
                        source: selectedConnectorSourceLabel,
                      })}
                      <span
                        className="inline-flex text-muted-foreground cursor-help"
                        title={t("money.importNoSourceAccountsTooltip", {
                          source: selectedConnectorSourceLabel,
                        })}
                      >
                        <HelpCircle className="h-4 w-4" />
                      </span>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={createAccountMutation.isPending}
                      onClick={handleCreateSourceAccount}
                    >
                      <Plus className="h-4 w-4" />
                      {t("money.importCreateSourceAccount", {
                        source: selectedConnectorSourceLabel,
                      })}
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
                              <td className="p-2">
                                {getAccountHint(row) ? `*${getAccountHint(row)}` : "-"}
                              </td>
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
            {sourceAccounts.length === 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  {t("money.importNoSourceAccounts", {
                    source: selectedConnectorSourceLabel,
                  })}
                  <span
                    className="inline-flex text-muted-foreground cursor-help"
                    title={t("money.importNoSourceAccountsTooltip", {
                      source: selectedConnectorSourceLabel,
                    })}
                  >
                    <HelpCircle className="h-4 w-4" />
                  </span>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={createAccountMutation.isPending}
                  onClick={handleCreateSourceAccount}
                >
                  <Plus className="h-4 w-4" />
                  {t("money.importCreateSourceAccount", {
                    source: selectedConnectorSourceLabel,
                  })}
                </Button>
              </div>
            )}

            {extensionActive === null && (
              <p className="text-sm text-muted-foreground">{t("money.importExtensionChecking")}</p>
            )}

            {extensionActive === true && (
              <div className="space-y-4">
                {sourceAccounts.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("money.importDefaultAccount")}</label>
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
                )}
                {(installedExtensionVersion || latestExtensionRelease?.version) && (
                  <div className="space-y-2 rounded-md border p-4">
                    {installedExtensionVersion && (
                      <p className="text-sm text-muted-foreground">
                        {`${t("money.importExtensionVersionCurrent")}: ${installedExtensionVersion}`}
                      </p>
                    )}
                    {latestExtensionRelease?.version && (
                      <p className="text-sm text-muted-foreground">
                        {`${t("money.importExtensionVersionLatest")}: ${latestExtensionRelease.version}`}
                      </p>
                    )}
                    {extensionUpdateAvailable && (
                      <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                        <p className="text-sm font-medium">
                          {t("money.importExtensionUpdateAvailable")}
                        </p>
                        <Button variant="outline" size="sm" asChild>
                          <a href={extensionDownloadUrl}>
                            {t("money.importExtensionDownloadLatest")}
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-3 rounded-md border p-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{t("money.importRangeTitle")}</div>
                    <p className="text-sm text-muted-foreground">
                      {isLoadingExtensionImportContext
                        ? t("money.importRangeLoading")
                        : extensionImportContext?.requires_history_prompt
                          ? t("money.importRangePromptHistory")
                          : t("money.importRangeContinue")}
                    </p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <Button
                      type="button"
                      variant={extensionRangeChoice === "auto" ? "default" : "outline"}
                      onClick={() => setExtensionRangeChoice("auto")}
                      disabled={
                        !extensionImportContext || extensionImportContext.requires_history_prompt
                      }
                    >
                      {t("money.importRangeAuto")}
                    </Button>
                    <Button
                      type="button"
                      variant={extensionRangeChoice === "preset:1y" ? "default" : "outline"}
                      onClick={() => setExtensionRangeChoice("preset:1y")}
                      disabled={!extensionImportContext}
                    >
                      {t("money.importRange1y")}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        extensionRangeChoice === "preset:since_last_import" ? "default" : "outline"
                      }
                      onClick={() => setExtensionRangeChoice("preset:since_last_import")}
                      disabled={!extensionImportContext?.last_imported_at}
                    >
                      {t("money.importRangeSinceLastImport")}
                    </Button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-4">
                    <Button
                      type="button"
                      variant={extensionRangeChoice === "preset:1m" ? "default" : "outline"}
                      onClick={() => setExtensionRangeChoice("preset:1m")}
                      disabled={!extensionImportContext}
                    >
                      {t("money.importRange1m")}
                    </Button>
                    <Button
                      type="button"
                      variant={extensionRangeChoice === "preset:3m" ? "default" : "outline"}
                      onClick={() => setExtensionRangeChoice("preset:3m")}
                      disabled={!extensionImportContext}
                    >
                      {t("money.importRange3m")}
                    </Button>
                    <Button
                      type="button"
                      variant={extensionRangeChoice === "preset:6m" ? "default" : "outline"}
                      onClick={() => setExtensionRangeChoice("preset:6m")}
                      disabled={!extensionImportContext}
                    >
                      {t("money.importRange6m")}
                    </Button>
                    <Button
                      type="button"
                      variant={extensionRangeChoice === "custom" ? "default" : "outline"}
                      onClick={() => setExtensionRangeChoice("custom")}
                      disabled={!extensionImportContext}
                    >
                      {t("money.importRangeCustom")}
                    </Button>
                  </div>

                  {extensionRangeChoice === "custom" && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="customRangeFrom">{t("money.importRangeFrom")}</Label>
                        <Input
                          id="customRangeFrom"
                          type="datetime-local"
                          value={customRangeFrom}
                          onChange={(event) => setCustomRangeFrom(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="customRangeTo">{t("money.importRangeTo")}</Label>
                        <Input
                          id="customRangeTo"
                          type="datetime-local"
                          value={customRangeTo}
                          onChange={(event) => setCustomRangeTo(event.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="text-sm text-muted-foreground">
                    {t("money.importRangeSelected", {
                      range: formatSelectedRange(
                        resolvedExtensionRange?.windowFrom ??
                          extensionImportContext?.window_from ??
                          null,
                        resolvedExtensionRange?.windowTo ??
                          extensionImportContext?.window_to ??
                          null,
                      ),
                    })}
                  </div>
                </div>
                {isTbankExtensionConnector && (
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">{t("money.importStrategyTitle")}</div>
                      <p className="text-sm text-muted-foreground">
                        {t("money.importStrategyHint")}
                      </p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={extensionParseStrategy === "fast" ? "default" : "outline"}
                        data-state={extensionParseStrategy === "fast" ? "on" : "off"}
                        onClick={() => setExtensionParseStrategy("fast")}
                      >
                        {t("money.importStrategyFast")}
                      </Button>
                      <Button
                        type="button"
                        variant={extensionParseStrategy === "full" ? "default" : "outline"}
                        data-state={extensionParseStrategy === "full" ? "on" : "off"}
                        onClick={() => setExtensionParseStrategy("full")}
                      >
                        {t("money.importStrategyFull")}
                      </Button>
                    </div>
                  </div>
                )}
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    {t("money.importExtensionSourceStep1", {
                      source: selectedConnectorSourceLabel,
                    })}
                  </li>
                  <li>
                    {t("money.importExtensionSourceStep2", {
                      source: selectedConnectorSourceLabel,
                    })}
                  </li>
                  <li>
                    {t("money.importExtensionSourceStep3", {
                      source: selectedConnectorSourceLabel,
                    })}
                  </li>
                </ol>
                <Button
                  className="gap-2"
                  onClick={handleStartExtensionImport}
                  disabled={
                    isStartingExtension ||
                    isLoadingExtensionImportContext ||
                    !extensionImportContext ||
                    !resolvedExtensionRange ||
                    sourceAccounts.length === 0 ||
                    (sourceAccounts.length > 1 && !defaultAccountId)
                  }
                >
                  {isStartingExtension ? t("common.loading") : t("money.importStartImport")}
                </Button>
              </div>
            )}

            {extensionActive === false && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {shouldUsePublishedExtensionFlow
                    ? t("money.importExtensionInstallProd")
                    : t("money.importExtensionInstallDev")}
                </p>
                {shouldUsePublishedExtensionFlow && (
                  <>
                    <Button variant="outline" size="sm" asChild>
                      <a href={extensionDownloadUrl}>{t("money.importExtensionDownloadLatest")}</a>
                    </Button>
                    <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                      <li>{t("money.importExtensionInstallProdStep1")}</li>
                      <li>{t("money.importExtensionInstallProdStep2")}</li>
                      <li>{t("money.importExtensionInstallProdStep3")}</li>
                    </ol>
                  </>
                )}
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
              <Badge variant="destructive">{t("money.importExtensionInactive")}</Badge>
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

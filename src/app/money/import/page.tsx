"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useDropzone } from "react-dropzone";
import { ChevronDown, LinkIcon, Upload } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { getConnectors } from "@/lib/import/connector-types";
import { importBatchRows } from "@/types/money-import-rows";
import {
  canRunImportExtension,
  importBankOfSource,
  importBankOptions,
  type ImportBankId,
  type ImportBankOption,
  type ImportMethodOption,
} from "@/types/money-import-sources";
import {
  MoneyImportAutoStatus,
  MoneyImportGrants,
  readExtensionAutoStatus,
  type ExtensionAutoStatus,
} from "@/components/money";
import {
  detectExtensionBrowser,
  extensionReleaseForBrowser,
  isExtensionOutdated,
  normalizeExtensionRelease,
  type ExtensionBrowser,
  type ExtensionRelease,
} from "@/lib/import/extension-release";
import {
  type MoneyImportConnector,
  type MoneyImportParseStrategy,
  type MoneyImportPreviewResult,
  type MoneyImportSessionCreateResult,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { format, subMonths } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import "@/lib/import/connectors/tbank-csv";
import "@/lib/import/connectors/tbank-web";
import "@/lib/import/connectors/alfa-web";

const EXTENSION_WEBAPP_SOURCE = "orbit-webapp";
const EXTENSION_BRIDGE_SOURCE = "orbit-extension";
const DEFAULT_TBANK_PARSE_STRATEGY: MoneyImportParseStrategy = "full";
const EXTENSION_PING_TIMEOUT_MS = 500;
/** Focus and visibility often fire together; one ask covers both. */
const EXTENSION_RECHECK_MIN_GAP_MS = 2000;
// The ping is answered by the service worker, which may be asleep; one 500 ms miss is a slow
// wake as often as a missing extension, so the start asks a few times before giving up.
const START_PROBE_OFFSETS_MS: readonly number[] = [0, 500, 1500, 3000];
// Before 0.1.30 the extension acknowledged a session only after the bank tab the page had just
// opened finished loading -- often longer than the old three seconds, while the import worked.
const SESSION_HANDOFF_TIMEOUT_MS = 15_000;

const BANK_KEYS: Record<ImportBankId, `money.importBank${string}`> = {
  tbank: "money.importBankTbank",
  alfa: "money.importBankAlfa",
  other: "money.importBankOther",
};
// A letter on the bank's colour stands in for its logo, which the app does not host.
const BANK_MARKS: Record<ImportBankId, { letter: string; className: string }> = {
  tbank: { letter: "Т", className: "bg-yellow-300 text-neutral-900" },
  alfa: { letter: "А", className: "bg-red-600 text-white" },
  other: { letter: "…", className: "bg-muted text-muted-foreground" },
};

type ExtensionPingResult = {
  active: boolean;
  extensionId: string | null;
  extensionVersion: string | null;
};

import {
  callMoneyImportAction as callMoneyImportActionClient,
  getAccessToken,
  getFunctionUrl,
  loadRecentImports,
  type RecentImport,
} from "./money-import-client";
import { getAppEnvironmentKind } from "./extension-release-client";
import {
  probeExtensionUntilHeard,
  reloadPage,
  setExtensionAutoSchedule,
  type ImportAutoSchedule,
} from "@/lib/money/extension-bridge";
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

const RANGE_CHOICES: ReadonlyArray<{ choice: ExtensionRangeChoice; key: string }> = [
  { choice: "auto", key: "money.importRangeAuto" },
  { choice: "preset:since_last_import", key: "money.importRangeSinceLastImport" },
  { choice: "preset:1m", key: "money.importRange1m" },
  { choice: "preset:3m", key: "money.importRange3m" },
  { choice: "preset:6m", key: "money.importRange6m" },
  { choice: "preset:1y", key: "money.importRange1y" },
  { choice: "custom", key: "money.importRangeCustom" },
];

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

function rangeChoiceDisabled(
  choice: ExtensionRangeChoice,
  context: MoneyImportSourceContextResult | null,
): boolean {
  if (!context) return true;
  if (choice === "auto") return context.requires_history_prompt;
  if (choice === "preset:since_last_import") return !context.last_imported_at;
  return false;
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
  return `${format(new Date(windowFrom), "dd.MM.yyyy HH:mm")} – ${format(new Date(windowTo), "dd.MM.yyyy HH:mm")}`;
}

/** A choice on the page: a bank or a way to import, greyed and inert where it is not offered. */
function SourceChoice({
  selected,
  available,
  onSelect,
  mark,
  title,
  chip,
  hint,
  status,
  compact,
  testId,
}: {
  selected: boolean;
  available: boolean;
  onSelect: () => void;
  mark?: React.ReactNode;
  title: string;
  chip?: string;
  hint: string;
  status?: React.ReactNode;
  /** On a phone, a pill with no hint: the hints of what is unavailable are listed under the row. */
  compact?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      disabled={!available}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-colors",
        selected ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/30",
        !available && "cursor-not-allowed bg-muted/50 text-muted-foreground hover:border-border",
        compact && "max-sm:w-auto max-sm:rounded-[10px] max-sm:px-3.5 max-sm:py-2",
      )}
    >
      <span className="flex w-full flex-wrap items-center gap-2.5">
        {mark}
        <span className="text-[15px] font-semibold">{title}</span>
        {chip ? (
          <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[11px] font-semibold leading-5 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
            {chip}
          </span>
        ) : null}
      </span>
      <span className={cn("text-[13px] text-muted-foreground", compact && "max-sm:hidden")}>
        {hint}
      </span>
      {status}
    </button>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

export default function MoneyImportPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);

  const connectors = getConnectors();

  const [selectedBank, setSelectedBank] = useState<ImportBankId | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [fileStatus, setFileStatus] = useState<{ count: number } | "reading" | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  // Rows the parser could not read never reach the server, so the report cannot tell of them.
  const [fileSkipped, setFileSkipped] = useState<{ batchId: string; rows: number } | null>(null);

  const [extensionActive, setExtensionActive] = useState<boolean | null>(null);
  const [extensionAutoStatus, setExtensionAutoStatus] = useState<{
    state: "loading" | "inactive" | "unavailable" | "ready";
    status: ExtensionAutoStatus | null;
  }>({ state: "loading", status: null });
  const [extensionStatusMessage, setExtensionStatusMessage] = useState<string | null>(null);
  const [installedExtensionVersion, setInstalledExtensionVersion] = useState<string | null>(null);
  const [latestExtensionRelease, setLatestExtensionRelease] = useState<ExtensionRelease | null>(
    null,
  );
  // Read after mount: the server render has no browser, and guessing one there would mismatch.
  const [extensionBrowser, setExtensionBrowser] = useState<ExtensionBrowser>("chrome");
  const [extensionDevice, setExtensionDevice] = useState(true);
  useEffect(() => {
    setExtensionBrowser(detectExtensionBrowser(navigator.userAgent));
    setExtensionDevice(canRunImportExtension(navigator.userAgent));
  }, []);
  const browserExtensionRelease = useMemo(
    () => extensionReleaseForBrowser(latestExtensionRelease, extensionBrowser),
    [extensionBrowser, latestExtensionRelease],
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

  const appEnvironmentKind = getAppEnvironmentKind();

  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  useEffect(() => {
    if (!selectedPersonId) return;
    let cancelled = false;
    void loadRecentImports(selectedPersonId).then((rows) => {
      if (!cancelled) setRecentImports(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonId]);

  const banks = useMemo(
    () => importBankOptions(connectors, { extension: extensionDevice }),
    [connectors, extensionDevice],
  );
  const bank = useMemo(
    () => banks.find((one) => one.id === selectedBank) ?? null,
    [banks, selectedBank],
  );
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
  const selectedBankLabel = bank ? t(BANK_KEYS[bank.id]) : "";

  const isFileConnector = selectedConnector?.kind === "file";
  const isExtensionConnector = selectedConnector?.kind === "extension";
  const isTbankExtensionConnector = selectedConnector?.sourceId === "tbank_web";
  const isProductionExtensionInstallFlow = appEnvironmentKind === "production";
  const shouldUsePublishedExtensionFlow =
    isProductionExtensionInstallFlow ||
    (process.env.NODE_ENV === "test" &&
      selectedConnector?.kind === "extension" &&
      Boolean(selectedConnector.release?.latestDownloadUrl));

  const resetSourceState = () => {
    setFileStatus(null);
    setFileErrors([]);
    setFileSkipped(null);
    setExtensionActive(null);
    setExtensionStatusMessage(null);
    setInstalledExtensionVersion(null);
    setLatestExtensionRelease(null);
    setExtensionImportContext(null);
    setIsLoadingExtensionImportContext(false);
    setExtensionRangeChoice("auto");
    setExtensionParseStrategy(DEFAULT_TBANK_PARSE_STRATEGY);
    setCustomRangeFrom("");
    setCustomRangeTo("");
  };

  const selectMethod = (method: ImportMethodOption) => {
    if (!method.available || method.sourceId === selectedSourceId) return;
    resetSourceState();
    setSelectedSourceId(method.sourceId);
  };

  // The way a bank is usually imported comes chosen with it: the first one this device can do.
  const selectBank = (option: ImportBankOption) => {
    if (!option.available) return;
    setSelectedBank(option.id);
    const first = option.methods.find((method) => method.available);
    if (first) selectMethod(first);
  };

  // A statement starts as soon as it is read: the server finds each card's account, or puts it
  // on the bank's first account, and applies the batch on its own (T-261026-2ew).
  const importFile = useCallback(
    async (f: File) => {
      if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "file") return;
      setFileErrors([]);
      setFileSkipped(null);
      setFileStatus("reading");
      try {
        const parsed = await selectedConnector.parse(f).catch(() => null);
        if (!parsed) throw new Error(t("money.importParseError"));
        if (parsed.transactions.length === 0) {
          // The parser's own reasons are English and technical; the person needs only this.
          setFileErrors([t("money.importFileEmpty")]);
          setFileStatus(null);
          return;
        }
        setFileStatus({ count: parsed.transactions.length });
        const accessToken = await getAccessToken();
        const result = await callMoneyImportActionClient<MoneyImportPreviewResult>(
          {
            action: "preview_rows",
            source: selectedConnector.sourceId,
            payer_person_id: selectedPersonId,
            import_type: "file",
            file_path: f.name,
            rows: importBatchRows(parsed.transactions),
          },
          accessToken,
        );
        const skipped = parsed.errors?.length ?? 0;
        if (skipped > 0) {
          setFileSkipped({ batchId: result.batch_id, rows: skipped });
          setFileStatus(null);
          return;
        }
        router.push(`/money/import/reports/${result.batch_id}`);
      } catch (error) {
        setFileErrors([error instanceof Error ? error.message : t("money.importFailed")]);
        setFileStatus(null);
      }
    },
    [router, selectedConnector, selectedPersonId, t],
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    accept: isFileConnector
      ? (selectedConnector?.fileAccept ?? {
          "text/csv": [".csv"],
        })
      : undefined,
    maxFiles: 1,
    disabled: !isFileConnector || fileStatus !== null,
    onDropAccepted: (acceptedFiles) => {
      const f = acceptedFiles[0];
      if (f) void importFile(f);
    },
  });

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
      // The bridge echoes this, so a reply to an earlier request -- a Re-check while the
      // post-grant refresh is still pending -- cannot answer this one with older state.
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, EXTENSION_PING_TIMEOUT_MS);

      const onMessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
        if (data.type !== "MONEY_IMPORT_AUTO_STATUS") return;
        if (data.request_id !== requestId) return;

        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(readExtensionAutoStatus(data));
      };

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: EXTENSION_WEBAPP_SOURCE,
          type: "MONEY_IMPORT_GET_AUTO_STATUS",
          request_id: requestId,
          ts: Date.now(),
        },
        "*",
      );
    });
  }, []);

  // The extension's own account of what it will do on its own. Asked on its own ping rather
  // than the connector's, because the auto-import panel is shown whatever source is selected --
  // and "nothing happens" is a question people bring to this screen first.
  const refreshExtensionAutoStatus = useCallback(async () => {
    setExtensionAutoStatus({ state: "loading", status: null });
    const pingResult = await pingExtension();
    if (!pingResult.active) {
      setExtensionAutoStatus({ state: "inactive", status: null });
      return;
    }
    // The ping succeeded, so the extension is there; a status it cannot give (an older
    // version, a slow service-worker wake) is "unavailable", not "not installed".
    const status = await requestExtensionAutoStatus();
    setExtensionAutoStatus(
      status ? { state: "ready", status } : { state: "unavailable", status: null },
    );
  }, [pingExtension, requestExtensionAutoStatus]);

  useEffect(() => {
    void refreshExtensionAutoStatus();
  }, [refreshExtensionAutoStatus]);

  // What the extension kept goes into the status the panel shows, and then the status is read
  // again: the next run it reports depends on the schedule.
  const changeAutoSchedule = useCallback(
    async (schedule: ImportAutoSchedule) => {
      const kept = await setExtensionAutoSchedule(schedule);
      if (kept) {
        setExtensionAutoStatus((current) =>
          current.status ? { ...current, status: { ...current.status, schedule: kept } } : current,
        );
        const status = await requestExtensionAutoStatus();
        if (status) setExtensionAutoStatus({ state: "ready", status });
      }
      return kept;
    },
    [requestExtensionAutoStatus],
  );

  const checkExtension = useCallback(async () => {
    setExtensionActive(null);
    setInstalledExtensionVersion(null);
    const pingResult = await pingExtension();
    setExtensionActive(pingResult.active);
    setInstalledExtensionVersion(pingResult.extensionVersion);
    setExtensionStatusMessage(null);
    void refreshExtensionAutoStatus();
  }, [pingExtension, refreshExtensionAutoStatus]);

  // Again for each extension source picked: switching banks clears the last answer.
  useEffect(() => {
    if (!isExtensionConnector) return;
    void checkExtension();
  }, [checkExtension, isExtensionConnector, selectedSourceId]);

  // An extension updated while this page was open is heard only when asked again: the page
  // kept saying v0.1.31 under an installed 0.1.33 (2026-10-27). Coming back into view, or
  // getting focus back from the extension's popup, asks once more -- quietly, so the panel does
  // not blank on every focus, and only a live answer replaces what the page shows.
  useEffect(() => {
    if (!isExtensionConnector) return;
    let lastAskedAtMs = 0;
    const askAgain = () => {
      if (document.visibilityState !== "visible") return;
      const nowMs = Date.now();
      if (nowMs - lastAskedAtMs < EXTENSION_RECHECK_MIN_GAP_MS) return;
      lastAskedAtMs = nowMs;
      void (async () => {
        const pingResult = await pingExtension();
        if (!pingResult.active) return;
        setExtensionActive(true);
        setInstalledExtensionVersion(pingResult.extensionVersion);
        const status = await requestExtensionAutoStatus();
        if (status) setExtensionAutoStatus({ state: "ready", status });
      })();
    };
    window.addEventListener("focus", askAgain);
    document.addEventListener("visibilitychange", askAgain);
    return () => {
      window.removeEventListener("focus", askAgain);
      document.removeEventListener("visibilitychange", askAgain);
    };
  }, [isExtensionConnector, pingExtension, requestExtensionAutoStatus]);

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

  const extensionDownloadUrl = useMemo((): string | null => {
    if (browserExtensionRelease) return browserExtensionRelease.downloadUrl;
    // The connector's links below are the Chrome archive and its guide; Firefox has nothing to
    // fall back to until a signed add-on is published.
    if (extensionBrowser === "firefox") return null;
    if (selectedConnector?.kind === "extension") {
      return (
        selectedConnector.release?.latestDownloadUrl ??
        selectedConnector.guideUrl ??
        selectedConnector.websiteUrl ??
        "#"
      );
    }
    return "#";
  }, [browserExtensionRelease, extensionBrowser, selectedConnector]);

  const extensionUpdateAvailable = useMemo(
    () => isExtensionOutdated(installedExtensionVersion, browserExtensionRelease?.version ?? null),
    [installedExtensionVersion, browserExtensionRelease?.version],
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
          .map((connector) => [connector.sourceId, connectorBankLabel(t, connector)]),
      ) as Record<string, string>,
    [connectors, t],
  );

  const sendSessionToExtension = useCallback(
    async (payload: MoneyImportSessionCreateResult, userAccessToken: string): Promise<boolean> => {
      return await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve(false);
        }, SESSION_HANDOFF_TIMEOUT_MS);

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
              // Nobody picks an account: the server finds each card's (T-261026-2ew).
              default_account_id: null,
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

  const handleStartExtensionImport = useCallback(async () => {
    if (!selectedPersonId || !selectedConnector || selectedConnector.kind !== "extension") return;

    setIsStartingExtension(true);
    setExtensionStatusMessage(null);

    try {
      // The extension can stop answering after the page loaded -- reloaded, updated, disabled --
      // so ask again before a session is created and the bank is opened for nothing.
      const probe = await probeExtensionUntilHeard(
        START_PROBE_OFFSETS_MS,
        EXTENSION_PING_TIMEOUT_MS,
      );
      if (probe !== "alive") {
        setExtensionActive(false);
        setInstalledExtensionVersion(null);
        // A stale bridge is the extension updated under this tab: only a reload brings it back.
        setExtensionStatusMessage(
          t(
            probe === "stale"
              ? "money.importExtensionStaleReload"
              : "money.importExtensionNotAnswering",
          ),
        );
        return;
      }

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

      const deliveredByMessage = await sendSessionToExtension(session, accessToken);
      if (deliveredByMessage) {
        // The import's own page follows it from here and says when the bank tab can be closed.
        router.push(`/money/import/reports/${session.batch_id}`);
        return;
      }

      setExtensionStatusMessage(t("money.importExtensionHandoffFailed"));
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
    extensionImportContext,
    extensionParseStrategy,
    extensionRangeChoice,
    isTbankExtensionConnector,
    loadExtensionImportContext,
    router,
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

  const methodHint = (method: ImportMethodOption): string => {
    if (method.kind === "file") return t("money.importMethodFileHint");
    if (!method.available) return t("money.importMethodExtensionDesktopOnly");
    return t("money.importMethodExtensionHint", { bank: selectedBankLabel });
  };
  const shortDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const bankHint = (option: ImportBankOption): string => {
    if (option.methods.length === 0) return t("money.importBankSoon");
    if (!option.available) return t("money.importBankDesktopOnly");
    const last = recentImports.find((one) => importBankOfSource(one.source) === option.id);
    return last
      ? t("money.importBankLast", { date: shortDate.format(new Date(last.created_at)) })
      : t("money.importBankNever");
  };
  const lastImport = recentImports[0];
  const extensionStatus = (method: ImportMethodOption) =>
    method.kind === "extension" &&
    method.sourceId === selectedSourceId &&
    extensionActive !== null ? (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs",
          extensionActive ? "text-green-700 dark:text-green-400" : "text-destructive",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            extensionActive ? "bg-green-600" : "bg-destructive",
          )}
        />
        {!extensionActive
          ? t("money.importExtensionInactive")
          : installedExtensionVersion
            ? t("money.importExtensionConnected", { version: installedExtensionVersion })
            : t("money.importExtensionActive")}
      </span>
    ) : undefined;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("money.importTitle")}</h1>
          {lastImport && (
            <p className="text-sm text-muted-foreground" data-testid="import-last">
              {t("money.importLastImport", {
                date: new Intl.DateTimeFormat(locale, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(lastImport.created_at)),
                bank:
                  importBankOfSource(lastImport.source) === "other"
                    ? lastImport.source
                    : t(BANK_KEYS[importBankOfSource(lastImport.source)]),
                count: lastImport.inserted_count,
              })}
            </p>
          )}
        </div>
        <div className="flex w-full gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button variant="outline" asChild>
            <Link href="/money/import/attention">{t("money.importAttentionTitle")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/money/import/history">{t("money.importViewHistory")}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-6">
          <section className="space-y-3">
            <StepTitle>{t("money.importStepBank")}</StepTitle>
            <div className="flex flex-wrap gap-2 sm:grid sm:grid-cols-3 sm:gap-3">
              {banks.map((option) => (
                <SourceChoice
                  key={option.id}
                  compact
                  testId={`import-bank-${option.id}`}
                  selected={selectedBank === option.id}
                  available={option.available}
                  onSelect={() => selectBank(option)}
                  mark={
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold max-sm:h-6 max-sm:w-6 max-sm:text-xs",
                        BANK_MARKS[option.id].className,
                      )}
                    >
                      {BANK_MARKS[option.id].letter}
                    </span>
                  }
                  title={t(BANK_KEYS[option.id])}
                  hint={bankHint(option)}
                />
              ))}
            </div>
            {banks
              .filter((option) => !option.available)
              .map((option) => (
                <p key={option.id} className="text-xs text-muted-foreground sm:hidden">
                  {`${t(BANK_KEYS[option.id])}: ${bankHint(option)}`}
                </p>
              ))}
          </section>

          {bank && (
            <section className="space-y-3">
              <StepTitle>{t("money.importStepMethod")}</StepTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {bank.methods.map((method) => (
                  <SourceChoice
                    key={method.kind}
                    testId={`import-method-${method.kind}`}
                    selected={selectedSourceId === method.sourceId}
                    available={method.available}
                    onSelect={() => selectMethod(method)}
                    title={t(
                      method.kind === "file"
                        ? "money.importMethodFile"
                        : "money.importMethodExtension",
                    )}
                    chip={method.recommended ? t("money.importRecommended") : undefined}
                    hint={methodHint(method)}
                    status={extensionStatus(method)}
                  />
                ))}
              </div>
            </section>
          )}

          {isFileConnector && selectedConnector && (
            <Card className="rounded-xl">
              <CardContent className="space-y-4 p-5">
                <StepTitle>{t("money.importStepFile")}</StepTitle>
                <div
                  {...getRootProps()}
                  className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
                  data-drag-active={isDragActive || undefined}
                >
                  <input {...getInputProps()} />
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">{t("money.importFileChoose")}</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {t("money.importFileAutoStart")}
                  </p>
                </div>
                <Button
                  type="button"
                  className="h-12 w-full text-[15px] font-semibold sm:hidden"
                  disabled={fileStatus !== null}
                  onClick={openFilePicker}
                >
                  {t("money.importUploadFile")}
                </Button>
                {fileStatus !== null && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {fileStatus === "reading"
                      ? t("money.importFileReading")
                      : t("money.importFileUploading", { count: fileStatus.count })}
                  </p>
                )}
                {fileErrors.length > 0 && (
                  <ul className="list-inside list-disc text-sm text-destructive">
                    {fileErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                )}
                {fileSkipped && (
                  <div
                    role="alert"
                    className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  >
                    <p>{t("money.importFileSkipped", { count: fileSkipped.rows })}</p>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/money/import/reports/${fileSkipped.batchId}`}>
                        {t("money.importOpenReport")}
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isExtensionConnector && selectedConnector && (
            <Card className="rounded-xl">
              <CardContent className="space-y-4 p-5">
                <StepTitle>{t("money.importStepPeriod")}</StepTitle>
                {extensionActive === null && (
                  <p className="text-sm text-muted-foreground">
                    {t("money.importExtensionChecking")}
                  </p>
                )}

                {extensionActive === true && (
                  <div className="space-y-4">
                    {installedExtensionVersion && extensionUpdateAvailable && (
                      <p className="text-sm text-muted-foreground">
                        {`${t("money.importExtensionVersionCurrent")}: ${installedExtensionVersion}`}
                        {browserExtensionRelease?.version
                          ? ` · ${t("money.importExtensionVersionLatest")}: ${browserExtensionRelease.version}`
                          : ""}
                      </p>
                    )}
                    {extensionUpdateAvailable && extensionDownloadUrl && (
                      <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                        <p className="text-sm font-medium">
                          {extensionBrowser === "firefox"
                            ? t("money.importExtensionUpdateAvailableFirefox")
                            : t("money.importExtensionUpdateAvailable")}
                        </p>
                        <Button variant="outline" size="sm" asChild>
                          <a href={extensionDownloadUrl}>
                            {t("money.importExtensionDownloadLatest")}
                          </a>
                        </Button>
                      </div>
                    )}

                    <div className="space-y-3">
                      {(isLoadingExtensionImportContext ||
                        extensionImportContext?.requires_history_prompt) && (
                        <p className="text-sm text-muted-foreground">
                          {isLoadingExtensionImportContext
                            ? t("money.importRangeLoading")
                            : t("money.importRangePromptHistory")}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {RANGE_CHOICES.map(({ choice, key }) => (
                          <Button
                            key={choice}
                            type="button"
                            size="sm"
                            className="rounded-full"
                            variant={extensionRangeChoice === choice ? "default" : "outline"}
                            aria-pressed={extensionRangeChoice === choice}
                            onClick={() => setExtensionRangeChoice(choice)}
                            disabled={rangeChoiceDisabled(choice, extensionImportContext)}
                          >
                            {t(key)}
                          </Button>
                        ))}
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

                      <p className="text-[13px] text-muted-foreground">
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
                        . {t("money.importAccountsAuto")}
                      </p>
                    </div>

                    {isTbankExtensionConnector && (
                      <details className="space-y-2 text-sm">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          {t("money.importStrategyMore")}
                        </summary>
                        <p className="pt-2 text-muted-foreground">
                          {t("money.importStrategyHint")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(["full", "fast"] as const).map((strategy) => (
                            <Button
                              key={strategy}
                              type="button"
                              size="sm"
                              className="rounded-full"
                              variant={extensionParseStrategy === strategy ? "default" : "outline"}
                              data-state={extensionParseStrategy === strategy ? "on" : "off"}
                              onClick={() => setExtensionParseStrategy(strategy)}
                            >
                              {t(
                                strategy === "full"
                                  ? "money.importStrategyFull"
                                  : "money.importStrategyFast",
                              )}
                            </Button>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
                      <Button
                        className="h-11 gap-2 px-6 text-[15px] font-semibold"
                        onClick={handleStartExtensionImport}
                        disabled={
                          isStartingExtension ||
                          isLoadingExtensionImportContext ||
                          !extensionImportContext ||
                          !resolvedExtensionRange
                        }
                      >
                        {isStartingExtension ? t("common.loading") : t("money.importStartImport")}
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        {t("money.importStartHint", { bank: selectedBankLabel })}
                      </p>
                    </div>
                  </div>
                )}

                {extensionActive === false && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {!shouldUsePublishedExtensionFlow
                        ? t("money.importExtensionInstallDev")
                        : extensionBrowser === "firefox"
                          ? t("money.importExtensionInstallFirefox")
                          : t("money.importExtensionInstallProd")}
                    </p>
                    {shouldUsePublishedExtensionFlow && !extensionDownloadUrl && (
                      <p className="text-sm text-muted-foreground">
                        {t("money.importExtensionFirefoxUnavailable")}
                      </p>
                    )}
                    {shouldUsePublishedExtensionFlow && extensionDownloadUrl && (
                      <>
                        <Button variant="outline" size="sm" asChild>
                          <a href={extensionDownloadUrl}>
                            {t("money.importExtensionDownloadLatest")}
                          </a>
                        </Button>
                        {extensionBrowser === "firefox" ? (
                          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                            <li>{t("money.importExtensionInstallFirefoxStep1")}</li>
                            <li>{t("money.importExtensionInstallFirefoxStep2")}</li>
                          </ol>
                        ) : (
                          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                            <li>{t("money.importExtensionInstallProdStep1")}</li>
                            <li>{t("money.importExtensionInstallProdStep2")}</li>
                            <li>{t("money.importExtensionInstallProdStep3")}</li>
                            <li>{t("money.importExtensionInstallProdStep4")}</li>
                          </ol>
                        )}
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

                {extensionStatusMessage && extensionActive !== null && (
                  <p
                    role="status"
                    className={
                      extensionActive
                        ? "text-sm text-muted-foreground"
                        : "text-sm font-medium text-destructive"
                    }
                  >
                    {extensionStatusMessage}
                  </p>
                )}

                {extensionStatusMessage && extensionActive === false && (
                  <Button type="button" size="sm" onClick={() => reloadPage()}>
                    {t("money.importAttentionReload")}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4" data-testid="import-auto-panel">
          {extensionDevice ? (
            <>
              <MoneyImportAutoStatus
                t={t}
                state={extensionAutoStatus.state}
                status={extensionAutoStatus.status}
                selectedPersonId={selectedPersonId}
                sourceLabels={extensionSourceLabels}
                onRefresh={() => void refreshExtensionAutoStatus()}
                onScheduleChange={changeAutoSchedule}
              >
                <details className="group text-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium">
                    {t("money.importGrantsCollapsed")}
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="pt-2 [&>*]:border-0 [&>*]:shadow-none">
                    <MoneyImportGrants
                      t={t}
                      personId={selectedPersonId}
                      availableSources={extensionConnectorOptions}
                      onSendToExtension={sendGrantToExtensionAndRefresh}
                    />
                  </div>
                </details>
              </MoneyImportAutoStatus>
            </>
          ) : (
            <Card className="rounded-xl bg-muted/50 text-muted-foreground">
              <CardContent className="space-y-1 p-5">
                <p className="font-medium">{t("money.importAutoStatusTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("money.importAutoDesktopOnly")}</p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function connectorBankLabel(
  t: ReturnType<typeof useTranslations>,
  connector: MoneyImportConnector,
): string {
  const bank = importBankOfSource(connector.sourceId);
  return bank === "other" ? connector.displayName : t(BANK_KEYS[bank]);
}

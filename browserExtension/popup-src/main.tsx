import React from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";
import { Button } from "@shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/ui/card";
import { Label } from "@shared/ui/label";
import { Input } from "@shared/ui/input";
import { Textarea } from "@shared/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui/select";
import { formatSession, toIsoFromInput } from "./helpers";

function sendMessage(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Extension runtime messaging failed",
          diagnostics: {
            error_code: "RUNTIME_LAST_ERROR",
            transport: "runtime",
          },
        });
        return;
      }
      resolve(response);
    });
  });
}

interface DebugRunSummary {
  run?: {
    debug_run_id?: string;
    status?: string;
    started_at?: string;
    finished_at?: string | null;
    error_message?: string | null;
  };
  events?: Array<Record<string, unknown>>;
  event_count?: number;
}

function App() {
  const [sessionJson, setSessionJson] = React.useState("");
  const [sessionState, setSessionState] = React.useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = React.useState("");
  const [windowMode, setWindowMode] = React.useState<"auto" | "manual">("auto");
  const [manualFrom, setManualFrom] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [debugEnabled, setDebugEnabled] = React.useState(true);
  const [debugExporting, setDebugExporting] = React.useState(false);
  const [debugRunId, setDebugRunId] = React.useState<string | null>(null);
  const [debugRunStatus, setDebugRunStatus] = React.useState<string | null>(null);
  const [debugBundleJson, setDebugBundleJson] = React.useState("");

  const refreshDebugState = React.useCallback(async () => {
    const response = (await sendMessage({ type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" })) as {
      ok?: boolean;
      run?: DebugRunSummary | null;
    };
    const runContext = response?.run?.run;
    if (runContext && typeof runContext.debug_run_id === "string") {
      setDebugRunId(runContext.debug_run_id);
      setDebugRunStatus(typeof runContext.status === "string" ? runContext.status : null);
      return response.run ?? null;
    }
    setDebugRunId(null);
    setDebugRunStatus(null);
    return null;
  }, []);

  const refreshSession = React.useCallback(async () => {
    const response = (await sendMessage({ type: "MONEY_IMPORT_GET_SESSION" })) as {
      session?: Record<string, unknown>;
    };
    const s = response?.session ?? null;
    setSessionState(s);
    setSessionJson(formatSession(s));
    return s;
  }, []);

  const seedSessionFromLaunchUrl = React.useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("session_token");
    const sessionId = params.get("session_id");
    const batchId = params.get("batch_id");
    const source = params.get("source");
    const functionUrl = params.get("function_url");
    if (!token || !sessionId || !batchId || !source || !functionUrl) return;
    const session = {
      session_token: token,
      session_id: sessionId,
      batch_id: batchId,
      source,
      function_url: functionUrl,
      payer_person_id: params.get("payer_person_id"),
      expires_at: params.get("expires_at"),
      last_imported_at: params.get("last_imported_at") || null,
      window_from: params.get("window_from") || null,
      window_to: params.get("window_to") || null,
      parse_strategy: params.get("parse_strategy") || null,
      show_source_page_widget: params.get("show_source_page_widget") === "1",
      range_selection_meta: (() => {
        const raw = params.get("range_selection_meta");
        if (!raw) return null;
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return null;
        }
      })(),
      default_account_id: params.get("default_account_id") || null,
    };
    await sendMessage({ type: "MONEY_IMPORT_START_SESSION", session });
  }, []);

  React.useEffect(() => {
    void seedSessionFromLaunchUrl().then(async () => {
      await refreshSession();
      await refreshDebugState();
    });
  }, [seedSessionFromLaunchUrl, refreshSession, refreshDebugState]);

  React.useEffect(() => {
    const onRuntimeMessage = (
      message: Record<string, unknown> & { type?: string; phase?: string; debug_run_id?: string },
    ) => {
      if (message.type !== "MONEY_IMPORT_DEBUG_STATUS") return;
      if (typeof message.debug_run_id === "string") {
        setDebugRunId(message.debug_run_id);
      }
      if (message.phase === "started") setDebugRunStatus("running");
      if (message.phase === "completed") setDebugRunStatus("ok");
      if (message.phase === "failed") setDebugRunStatus("error");
    };

    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    };
  }, []);

  const onRefreshSession = async () => {
    await refreshSession();
    await refreshDebugState();
    setStatus("Session refreshed");
  };

  const onExportLatestDebugBundle = async () => {
    setDebugExporting(true);
    try {
      const response = (await sendMessage({ type: "MONEY_IMPORT_DEBUG_EXPORT_LAST_RUN" })) as {
        ok?: boolean;
        error?: string;
        bundle?: {
          exported_at: string;
          run: DebugRunSummary;
        };
      };
      let bundle = response?.bundle;
      if (!response?.ok || !bundle?.run?.run?.debug_run_id) {
        const shouldFallback =
          typeof response?.error === "string" &&
          response.error.toLowerCase().includes("unsupported message type");
        if (!shouldFallback) {
          throw new Error(response?.error || "No debug run available for export.");
        }

        const lastRunResponse = (await sendMessage({
          type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN",
        })) as {
          ok?: boolean;
          run?: DebugRunSummary | null;
          error?: string;
        };
        if (!lastRunResponse?.ok || !lastRunResponse.run?.run?.debug_run_id) {
          throw new Error(lastRunResponse?.error || "No debug run available for export.");
        }
        bundle = {
          exported_at: new Date().toISOString(),
          run: lastRunResponse.run,
        };
      }
      const runId = bundle?.run?.run?.debug_run_id;
      if (!runId) {
        throw new Error("No debug run available for export.");
      }
      const bundleJson = JSON.stringify(bundle, null, 2);
      setDebugBundleJson(bundleJson);
      const blob = new Blob([bundleJson], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `money-import-debug-${runId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`Debug bundle exported (${runId})`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to export debug bundle");
    } finally {
      setDebugExporting(false);
    }
  };

  const onStart = async () => {
    setRunning(true);
    setStatus("Starting import...");
    try {
      const s = await refreshSession();
      if (!s) {
        throw new Error("No active session. Start from web app first.");
      }
      const sessionWindowFrom =
        typeof s.window_from === "string" && s.window_from.trim() ? s.window_from : null;
      const hasResolvedSessionRange = Boolean(sessionWindowFrom);
      let windowFrom: string | null = null;
      if (!hasResolvedSessionRange && windowMode === "manual") {
        windowFrom = toIsoFromInput(manualFrom);
        if (!windowFrom) throw new Error("Manual start timestamp is invalid.");
      } else if (!hasResolvedSessionRange) {
        windowFrom =
          (s.last_imported_at as string) || new Date(Date.now() - 30 * 86400000).toISOString();
      }
      const response = (await sendMessage({
        type: "MONEY_IMPORT_RUN",
        windowFrom,
        debug: debugEnabled
          ? {
              enabled: true,
            }
          : undefined,
      })) as {
        ok?: boolean;
        error?: string;
        diagnostics?: Record<string, unknown> | null;
        debug_run_id?: string;
        result?: { batch_id?: string };
      };
      if (!response?.ok) {
        if (response.diagnostics && typeof response.diagnostics === "object") {
          setDebugBundleJson(
            JSON.stringify(
              {
                error: response.error ?? "Import run failed",
                diagnostics: response.diagnostics,
              },
              null,
              2,
            ),
          );
        }
        throw new Error(response?.error || "Import run failed");
      }
      if (typeof response.debug_run_id === "string") {
        setDebugRunId(response.debug_run_id);
      }
      await refreshDebugState();
      const runLabel = response.debug_run_id ? `\nRun: ${response.debug_run_id}` : "";
      setStatus(
        `Done. Batch: ${response.result?.batch_id ?? (s as { batch_id?: string }).batch_id}${runLabel}`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const isManual = windowMode === "manual";
  const hasResolvedSessionRange =
    typeof sessionState?.window_from === "string" && sessionState.window_from.trim().length > 0;

  return (
    <div className="min-w-[340px] p-3 space-y-3">
      <h1 className="text-base font-semibold leading-tight">Money Import</h1>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Active session</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          <Textarea
            id="sessionInfo"
            rows={5}
            readOnly
            value={sessionJson}
            className="font-mono text-xs resize-y"
          />
          <Button variant="secondary" onClick={onRefreshSession} className="w-full">
            Refresh session
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Import window</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {hasResolvedSessionRange ? (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
              {`Using session range:\nFrom: ${String(sessionState?.window_from ?? "-")}\nTo: ${String(sessionState?.window_to ?? "-")}`}
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="windowMode">Start date mode</Label>
                <Select
                  value={windowMode}
                  onValueChange={(v) => setWindowMode(v as "auto" | "manual")}
                >
                  <SelectTrigger id="windowMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (last imported)</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isManual && (
                <div className="space-y-2">
                  <Label htmlFor="manualFrom">Manual start timestamp</Label>
                  <Input
                    id="manualFrom"
                    type="datetime-local"
                    value={manualFrom}
                    onChange={(e) => setManualFrom(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          <Button onClick={onStart} disabled={running} className="w-full">
            Start processing
          </Button>
          {status ? (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{status}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Debug</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(event) => setDebugEnabled(event.target.checked)}
            />
            Enable debug run
          </label>
          <Button
            variant="secondary"
            onClick={onExportLatestDebugBundle}
            disabled={debugExporting}
            className="w-full"
          >
            Export latest debug bundle
          </Button>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
            Run ID: {debugRunId ?? "-"}
            {"\n"}
            Run status: {debugRunStatus ?? "-"}
          </p>
          {debugBundleJson ? (
            <Textarea
              rows={5}
              readOnly
              value={debugBundleJson}
              className="font-mono text-xs resize-y"
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

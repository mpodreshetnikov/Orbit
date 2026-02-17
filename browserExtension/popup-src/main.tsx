import React from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatSession(session: Record<string, unknown> | null): string {
  if (!session) return "No active session";
  return JSON.stringify(session, null, 2);
}

function toIsoFromInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sendMessage(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

function App() {
  const [session, setSession] = React.useState<Record<string, unknown> | null>(null);
  const [sessionJson, setSessionJson] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [windowMode, setWindowMode] = React.useState<"auto" | "manual">("auto");
  const [manualFrom, setManualFrom] = React.useState("");
  const [running, setRunning] = React.useState(false);

  const refreshSession = React.useCallback(async () => {
    const response = (await sendMessage({ type: "MONEY_IMPORT_GET_SESSION" })) as {
      session?: Record<string, unknown>;
    };
    const s = response?.session ?? null;
    setSession(s);
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
    };
    await sendMessage({ type: "MONEY_IMPORT_START_SESSION", session });
  }, []);

  React.useEffect(() => {
    seedSessionFromLaunchUrl().then(() => refreshSession());
  }, [seedSessionFromLaunchUrl, refreshSession]);

  const onRefreshSession = async () => {
    await refreshSession();
    setStatus("Session refreshed");
  };

  const onStart = async () => {
    setRunning(true);
    setStatus("Starting import...");
    try {
      const s = await refreshSession();
      if (!s) {
        throw new Error("No active session. Start from web app first.");
      }
      let windowFrom: string | null = null;
      if (windowMode === "manual") {
        windowFrom = toIsoFromInput(manualFrom);
        if (!windowFrom) throw new Error("Manual start timestamp is invalid.");
      } else {
        windowFrom =
          (s.last_imported_at as string) ||
          new Date(Date.now() - 30 * 86400000).toISOString();
      }
      const response = (await sendMessage({
        type: "MONEY_IMPORT_RUN",
        windowFrom,
      })) as { ok?: boolean; error?: string; result?: { batch_id?: string } };
      if (!response?.ok) {
        throw new Error(response?.error || "Import run failed");
      }
      setStatus(
        `Done. Batch: ${response.result?.batch_id ?? (s as { batch_id?: string }).batch_id}`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const isManual = windowMode === "manual";

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
          <Button onClick={onStart} disabled={running} className="w-full">
            Start processing
          </Button>
          {status ? (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{status}</p>
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
    </React.StrictMode>
  );
}

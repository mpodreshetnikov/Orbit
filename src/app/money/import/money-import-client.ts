"use client";

import { createClient } from "@/lib/supabase";
import { fetchEdgeFunctionWithTelemetry } from "@/lib/observability/edge-function-fetch";
import type { MoneyImportSessionStatus } from "@/types";

export function getFunctionUrl(functionName: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");
  return `${base}/functions/v1/${functionName}`;
}

export async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

export async function callMoneyImportAction<T>(
  action: Record<string, unknown>,
  accessToken: string,
): Promise<T> {
  const response = await fetchEdgeFunctionWithTelemetry(
    getFunctionUrl("money-import"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(action),
    },
    {
      component: "money-import-client",
      operation: "money-import-action",
      attrs: {
        action: typeof action.action === "string" ? action.action : "unknown",
      },
    },
  );

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Money import request failed"));
  }
  return payload as T;
}

export function computeProgressPercent(status: MoneyImportSessionStatus | null): number {
  if (!status?.batch) return 0;
  if (
    status.batch.status === "pending" ||
    status.batch.status === "completed" ||
    status.batch.status === "discarded"
  ) {
    return 100;
  }
  if (typeof status.batch.progress_percent === "number") {
    return Math.max(0, Math.min(100, status.batch.progress_percent));
  }

  const from = status.batch.window_from ? new Date(status.batch.window_from).getTime() : Number.NaN;
  const to = status.batch.window_to ? new Date(status.batch.window_to).getTime() : Number.NaN;
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

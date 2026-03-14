"use client";

import { fetchEdgeFunctionWithTelemetry } from "@/lib/observability/edge-function-fetch";
import { createClient } from "@/lib/supabase";

const MONEY_CATEGORIZE_TIMEOUT_MS = 20_000;

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

export async function callMoneyCategorizeAction<T>(action: Record<string, unknown>): Promise<T> {
  const accessToken = await getAccessToken();
  const abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort("money-categorize-timeout"),
    MONEY_CATEGORIZE_TIMEOUT_MS,
  );

  try {
    const response = await fetchEdgeFunctionWithTelemetry(
      getFunctionUrl("money-categorize"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(action),
        signal: abortController.signal,
      },
      {
        component: "money-category-rules",
        operation: "money-categorize-action",
        attrs: {
          action: typeof action.action === "string" ? action.action : "unknown",
        },
      },
    );

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(payload.error ?? "Money categorize request failed"));
    }
    return payload as T;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error("Money categorize request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export type EdgeLogLevel = "debug" | "info" | "warn" | "error";

export interface EdgeLogEvent {
  timestamp: string;
  level: EdgeLogLevel;
  message: string;
  app: "supabase-function";
  component: string;
  env: string;
  release: string;
  trace_id: string;
  request_id: string;
  span_id?: string;
  attrs?: Record<string, boolean | number | string | null>;
}

function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createEdgeLogEvent(
  level: EdgeLogLevel,
  message: string,
  options: {
    component: string;
    requestId?: string;
    traceId?: string;
    spanId?: string;
    attrs?: Record<string, boolean | number | string | null>;
  },
): EdgeLogEvent {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    app: "supabase-function",
    component: options.component,
    env: Deno.env.get("OBS_ENV") ?? "local",
    release: Deno.env.get("OBS_RELEASE") ?? "dev-local",
    trace_id: options.traceId ?? randomHex(16),
    span_id: options.spanId,
    request_id: options.requestId ?? `edge_${randomHex(8)}`,
    attrs: options.attrs,
  };
}

export function logEdgeEvent(event: EdgeLogEvent): void {
  const line = JSON.stringify({ telemetry: event });
  if (event.level === "error") {
    console.error(line);
    return;
  }
  if (event.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export type EdgeLogLevel = "debug" | "info" | "warn" | "error";
export type EdgeSpanKind = "internal" | "client" | "server";
export type EdgeSpanStatus = "ok" | "error";
export type EdgeAttrs = Record<string, boolean | number | string | null>;
const LOCAL_OTLP_DEFAULT_HTTP_ENDPOINT = "http://127.0.0.1:4318";

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
  attrs?: EdgeAttrs;
}

export interface EdgeSpanEvent {
  name: string;
  app: "supabase-function";
  component: string;
  env: string;
  release: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  request_id: string;
  start_time: string;
  end_time: string;
  kind: EdgeSpanKind;
  status: EdgeSpanStatus;
  status_message?: string;
  attrs?: EdgeAttrs;
}

export interface EdgeRequestContext {
  component: string;
  traceId: string;
  requestId: string;
  parentSpanId?: string;
  env: string;
  release: string;
}

export interface EdgeSpanHandle {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly requestId: string;
  readonly traceparent: string;
  log(level: EdgeLogLevel, message: string, attrs?: EdgeAttrs): void;
  end(options?: {
    status?: EdgeSpanStatus;
    statusMessage?: string;
    attrs?: EdgeAttrs;
  }): Promise<void>;
}

export interface EdgeTelemetry {
  readonly context: EdgeRequestContext;
  debug(message: string, attrs?: EdgeAttrs): void;
  info(message: string, attrs?: EdgeAttrs): void;
  warn(message: string, attrs?: EdgeAttrs): void;
  error(message: string, attrs?: EdgeAttrs): void;
  startSpan(name: string, options?: { kind?: EdgeSpanKind; attrs?: EdgeAttrs }): EdgeSpanHandle;
}

interface ParsedTraceparent {
  traceId: string;
  spanId: string;
}

function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseTraceparent(traceparent: string | null): ParsedTraceparent | null {
  if (!traceparent) return null;
  const match = traceparent.trim().match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/);
  if (!match) return null;
  return {
    traceId: match[1],
    spanId: match[2],
  };
}

function createTraceparent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }
  return headers;
}

function ensureLogsPath(endpoint: string): string {
  if (!endpoint) return endpoint;
  if (endpoint.endsWith("/v1/logs")) return endpoint;
  if (endpoint.endsWith("/")) return `${endpoint}v1/logs`;
  return `${endpoint}/v1/logs`;
}

function ensureTracesPath(endpoint: string): string {
  if (!endpoint) return endpoint;
  if (endpoint.endsWith("/v1/traces")) return endpoint;
  if (endpoint.endsWith("/")) return `${endpoint}v1/traces`;
  return `${endpoint}/v1/traces`;
}

function resolveMode(): "local" | "cloud" {
  return Deno.env.get("OBS_EXPORTER_MODE") === "cloud" ? "cloud" : "local";
}

function resolveOtlpHeaders(): Record<string, string> {
  const mode = resolveMode();
  const common = parseHeaders(Deno.env.get("OBS_OTLP_HEADERS"));
  if (mode === "cloud") {
    return {
      ...common,
      ...parseHeaders(Deno.env.get("OBS_GRAFANA_CLOUD_OTLP_HEADERS") ?? undefined),
    };
  }
  return common;
}

function resolveOtlpLogsEndpoint(): string {
  const mode = resolveMode();
  if (mode === "cloud") {
    const direct =
      Deno.env.get("OBS_OTLP_LOGS_ENDPOINT") ?? Deno.env.get("OBS_OTLP_ENDPOINT") ?? "";
    return ensureLogsPath(direct);
  }
  const direct =
    Deno.env.get("OBS_LOCAL_OTLP_HTTP_ENDPOINT") ??
    Deno.env.get("OBS_OTLP_ENDPOINT") ??
    LOCAL_OTLP_DEFAULT_HTTP_ENDPOINT;
  return ensureLogsPath(direct);
}

function resolveOtlpTracesEndpoint(): string {
  const mode = resolveMode();
  if (mode === "cloud") {
    const direct =
      Deno.env.get("OBS_OTLP_TRACES_ENDPOINT") ?? Deno.env.get("OBS_OTLP_ENDPOINT") ?? "";
    return ensureTracesPath(direct);
  }
  const direct =
    Deno.env.get("OBS_LOCAL_OTLP_HTTP_ENDPOINT") ??
    Deno.env.get("OBS_OTLP_ENDPOINT") ??
    LOCAL_OTLP_DEFAULT_HTTP_ENDPOINT;
  return ensureTracesPath(direct);
}

function toNanos(isoTimestamp: string): string {
  return `${Date.parse(isoTimestamp) * 1_000_000}`;
}

function toOtlpAttribute(
  key: string,
  value: boolean | number | string | null,
): { key: string; value: Record<string, boolean | number | string> } {
  if (value === null) {
    return { key, value: { stringValue: "null" } };
  }
  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }
  if (typeof value === "number") {
    return { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
}

async function forwardLogEventToOtlp(event: EdgeLogEvent): Promise<void> {
  const endpoint = resolveOtlpLogsEndpoint();
  if (!endpoint) return;

  const attributes = [
    toOtlpAttribute("app", event.app),
    toOtlpAttribute("component", event.component),
    toOtlpAttribute("env", event.env),
    toOtlpAttribute("release", event.release),
    toOtlpAttribute("request_id", event.request_id),
  ];

  if (event.attrs) {
    for (const [key, value] of Object.entries(event.attrs)) {
      attributes.push(toOtlpAttribute(`attrs.${key}`, value));
    }
  }

  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            toOtlpAttribute("service.name", "supabase-function"),
            toOtlpAttribute("deployment.environment", event.env),
            toOtlpAttribute("service.version", event.release),
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: "orbit.edge.observability",
              version: "0.1.0",
            },
            logRecords: [
              {
                timeUnixNano: toNanos(event.timestamp),
                severityNumber: event.level === "error" ? 17 : event.level === "warn" ? 13 : 9,
                severityText: event.level.toUpperCase(),
                body: { stringValue: event.message },
                traceId: event.trace_id,
                spanId: event.span_id,
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...resolveOtlpHeaders(),
    },
    body: JSON.stringify(payload),
  });
}

async function forwardSpanEventToOtlp(event: EdgeSpanEvent): Promise<void> {
  const endpoint = resolveOtlpTracesEndpoint();
  if (!endpoint) return;

  const attributes = [
    toOtlpAttribute("app", event.app),
    toOtlpAttribute("component", event.component),
    toOtlpAttribute("env", event.env),
    toOtlpAttribute("release", event.release),
    toOtlpAttribute("request_id", event.request_id),
  ];
  if (event.attrs) {
    for (const [key, value] of Object.entries(event.attrs)) {
      attributes.push(toOtlpAttribute(`attrs.${key}`, value));
    }
  }

  const kind = event.kind === "server" ? 2 : event.kind === "client" ? 3 : 1;
  const statusCode = event.status === "error" ? 2 : 1;

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            toOtlpAttribute("service.name", "supabase-function"),
            toOtlpAttribute("deployment.environment", event.env),
            toOtlpAttribute("service.version", event.release),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "orbit.edge.observability",
              version: "0.1.0",
            },
            spans: [
              {
                traceId: event.trace_id,
                spanId: event.span_id,
                parentSpanId: event.parent_span_id || undefined,
                name: event.name,
                kind,
                startTimeUnixNano: toNanos(event.start_time),
                endTimeUnixNano: toNanos(event.end_time),
                attributes,
                status: {
                  code: statusCode,
                  message: event.status_message || undefined,
                },
              },
            ],
          },
        ],
      },
    ],
  };

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...resolveOtlpHeaders(),
    },
    body: JSON.stringify(payload),
  });
}

export function createEdgeLogEvent(
  level: EdgeLogLevel,
  message: string,
  options: {
    component: string;
    requestId?: string;
    traceId?: string;
    spanId?: string;
    attrs?: EdgeAttrs;
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
  void forwardLogEventToOtlp(event).catch(() => {
    // Edge telemetry forwarding is best effort.
  });

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

export function createEdgeRequestContext(req: Request, component: string): EdgeRequestContext {
  const parsed = parseTraceparent(req.headers.get("traceparent"));
  return {
    component,
    traceId: parsed?.traceId ?? randomHex(16),
    requestId: req.headers.get("x-request-id") ?? `edge_${randomHex(8)}`,
    parentSpanId: parsed?.spanId,
    env: Deno.env.get("OBS_ENV") ?? "local",
    release: Deno.env.get("OBS_RELEASE") ?? "dev-local",
  };
}

export function buildEdgePropagationHeaders(
  context: EdgeRequestContext,
  spanId?: string,
): Record<string, string> {
  return {
    traceparent: createTraceparent(context.traceId, spanId ?? randomHex(8)),
    "x-request-id": context.requestId,
  };
}

export function createEdgeTelemetry(context: EdgeRequestContext): EdgeTelemetry {
  const emit = (level: EdgeLogLevel, message: string, attrs?: EdgeAttrs, spanId?: string) => {
    logEdgeEvent(
      createEdgeLogEvent(level, message, {
        component: context.component,
        requestId: context.requestId,
        traceId: context.traceId,
        spanId,
        attrs,
      }),
    );
  };

  const startSpan = (
    name: string,
    options?: { kind?: EdgeSpanKind; attrs?: EdgeAttrs },
  ): EdgeSpanHandle => {
    const spanId = randomHex(8);
    const startTime = new Date().toISOString();
    const kind = options?.kind ?? "internal";
    const staticAttrs = options?.attrs ?? {};

    return {
      traceId: context.traceId,
      spanId,
      parentSpanId: context.parentSpanId,
      requestId: context.requestId,
      traceparent: createTraceparent(context.traceId, spanId),
      log(level, message, attrs) {
        emit(level, message, attrs, spanId);
      },
      async end(endOptions) {
        const spanEvent: EdgeSpanEvent = {
          name,
          app: "supabase-function",
          component: context.component,
          env: context.env,
          release: context.release,
          trace_id: context.traceId,
          span_id: spanId,
          parent_span_id: context.parentSpanId,
          request_id: context.requestId,
          start_time: startTime,
          end_time: new Date().toISOString(),
          kind,
          status: endOptions?.status ?? "ok",
          status_message: endOptions?.statusMessage,
          attrs: {
            ...staticAttrs,
            ...(endOptions?.attrs ?? {}),
          },
        };

        await forwardSpanEventToOtlp(spanEvent).catch(() => {
          // Edge tracing forwarding is best effort.
        });
      },
    };
  };

  return {
    context,
    debug(message, attrs) {
      emit("debug", message, attrs);
    },
    info(message, attrs) {
      emit("info", message, attrs);
    },
    warn(message, attrs) {
      emit("warn", message, attrs);
    },
    error(message, attrs) {
      emit("error", message, attrs);
    },
    startSpan,
  };
}

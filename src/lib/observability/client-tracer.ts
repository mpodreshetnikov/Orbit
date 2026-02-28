import {
  createTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from "@shared/lib/observability/correlation";
import type {
  TelemetrySpanAttrs,
  TelemetrySpanEvent,
} from "@shared/lib/observability/trace-schema";

export interface StartClientSpanInput {
  name: string;
  component: string;
  app?: string;
  env?: string;
  release?: string;
  relayPath?: string;
  kind?: "internal" | "client" | "server";
  attrs?: TelemetrySpanAttrs;
  traceparent?: string | null;
  traceId?: string;
  parentSpanId?: string;
  requestId?: string;
}

export interface EndClientSpanInput {
  status?: "ok" | "error";
  statusMessage?: string;
  attrs?: TelemetrySpanAttrs;
}

export interface ActiveClientSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  requestId: string;
  traceparent: string;
  headers: Record<string, string>;
  end(options?: EndClientSpanInput): Promise<void>;
}

function getDefaultEnv(): string {
  if (process.env.NODE_ENV === "production") return "prod";
  if (process.env.NODE_ENV === "test") return "test";
  return "local";
}

async function postToTraceRelay(relayPath: string, events: TelemetrySpanEvent[]): Promise<void> {
  await fetch(relayPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
  });
}

export function startClientSpan(input: StartClientSpanInput): ActiveClientSpan {
  const relayPath = input.relayPath ?? "/api/observability/relay/traces";
  const parsedParent = parseTraceparent(input.traceparent);

  const traceId = input.traceId ?? parsedParent?.trace_id ?? generateTraceId();
  const spanId = generateSpanId();
  const parentSpanId = input.parentSpanId ?? parsedParent?.span_id ?? undefined;
  const requestId = input.requestId ?? generateRequestId();
  const traceparent = createTraceparent(traceId, spanId);
  const startTime = new Date().toISOString();
  const fixedAttrs = input.attrs ?? {};

  return {
    traceId,
    spanId,
    parentSpanId,
    requestId,
    traceparent,
    headers: {
      traceparent,
      "x-request-id": requestId,
    },
    async end(options?: EndClientSpanInput) {
      const event: TelemetrySpanEvent = {
        name: input.name,
        app: input.app ?? "web",
        component: input.component,
        env: input.env ?? getDefaultEnv(),
        release: input.release ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "dev-local",
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        request_id: requestId,
        start_time: startTime,
        end_time: new Date().toISOString(),
        kind: input.kind ?? "client",
        status: options?.status ?? "ok",
        status_message: options?.statusMessage,
        attrs: {
          ...fixedAttrs,
          ...(options?.attrs ?? {}),
        },
      };

      await postToTraceRelay(relayPath, [event]).catch(() => {
        // Client traces are best effort.
      });
    },
  };
}

export async function runWithClientSpan<T>(
  input: StartClientSpanInput,
  run: (span: ActiveClientSpan) => Promise<T>,
): Promise<T> {
  const span = startClientSpan(input);
  try {
    const result = await run(span);
    await span.end({ status: "ok" });
    return result;
  } catch (error) {
    await span.end({
      status: "error",
      statusMessage: error instanceof Error ? error.message : "Unknown client span error",
    });
    throw error;
  }
}

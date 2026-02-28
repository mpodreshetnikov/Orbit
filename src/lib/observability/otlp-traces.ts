import type { TelemetrySpanEvent } from "@shared/lib/observability/trace-schema";
import {
  resolveObservabilityIdentity,
  resolveOtlpHeaders,
  resolveOtlpTracesEndpoint,
} from "./config";

const KIND_TO_OTLP: Record<NonNullable<TelemetrySpanEvent["kind"]>, number> = {
  internal: 1,
  server: 2,
  client: 3,
};

const STATUS_TO_OTLP: Record<NonNullable<TelemetrySpanEvent["status"]>, number> = {
  ok: 1,
  error: 2,
};

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

function eventToOtlpSpan(event: TelemetrySpanEvent) {
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

  return {
    traceId: event.trace_id,
    spanId: event.span_id,
    parentSpanId: event.parent_span_id || undefined,
    name: event.name,
    kind: event.kind ? KIND_TO_OTLP[event.kind] : KIND_TO_OTLP.internal,
    startTimeUnixNano: toNanos(event.start_time),
    endTimeUnixNano: toNanos(event.end_time),
    attributes,
    status: event.status
      ? {
          code: STATUS_TO_OTLP[event.status],
          message: event.status_message || undefined,
        }
      : undefined,
  };
}

function buildPayload(events: TelemetrySpanEvent[]) {
  const identity = resolveObservabilityIdentity();

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            toOtlpAttribute("service.name", identity.app),
            toOtlpAttribute("deployment.environment", identity.env),
            toOtlpAttribute("service.version", identity.release),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "orbit.observability",
              version: "0.1.0",
            },
            spans: events.map((event) => eventToOtlpSpan(event)),
          },
        ],
      },
    ],
  };
}

export async function forwardTracesToOtlp(events: TelemetrySpanEvent[]): Promise<void> {
  const endpoint = resolveOtlpTracesEndpoint();
  if (!endpoint) {
    throw new Error("OBS OTLP traces endpoint is not configured.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...resolveOtlpHeaders(),
    },
    body: JSON.stringify(buildPayload(events)),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OTLP traces export failed (${response.status}): ${body.slice(0, 400)}`);
  }
}

import type { TelemetryLogEvent } from "@shared/lib/observability/schema";
import {
  resolveObservabilityIdentity,
  resolveOtlpHeaders,
  resolveOtlpLogsEndpoint,
} from "./config";

const LEVEL_TO_SEVERITY: Record<TelemetryLogEvent["level"], number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
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

function eventToOtlpLogRecord(event: TelemetryLogEvent) {
  const attributes = [
    toOtlpAttribute("app", event.app),
    toOtlpAttribute("component", event.component),
    toOtlpAttribute("env", event.env),
    toOtlpAttribute("release", event.release),
    toOtlpAttribute("request_id", event.request_id),
  ];

  if (event.session_id) {
    attributes.push(toOtlpAttribute("session_id", event.session_id));
  }
  if (event.user_id_hash) {
    attributes.push(toOtlpAttribute("user_id_hash", event.user_id_hash));
  }
  if (event.attrs) {
    for (const [key, value] of Object.entries(event.attrs)) {
      attributes.push(toOtlpAttribute(`attrs.${key}`, value));
    }
  }
  if (event.error) {
    attributes.push(toOtlpAttribute("error.name", event.error.name));
    attributes.push(toOtlpAttribute("error.message", event.error.message));
    if (event.error.code) {
      attributes.push(toOtlpAttribute("error.code", event.error.code));
    }
    if (event.error.cause) {
      attributes.push(toOtlpAttribute("error.cause", event.error.cause));
    }
  }

  return {
    timeUnixNano: toNanos(event.timestamp),
    severityNumber: LEVEL_TO_SEVERITY[event.level],
    severityText: event.level.toUpperCase(),
    body: { stringValue: event.message },
    traceId: event.trace_id,
    spanId: event.span_id,
    attributes,
  };
}

function buildPayload(events: TelemetryLogEvent[]) {
  const identity = resolveObservabilityIdentity();

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            toOtlpAttribute("service.name", identity.app),
            toOtlpAttribute("deployment.environment", identity.env),
            toOtlpAttribute("service.version", identity.release),
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: "orbit.observability",
              version: "0.1.0",
            },
            logRecords: events.map((event) => eventToOtlpLogRecord(event)),
          },
        ],
      },
    ],
  };
}

export async function forwardLogsToOtlp(events: TelemetryLogEvent[]): Promise<void> {
  const endpoint = resolveOtlpLogsEndpoint();
  if (!endpoint) {
    throw new Error("OBS OTLP logs endpoint is not configured.");
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
    throw new Error(`OTLP logs export failed (${response.status}): ${body.slice(0, 400)}`);
  }
}

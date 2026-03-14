import { NextResponse } from "next/server";
import { generateRequestId } from "@shared/lib/observability/correlation";
import { validateTelemetrySpanBatch } from "@shared/lib/observability/trace-schema";
import { forwardTracesToOtlp } from "@/lib/observability/otlp-traces";
import { createServerLogger } from "@/lib/observability/server-logger";

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_EVENT_COUNT = 100;
const FORBIDDEN_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /email/i,
  /phone/i,
];

function hasForbiddenField(value: unknown, path = ""): string | null {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = hasForbiddenField(value[index], `${path}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  for (const [key, nestedValue] of Object.entries(value)) {
    const joined = path ? `${path}.${key}` : key;
    if (FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      return joined;
    }
    const nested = hasForbiddenField(nestedValue, joined);
    if (nested) return nested;
  }

  return null;
}

function normalizePayload(body: unknown): unknown[] | null {
  if (Array.isArray(body)) {
    return body;
  }
  if (body && typeof body === "object") {
    const candidate = (body as { events?: unknown[]; event?: unknown }).events;
    if (Array.isArray(candidate)) {
      return candidate;
    }
    const single = (body as { event?: unknown }).event;
    if (single) {
      return [single];
    }
  }
  return null;
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? generateRequestId();
  const logger = createServerLogger({
    component: "observability-traces-relay",
    requestId,
  });

  const textBody = await request.text();
  if (textBody.length > MAX_PAYLOAD_BYTES) {
    logger.warn("observability_traces_relay_payload_too_large", {
      payload_bytes: textBody.length,
    });
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = textBody.length > 0 ? (JSON.parse(textBody) as unknown) : {};
  } catch {
    logger.warn("observability_traces_relay_invalid_json");
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const forbiddenPath = hasForbiddenField(parsedBody);
  if (forbiddenPath) {
    logger.warn("observability_traces_relay_forbidden_field", {
      forbidden_path: forbiddenPath,
    });
    return NextResponse.json(
      { error: `Payload contains forbidden field "${forbiddenPath}".` },
      { status: 400 },
    );
  }

  const rawEvents = normalizePayload(parsedBody);
  if (!rawEvents) {
    logger.warn("observability_traces_relay_invalid_shape");
    return NextResponse.json(
      {
        error:
          "Expected payload shape { events: TelemetrySpanEvent[] } or { event: TelemetrySpanEvent }.",
      },
      { status: 400 },
    );
  }

  if (rawEvents.length === 0 || rawEvents.length > MAX_EVENT_COUNT) {
    logger.warn("observability_traces_relay_invalid_batch_size", {
      batch_size: rawEvents.length,
    });
    return NextResponse.json(
      { error: `events length must be between 1 and ${MAX_EVENT_COUNT}.` },
      { status: 400 },
    );
  }

  const validation = validateTelemetrySpanBatch(rawEvents);
  if (!validation.ok) {
    logger.warn("observability_traces_relay_validation_failed", {
      error_count: validation.errors.length,
    });
    return NextResponse.json(
      { error: "Telemetry trace validation failed.", details: validation.errors },
      { status: 400 },
    );
  }

  try {
    await forwardTracesToOtlp(validation.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OTLP forwarding error";
    logger.warn("observability_traces_relay_otlp_forward_failed", {
      error_name: "OtlpTraceForwardError",
      error_message: message,
    });
    return NextResponse.json(
      {
        ok: false,
        degraded: true,
        accepted: validation.value.length,
      },
      { status: 202 },
    );
  }

  logger.info("observability_traces_relay_forwarded", {
    accepted: validation.value.length,
  });
  return NextResponse.json({ ok: true, accepted: validation.value.length });
}

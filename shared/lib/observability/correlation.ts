export interface TelemetryCorrelationContext {
  trace_id: string;
  span_id: string;
  request_id: string;
  session_id?: string;
}

function randomBytes(length: number): Uint8Array {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }

  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateTraceId(): string {
  return toHex(randomBytes(16));
}

export function generateSpanId(): string {
  return toHex(randomBytes(8));
}

export function generateRequestId(): string {
  return `req_${toHex(randomBytes(8))}`;
}

export function generateSessionId(): string {
  return `sess_${toHex(randomBytes(8))}`;
}

export function createTraceparent(traceId: string, spanId: string, sampled = true): string {
  const flags = sampled ? "01" : "00";
  return `00-${traceId}-${spanId}-${flags}`;
}

export function parseTraceparent(
  traceparent: string | null | undefined,
): Pick<TelemetryCorrelationContext, "trace_id" | "span_id"> | null {
  if (!traceparent) return null;

  const match = traceparent.trim().match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/);
  if (!match) return null;

  return { trace_id: match[1], span_id: match[2] };
}

export function buildCorrelationContext(params?: {
  trace_id?: string;
  span_id?: string;
  request_id?: string;
  session_id?: string;
  traceparent?: string | null;
}): TelemetryCorrelationContext {
  const parsed = parseTraceparent(params?.traceparent);

  const traceId = params?.trace_id ?? parsed?.trace_id ?? generateTraceId();
  const spanId = params?.span_id ?? parsed?.span_id ?? generateSpanId();
  const requestId = params?.request_id ?? generateRequestId();

  return {
    trace_id: traceId,
    span_id: spanId,
    request_id: requestId,
    session_id: params?.session_id,
  };
}

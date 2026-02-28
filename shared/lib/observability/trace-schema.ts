export type TelemetrySpanKind = "internal" | "client" | "server";
export type TelemetrySpanStatus = "ok" | "error";
export type TelemetrySpanAttrs = Record<string, boolean | number | string | null>;

export interface TelemetrySpanEvent {
  name: string;
  app: string;
  component: string;
  env: string;
  release: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  request_id: string;
  start_time: string;
  end_time: string;
  kind?: TelemetrySpanKind;
  status?: TelemetrySpanStatus;
  status_message?: string;
  attrs?: TelemetrySpanAttrs;
}

export interface TelemetrySpanValidationSuccess {
  ok: true;
  value: TelemetrySpanEvent;
}

export interface TelemetrySpanValidationError {
  ok: false;
  errors: string[];
}

export type TelemetrySpanValidationResult =
  | TelemetrySpanValidationSuccess
  | TelemetrySpanValidationError;

const HEX_16 = /^[a-f0-9]{16}$/;
const HEX_32 = /^[a-f0-9]{32}$/;
const HASH_SAFE = /^[a-zA-Z0-9._-]{1,128}$/;
const KINDS: TelemetrySpanKind[] = ["internal", "client", "server"];
const STATUS: TelemetrySpanStatus[] = ["ok", "error"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isAttrsRecord(value: unknown): value is TelemetrySpanAttrs {
  if (!isObject(value)) return false;
  return Object.values(value).every((entry) => {
    return (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    );
  });
}

function requiredString(
  target: Record<string, unknown>,
  field: string,
  errors: string[],
): string | null {
  const value = target[field];
  if (!isString(value) || value.trim().length === 0) {
    errors.push(`Field "${field}" must be a non-empty string.`);
    return null;
  }
  return value;
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function validateTelemetrySpanEvent(input: unknown): TelemetrySpanValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["Telemetry span payload must be an object."] };
  }

  const name = requiredString(input, "name", errors);
  const app = requiredString(input, "app", errors);
  const component = requiredString(input, "component", errors);
  const env = requiredString(input, "env", errors);
  const release = requiredString(input, "release", errors);
  const traceId = requiredString(input, "trace_id", errors);
  const spanId = requiredString(input, "span_id", errors);
  const requestId = requiredString(input, "request_id", errors);
  const startTime = requiredString(input, "start_time", errors);
  const endTime = requiredString(input, "end_time", errors);

  if (traceId && !HEX_32.test(traceId)) {
    errors.push('Field "trace_id" must be a 32-character lowercase hex string.');
  }
  if (spanId && !HEX_16.test(spanId)) {
    errors.push('Field "span_id" must be a 16-character lowercase hex string.');
  }
  if (requestId && !HASH_SAFE.test(requestId)) {
    errors.push('Field "request_id" must match [a-zA-Z0-9._-] and be <= 128 chars.');
  }
  if (startTime && !isIsoTimestamp(startTime)) {
    errors.push('Field "start_time" must be an ISO-8601 timestamp.');
  }
  if (endTime && !isIsoTimestamp(endTime)) {
    errors.push('Field "end_time" must be an ISO-8601 timestamp.');
  }
  if (startTime && endTime && isIsoTimestamp(startTime) && isIsoTimestamp(endTime)) {
    const startMs = Date.parse(startTime);
    const endMs = Date.parse(endTime);
    if (endMs < startMs) {
      errors.push('Field "end_time" must be greater than or equal to "start_time".');
    }
  }

  const parentSpanId = input.parent_span_id;
  if (parentSpanId !== undefined && (!isString(parentSpanId) || !HEX_16.test(parentSpanId))) {
    errors.push(
      'Field "parent_span_id" must be a 16-character lowercase hex string when provided.',
    );
  }

  const kind = input.kind;
  if (kind !== undefined && (!isString(kind) || !KINDS.includes(kind as TelemetrySpanKind))) {
    errors.push('Field "kind" must be one of: internal, client, server.');
  }

  const status = input.status;
  if (
    status !== undefined &&
    (!isString(status) || !STATUS.includes(status as TelemetrySpanStatus))
  ) {
    errors.push('Field "status" must be one of: ok, error.');
  }

  const statusMessage = input.status_message;
  if (statusMessage !== undefined && (!isString(statusMessage) || statusMessage.length > 512)) {
    errors.push('Field "status_message" must be a string <= 512 characters when provided.');
  }

  const attrs = input.attrs;
  if (attrs !== undefined && !isAttrsRecord(attrs)) {
    errors.push('Field "attrs" must be an object of string/number/boolean/null values.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: name as string,
      app: app as string,
      component: component as string,
      env: env as string,
      release: release as string,
      trace_id: traceId as string,
      span_id: spanId as string,
      parent_span_id: parentSpanId as string | undefined,
      request_id: requestId as string,
      start_time: startTime as string,
      end_time: endTime as string,
      kind: kind as TelemetrySpanKind | undefined,
      status: status as TelemetrySpanStatus | undefined,
      status_message: statusMessage as string | undefined,
      attrs: attrs as TelemetrySpanAttrs | undefined,
    },
  };
}

export function validateTelemetrySpanBatch(
  input: unknown,
): { ok: true; value: TelemetrySpanEvent[] } | TelemetrySpanValidationError {
  if (!Array.isArray(input)) {
    return { ok: false, errors: ["Batch payload must be an array."] };
  }

  const events: TelemetrySpanEvent[] = [];
  const errors: string[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const result = validateTelemetrySpanEvent(input[index]);
    if (!result.ok) {
      for (const error of result.errors) {
        errors.push(`events[${index}]: ${error}`);
      }
      continue;
    }
    events.push(result.value);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: events };
}

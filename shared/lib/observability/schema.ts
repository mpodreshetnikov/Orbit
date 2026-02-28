export type TelemetryLogLevel = "debug" | "info" | "warn" | "error";

export interface TelemetryLogError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: string;
}

export type TelemetryLogAttrs = Record<string, boolean | number | string | null>;

export interface TelemetryLogEvent {
  timestamp: string;
  level: TelemetryLogLevel;
  message: string;
  app: string;
  component: string;
  env: string;
  release: string;
  trace_id: string;
  request_id: string;
  span_id?: string;
  session_id?: string;
  user_id_hash?: string;
  error?: TelemetryLogError;
  attrs?: TelemetryLogAttrs;
}

export interface TelemetryValidationSuccess {
  ok: true;
  value: TelemetryLogEvent;
}

export interface TelemetryValidationError {
  ok: false;
  errors: string[];
}

export type TelemetryValidationResult = TelemetryValidationSuccess | TelemetryValidationError;

const LEVELS: TelemetryLogLevel[] = ["debug", "info", "warn", "error"];
const HEX_16 = /^[a-f0-9]{16}$/;
const HEX_32 = /^[a-f0-9]{32}$/;
const HASH_SAFE = /^[a-zA-Z0-9._-]{6,128}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isAttrsRecord(value: unknown): value is TelemetryLogAttrs {
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

function isTelemetryLogError(value: unknown): value is TelemetryLogError {
  if (!isObject(value)) return false;
  if (!isString(value.name) || !isString(value.message)) return false;
  if (value.stack !== undefined && !isString(value.stack)) return false;
  if (value.code !== undefined && !isString(value.code)) return false;
  if (value.cause !== undefined && !isString(value.cause)) return false;
  return true;
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

export function validateTelemetryLogEvent(input: unknown): TelemetryValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["Telemetry log payload must be an object."] };
  }

  const timestamp = requiredString(input, "timestamp", errors);
  const level = requiredString(input, "level", errors);
  const message = requiredString(input, "message", errors);
  const app = requiredString(input, "app", errors);
  const component = requiredString(input, "component", errors);
  const env = requiredString(input, "env", errors);
  const release = requiredString(input, "release", errors);
  const traceId = requiredString(input, "trace_id", errors);
  const requestId = requiredString(input, "request_id", errors);

  if (timestamp && !isIsoTimestamp(timestamp)) {
    errors.push('Field "timestamp" must be an ISO-8601 timestamp.');
  }

  if (level && !LEVELS.includes(level as TelemetryLogLevel)) {
    errors.push('Field "level" must be one of: debug, info, warn, error.');
  }

  if (traceId && !HEX_32.test(traceId)) {
    errors.push('Field "trace_id" must be a 32-character lowercase hex string.');
  }

  if (requestId && requestId.length > 128) {
    errors.push('Field "request_id" must be <= 128 characters.');
  }

  const spanId = input.span_id;
  if (spanId !== undefined && (!isString(spanId) || !HEX_16.test(spanId))) {
    errors.push('Field "span_id" must be a 16-character lowercase hex string when provided.');
  }

  const sessionId = input.session_id;
  if (sessionId !== undefined && (!isString(sessionId) || sessionId.length > 128)) {
    errors.push('Field "session_id" must be a string <= 128 characters when provided.');
  }

  const userIdHash = input.user_id_hash;
  if (userIdHash !== undefined && (!isString(userIdHash) || !HASH_SAFE.test(userIdHash))) {
    errors.push(
      'Field "user_id_hash" must be a hashed identifier using [a-zA-Z0-9._-], 6-128 chars.',
    );
  }

  const attrs = input.attrs;
  if (attrs !== undefined && !isAttrsRecord(attrs)) {
    errors.push('Field "attrs" must be an object of string/number/boolean/null values.');
  }

  const error = input.error;
  if (error !== undefined && !isTelemetryLogError(error)) {
    errors.push(
      'Field "error" must be an object with "name" and "message" strings (optional stack/code/cause).',
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      timestamp: timestamp as string,
      level: level as TelemetryLogLevel,
      message: message as string,
      app: app as string,
      component: component as string,
      env: env as string,
      release: release as string,
      trace_id: traceId as string,
      request_id: requestId as string,
      span_id: spanId as string | undefined,
      session_id: sessionId as string | undefined,
      user_id_hash: userIdHash as string | undefined,
      error: error as TelemetryLogError | undefined,
      attrs: attrs as TelemetryLogAttrs | undefined,
    },
  };
}

export function validateTelemetryLogBatch(
  input: unknown,
): { ok: true; value: TelemetryLogEvent[] } | TelemetryValidationError {
  if (!Array.isArray(input)) {
    return { ok: false, errors: ["Batch payload must be an array."] };
  }

  const events: TelemetryLogEvent[] = [];
  const errors: string[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const result = validateTelemetryLogEvent(input[index]);
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

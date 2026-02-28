import {
  buildCorrelationContext,
  createTraceparent,
  type TelemetryCorrelationContext,
} from "./correlation";
import type {
  TelemetryLogAttrs,
  TelemetryLogError,
  TelemetryLogEvent,
  TelemetryLogLevel,
} from "./schema";

export interface TelemetryLogDefaults {
  app: string;
  component: string;
  env: string;
  release: string;
  session_id?: string;
  user_id_hash?: string;
}

export interface BuildTelemetryEventInput {
  level: TelemetryLogLevel;
  message: string;
  attrs?: TelemetryLogAttrs;
  error?: TelemetryLogError;
  correlation?: Partial<TelemetryCorrelationContext> & { traceparent?: string | null };
}

export function buildTelemetryEvent(
  defaults: TelemetryLogDefaults,
  input: BuildTelemetryEventInput,
): TelemetryLogEvent {
  const correlation = buildCorrelationContext({
    trace_id: input.correlation?.trace_id,
    span_id: input.correlation?.span_id,
    request_id: input.correlation?.request_id,
    session_id: input.correlation?.session_id ?? defaults.session_id,
    traceparent: input.correlation?.traceparent,
  });

  return {
    timestamp: new Date().toISOString(),
    level: input.level,
    message: input.message,
    app: defaults.app,
    component: defaults.component,
    env: defaults.env,
    release: defaults.release,
    trace_id: correlation.trace_id,
    span_id: correlation.span_id,
    request_id: correlation.request_id,
    session_id: correlation.session_id,
    user_id_hash: defaults.user_id_hash,
    error: input.error,
    attrs: input.attrs,
  };
}

export function buildTraceparentFromEvent(event: TelemetryLogEvent): string {
  const spanId = event.span_id ?? "0000000000000000";
  return createTraceparent(event.trace_id, spanId, true);
}

export interface TelemetryLogger {
  debug(
    message: string,
    options?: { attrs?: TelemetryLogAttrs; correlation?: BuildTelemetryEventInput["correlation"] },
  ): TelemetryLogEvent;
  info(
    message: string,
    options?: { attrs?: TelemetryLogAttrs; correlation?: BuildTelemetryEventInput["correlation"] },
  ): TelemetryLogEvent;
  warn(
    message: string,
    options?: { attrs?: TelemetryLogAttrs; correlation?: BuildTelemetryEventInput["correlation"] },
  ): TelemetryLogEvent;
  error(
    message: string,
    options?: {
      attrs?: TelemetryLogAttrs;
      error?: TelemetryLogError;
      correlation?: BuildTelemetryEventInput["correlation"];
    },
  ): TelemetryLogEvent;
}

export function createTelemetryLogger(
  defaults: TelemetryLogDefaults,
  emitter: (event: TelemetryLogEvent) => void,
): TelemetryLogger {
  return {
    debug(message, options) {
      const event = buildTelemetryEvent(defaults, {
        level: "debug",
        message,
        attrs: options?.attrs,
        correlation: options?.correlation,
      });
      emitter(event);
      return event;
    },
    info(message, options) {
      const event = buildTelemetryEvent(defaults, {
        level: "info",
        message,
        attrs: options?.attrs,
        correlation: options?.correlation,
      });
      emitter(event);
      return event;
    },
    warn(message, options) {
      const event = buildTelemetryEvent(defaults, {
        level: "warn",
        message,
        attrs: options?.attrs,
        correlation: options?.correlation,
      });
      emitter(event);
      return event;
    },
    error(message, options) {
      const event = buildTelemetryEvent(defaults, {
        level: "error",
        message,
        attrs: options?.attrs,
        error: options?.error,
        correlation: options?.correlation,
      });
      emitter(event);
      return event;
    },
  };
}

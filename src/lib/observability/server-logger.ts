import { createTelemetryLogger, type TelemetryLogDefaults } from "@shared/lib/observability/logger";
import { generateRequestId } from "@shared/lib/observability/correlation";
import type { TelemetryLogError } from "@shared/lib/observability/schema";
import type { TelemetryLogEvent } from "@shared/lib/observability/schema";
import { forwardLogsToOtlp } from "./otlp-logs";
import { getActiveTraceContext } from "./server-otel";

export interface ServerLoggerOptions {
  app?: string;
  component: string;
  env?: string;
  release?: string;
  requestId?: string;
  sessionId?: string;
  userIdHash?: string;
}

function emitServerLog(event: TelemetryLogEvent): void {
  void forwardLogsToOtlp([event]).catch(() => {
    // Keep app logic resilient if telemetry backend is unavailable.
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

export function createServerLogger(options: ServerLoggerOptions) {
  const defaults: TelemetryLogDefaults = {
    app: options.app ?? "api",
    component: options.component,
    env:
      options.env ??
      process.env.OBS_ENV ??
      (process.env.NODE_ENV === "production" ? "prod" : "local"),
    release: options.release ?? process.env.OBS_RELEASE ?? "dev-local",
    session_id: options.sessionId,
    user_id_hash: options.userIdHash,
  };

  const logger = createTelemetryLogger(defaults, emitServerLog);
  const requestId = options.requestId ?? generateRequestId();

  return {
    debug(message: string, attrs?: Record<string, boolean | number | string | null>) {
      return logger.debug(message, {
        attrs,
        correlation: { request_id: requestId, ...getActiveTraceContext() },
      });
    },
    info(message: string, attrs?: Record<string, boolean | number | string | null>) {
      return logger.info(message, {
        attrs,
        correlation: { request_id: requestId, ...getActiveTraceContext() },
      });
    },
    warn(message: string, attrs?: Record<string, boolean | number | string | null>) {
      return logger.warn(message, {
        attrs,
        correlation: { request_id: requestId, ...getActiveTraceContext() },
      });
    },
    error(
      message: string,
      options?: {
        attrs?: Record<string, boolean | number | string | null>;
        error?: TelemetryLogError;
      },
    ) {
      return logger.error(message, {
        attrs: options?.attrs,
        error: options?.error,
        correlation: { request_id: requestId, ...getActiveTraceContext() },
      });
    },
    requestId,
  };
}

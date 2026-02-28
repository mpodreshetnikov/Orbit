import {
  buildCorrelationContext,
  createTraceparent,
  generateSessionId,
  type TelemetryCorrelationContext,
} from "@shared/lib/observability/correlation";
import { createTelemetryLogger } from "@shared/lib/observability/logger";
import type { TelemetryLogAttrs, TelemetryLogEvent } from "@shared/lib/observability/schema";

export interface ClientLoggerOptions {
  app?: string;
  component: string;
  env?: string;
  release?: string;
  relayPath?: string;
  sessionId?: string;
  userIdHash?: string;
}

export type ClientLogCorrelation =
  | (Partial<TelemetryCorrelationContext> & { traceparent?: string | null })
  | undefined;

async function postToRelay(relayPath: string, events: TelemetryLogEvent[]): Promise<void> {
  await fetch(relayPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
  });
}

function getDefaultEnv(): string {
  if (process.env.NODE_ENV === "production") return "prod";
  if (process.env.NODE_ENV === "test") return "test";
  return "local";
}

export function createClientTelemetryLogger(options: ClientLoggerOptions) {
  const relayPath = options.relayPath ?? "/api/observability/relay";
  const sessionId = options.sessionId ?? generateSessionId();

  const logger = createTelemetryLogger(
    {
      app: options.app ?? "web",
      component: options.component,
      env: options.env ?? getDefaultEnv(),
      release: options.release ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "dev-local",
      session_id: sessionId,
      user_id_hash: options.userIdHash,
    },
    (event) => {
      void postToRelay(relayPath, [event]);
    },
  );

  return {
    debug(message: string, attrs?: TelemetryLogAttrs, correlation?: ClientLogCorrelation) {
      return logger.debug(message, { attrs, correlation });
    },
    info(message: string, attrs?: TelemetryLogAttrs, correlation?: ClientLogCorrelation) {
      return logger.info(message, { attrs, correlation });
    },
    warn(message: string, attrs?: TelemetryLogAttrs, correlation?: ClientLogCorrelation) {
      return logger.warn(message, { attrs, correlation });
    },
    error(
      message: string,
      attrs?: TelemetryLogAttrs,
      error?: { name: string; message: string },
      correlation?: ClientLogCorrelation,
    ) {
      return logger.error(message, { attrs, error, correlation });
    },
    correlation() {
      const correlation = buildCorrelationContext({ session_id: sessionId });
      return {
        ...correlation,
        traceparent: createTraceparent(correlation.trace_id, correlation.span_id),
      };
    },
  };
}

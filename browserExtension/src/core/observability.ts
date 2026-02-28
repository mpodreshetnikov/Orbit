import { APP_ORIGINS } from "../env.js";

type TelemetryLevel = "debug" | "info" | "warn" | "error";

interface ExtensionTelemetryEvent {
  timestamp: string;
  level: TelemetryLevel;
  message: string;
  app: "extension";
  component: string;
  env: string;
  release: string;
  trace_id: string;
  span_id: string;
  request_id: string;
  attrs?: Record<string, boolean | number | string | null>;
}

function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function relay(event: ExtensionTelemetryEvent): Promise<void> {
  if (!Array.isArray(APP_ORIGINS) || APP_ORIGINS.length === 0) {
    return;
  }

  const target = `${APP_ORIGINS[0]}/api/observability/relay`;
  await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => {
    // Extension telemetry must never block runtime logic.
  });
}

export function createExtensionLogger(component: string) {
  const base = {
    app: "extension" as const,
    component,
    env: "local",
    release: "dev-local",
  };

  const emit = (level: TelemetryLevel, message: string, attrs?: Record<string, unknown>) => {
    const event: ExtensionTelemetryEvent = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...base,
      trace_id: randomHex(16),
      span_id: randomHex(8),
      request_id: `ext_${randomHex(8)}`,
      attrs: attrs as Record<string, boolean | number | string | null> | undefined,
    };
    void relay(event);
  };

  return {
    debug(message: string, attrs?: Record<string, unknown>) {
      emit("debug", message, attrs);
    },
    info(message: string, attrs?: Record<string, unknown>) {
      emit("info", message, attrs);
    },
    warn(message: string, attrs?: Record<string, unknown>) {
      emit("warn", message, attrs);
    },
    error(message: string, attrs?: Record<string, unknown>) {
      emit("error", message, attrs);
    },
  };
}

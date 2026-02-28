function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  const pairs = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const headers: Record<string, string> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }
  return headers;
}

function ensureLogsPath(endpoint: string): string {
  if (!endpoint) return endpoint;
  if (endpoint.endsWith("/v1/logs")) return endpoint;
  if (endpoint.endsWith("/")) return `${endpoint}v1/logs`;
  return `${endpoint}/v1/logs`;
}

function ensureTracesPath(endpoint: string): string {
  if (!endpoint) return endpoint;
  if (endpoint.endsWith("/v1/traces")) return endpoint;
  if (endpoint.endsWith("/")) return `${endpoint}v1/traces`;
  return `${endpoint}/v1/traces`;
}

function resolveMode(): "local" | "cloud" {
  return process.env.OBS_EXPORTER_MODE === "cloud" ? "cloud" : "local";
}

export function resolveOtlpLogsEndpoint(): string {
  const mode = resolveMode();

  if (mode === "cloud") {
    const direct = process.env.OBS_OTLP_LOGS_ENDPOINT || process.env.OBS_OTLP_ENDPOINT;
    return ensureLogsPath(direct || "");
  }

  const local = process.env.OBS_LOCAL_OTLP_HTTP_ENDPOINT || process.env.OBS_OTLP_ENDPOINT;
  return ensureLogsPath(local || "http://127.0.0.1:4318");
}

export function resolveOtlpTracesEndpoint(): string {
  const mode = resolveMode();

  if (mode === "cloud") {
    const direct = process.env.OBS_OTLP_TRACES_ENDPOINT || process.env.OBS_OTLP_ENDPOINT;
    return ensureTracesPath(direct || "");
  }

  const local = process.env.OBS_LOCAL_OTLP_HTTP_ENDPOINT || process.env.OBS_OTLP_ENDPOINT;
  return ensureTracesPath(local || "http://127.0.0.1:4318");
}

export function resolveOtlpHeaders(): Record<string, string> {
  const mode = resolveMode();
  const common = parseHeaders(process.env.OBS_OTLP_HEADERS);

  if (mode === "cloud") {
    return {
      ...common,
      ...parseHeaders(process.env.OBS_GRAFANA_CLOUD_OTLP_HEADERS),
    };
  }

  return common;
}

export function resolveObservabilityIdentity() {
  return {
    app: process.env.OBS_APP || "orbit",
    env: process.env.OBS_ENV || (process.env.NODE_ENV === "production" ? "prod" : "local"),
    release: process.env.OBS_RELEASE || "dev-local",
  };
}

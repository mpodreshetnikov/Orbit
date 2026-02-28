#!/usr/bin/env node

import { randomBytes } from "node:crypto";

function hex(bytes) {
  return randomBytes(bytes).toString("hex");
}

function parseHeaders(raw) {
  if (!raw) return {};

  const headers = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }
  return headers;
}

function withPath(base, suffix) {
  if (base.endsWith(suffix)) return base;
  if (base.endsWith("/")) return `${base}${suffix.replace(/^\//, "")}`;
  return `${base}${suffix}`;
}

function nowNanos() {
  return `${Date.now() * 1_000_000}`;
}

async function postJson(url, headers, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${url} -> ${response.status} ${text.slice(0, 400)}`);
  }
}

async function main() {
  const otlpBase =
    process.env.OBS_LOCAL_OTLP_HTTP_ENDPOINT ||
    process.env.OBS_OTLP_ENDPOINT ||
    "http://127.0.0.1:4318";
  const otlpHeaders = parseHeaders(process.env.OBS_OTLP_HEADERS || "");

  const traceId = hex(16);
  const spanId = hex(8);
  const now = nowNanos();
  const app = process.env.OBS_APP || "orbit";
  const env = process.env.OBS_ENV || "local";
  const release = process.env.OBS_RELEASE || "dev-local";

  const logPayload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: app } },
            { key: "deployment.environment", value: { stringValue: env } },
            { key: "service.version", value: { stringValue: release } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: "orbit.obs-smoke", version: "0.1.0" },
            logRecords: [
              {
                timeUnixNano: now,
                severityNumber: 9,
                severityText: "INFO",
                traceId,
                spanId,
                body: { stringValue: "obs-smoke-log" },
                attributes: [
                  { key: "app", value: { stringValue: "api" } },
                  { key: "component", value: { stringValue: "smoke-script" } },
                  { key: "request_id", value: { stringValue: `smoke_${hex(8)}` } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const tracePayload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: app } },
            { key: "deployment.environment", value: { stringValue: env } },
            { key: "service.version", value: { stringValue: release } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "orbit.obs-smoke", version: "0.1.0" },
            spans: [
              {
                traceId,
                spanId,
                name: "obs-smoke-trace",
                kind: 1,
                startTimeUnixNano: now,
                endTimeUnixNano: `${Number(now) + 5_000_000}`,
                status: { code: 1 },
                attributes: [{ key: "component", value: { stringValue: "smoke-script" } }],
              },
            ],
          },
        ],
      },
    ],
  };

  await postJson(withPath(otlpBase, "/v1/logs"), otlpHeaders, logPayload);
  await postJson(withPath(otlpBase, "/v1/traces"), otlpHeaders, tracePayload);

  console.log(
    JSON.stringify(
      {
        ok: true,
        otlp_base: otlpBase,
        trace_id: traceId,
        span_id: spanId,
        log_message: "obs-smoke-log",
        trace_name: "obs-smoke-trace",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[obs-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

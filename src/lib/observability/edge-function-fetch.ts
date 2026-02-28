import type { TelemetryLogAttrs } from "@shared/lib/observability/schema";
import { createClientTelemetryLogger } from "./client-logger";
import { startClientSpan } from "./client-tracer";

export interface EdgeFunctionFetchOptions {
  component: string;
  operation?: string;
  attrs?: TelemetryLogAttrs;
  traceparent?: string | null;
  requestId?: string;
}

function getFunctionName(url: string): string {
  const match = url.match(/\/functions\/v1\/([^/?#]+)/);
  return match?.[1] ?? "unknown";
}

function withTelemetryHeaders(
  originalHeaders: HeadersInit | undefined,
  injected: Record<string, string>,
): Headers {
  const headers = new Headers(originalHeaders);
  if (!headers.has("traceparent")) {
    headers.set("traceparent", injected.traceparent);
  }
  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", injected["x-request-id"]);
  }
  return headers;
}

export async function fetchEdgeFunctionWithTelemetry(
  url: string,
  init: RequestInit = {},
  options: EdgeFunctionFetchOptions,
): Promise<Response> {
  const functionName = getFunctionName(url);
  const operation = options.operation ?? functionName;
  const logger = createClientTelemetryLogger({
    app: "web",
    component: options.component,
  });

  const span = startClientSpan({
    name: `web.edge_function.${operation}`,
    component: options.component,
    kind: "client",
    attrs: {
      edge_function: functionName,
      operation,
      method: init.method ?? "POST",
      ...(options.attrs ?? {}),
    },
    traceparent: options.traceparent,
    requestId: options.requestId,
  });

  const correlation = {
    trace_id: span.traceId,
    span_id: span.spanId,
    request_id: span.requestId,
    traceparent: span.traceparent,
  };

  logger.info(
    "edge_function_request_started",
    {
      edge_function: functionName,
      operation,
      method: init.method ?? "POST",
      ...(options.attrs ?? {}),
    },
    correlation,
  );

  try {
    const headers = withTelemetryHeaders(init.headers, span.headers);
    const response = await fetch(url, {
      ...init,
      headers,
    });

    const statusAttrs = {
      edge_function: functionName,
      operation,
      status_code: response.status,
      ok: response.ok,
    };

    if (response.ok) {
      logger.info("edge_function_request_completed", statusAttrs, correlation);
      await span.end({ status: "ok", attrs: statusAttrs });
    } else {
      logger.warn("edge_function_request_failed", statusAttrs, correlation);
      await span.end({
        status: "error",
        statusMessage: `Edge function returned ${response.status}`,
        attrs: statusAttrs,
      });
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown edge function request error";
    logger.error(
      "edge_function_request_exception",
      {
        edge_function: functionName,
        operation,
      },
      {
        name: "EdgeFunctionRequestError",
        message,
      },
      correlation,
    );
    await span.end({
      status: "error",
      statusMessage: message,
      attrs: {
        edge_function: functionName,
        operation,
      },
    });
    throw error;
  }
}

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { createClientTelemetryLogger } from "@/lib/observability/client-logger";
import { startClientSpan } from "@/lib/observability/client-tracer";

function resolveRpcName(input: RequestInfo | URL): string | null {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);

  const match = url.match(/\/rest\/v1\/rpc\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function withRpcHeaders(
  input: RequestInfo | URL,
  init: RequestInit,
  injected: Record<string, string>,
) {
  const baseHeaders = init.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(baseHeaders);
  const existingTraceparent = headers.get("traceparent");
  const existingRequestId = headers.get("x-request-id");

  if (!existingTraceparent) {
    headers.set("traceparent", injected.traceparent);
  }
  if (!existingRequestId) {
    headers.set("x-request-id", injected["x-request-id"]);
  }
  return { headers, existingTraceparent, existingRequestId };
}

function createInstrumentedBrowserFetch(baseFetch: typeof fetch): typeof fetch {
  const telemetry = createClientTelemetryLogger({
    app: "web",
    component: "supabase-browser-client",
  });

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rpcName = resolveRpcName(input);
    if (!rpcName) {
      return baseFetch(input, init);
    }

    const preparedInit: RequestInit = init ?? {};
    const tempHeaders = new Headers(
      preparedInit.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const seedTraceparent = tempHeaders.get("traceparent");
    const seedRequestId = tempHeaders.get("x-request-id");

    const span = startClientSpan({
      name: `web.supabase.rpc.${rpcName}`,
      component: "supabase-browser-client",
      kind: "client",
      traceparent: seedTraceparent,
      requestId: seedRequestId ?? undefined,
      attrs: {
        rpc_name: rpcName,
      },
    });

    const correlation = {
      trace_id: span.traceId,
      span_id: span.spanId,
      request_id: span.requestId,
      traceparent: span.traceparent,
    };

    const { headers } = withRpcHeaders(input, preparedInit, span.headers);

    telemetry.info(
      "supabase_rpc_started",
      {
        rpc_name: rpcName,
        method: preparedInit.method ?? "POST",
      },
      correlation,
    );

    try {
      const response = await baseFetch(input, {
        ...preparedInit,
        headers,
      });

      const attrs = {
        rpc_name: rpcName,
        status_code: response.status,
        ok: response.ok,
      };

      if (response.ok) {
        telemetry.info("supabase_rpc_completed", attrs, correlation);
        await span.end({ status: "ok", attrs });
      } else {
        telemetry.warn("supabase_rpc_failed", attrs, correlation);
        await span.end({
          status: "error",
          statusMessage: `RPC returned ${response.status}`,
          attrs,
        });
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown RPC fetch error";
      telemetry.error(
        "supabase_rpc_exception",
        {
          rpc_name: rpcName,
        },
        {
          name: "SupabaseRpcFetchError",
          message,
        },
        correlation,
      );
      await span.end({
        status: "error",
        statusMessage: message,
        attrs: {
          rpc_name: rpcName,
        },
      });
      throw error;
    }
  };
}

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: createInstrumentedBrowserFetch(fetch),
      },
    },
  );
}

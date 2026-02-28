import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createTraceparent, generateRequestId } from "@shared/lib/observability/correlation";
import { createServerLogger } from "@/lib/observability/server-logger";
import { getActiveTraceContext, withServerSpan } from "@/lib/observability/server-otel";
import type { Database } from "@/types/database";

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

function createInstrumentedServerFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rpcName = resolveRpcName(input);
    if (!rpcName) {
      return baseFetch(input, init);
    }

    return withServerSpan(`api.supabase.rpc.${rpcName}`, async () => {
      const baseHeaders = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const requestId = baseHeaders.get("x-request-id") ?? generateRequestId();
      const traceContext = getActiveTraceContext();
      if (!baseHeaders.has("traceparent") && traceContext.trace_id && traceContext.span_id) {
        baseHeaders.set(
          "traceparent",
          createTraceparent(traceContext.trace_id, traceContext.span_id),
        );
      }
      if (!baseHeaders.has("x-request-id")) {
        baseHeaders.set("x-request-id", requestId);
      }

      const logger = createServerLogger({
        component: "supabase-server-client",
        requestId,
      });
      logger.info("server_supabase_rpc_started", {
        rpc_name: rpcName,
        method: init?.method ?? "POST",
      });

      try {
        const response = await baseFetch(input, {
          ...(init ?? {}),
          headers: baseHeaders,
        });

        const attrs = {
          rpc_name: rpcName,
          status_code: response.status,
          ok: response.ok,
        };
        if (response.ok) {
          logger.info("server_supabase_rpc_completed", attrs);
        } else {
          logger.warn("server_supabase_rpc_failed", attrs);
        }
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown RPC fetch error";
        logger.error("server_supabase_rpc_exception", {
          attrs: { rpc_name: rpcName },
          error: {
            name: "SupabaseServerRpcFetchError",
            message,
          },
        });
        throw error;
      }
    });
  };
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
      global: {
        fetch: createInstrumentedServerFetch(fetch),
      },
    },
  );
}

/**
 * Check if the current user is in the allowlist
 * Returns true if user is authenticated and allowed, false otherwise
 */
export async function isUserAllowed(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return false;
  }

  // Check if user is in allowlist (by auth_user_id OR email)
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

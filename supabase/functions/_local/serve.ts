/**
 * Serves this repository's edge functions on one origin, without the Supabase CLI.
 *
 * `supabase start` cannot run in an agent container: it seeds Realtime on first boot, that
 * seeding opens an IPv6 listener, and a kernel booted with `ipv6.disable=1` fails it with
 * `:eafnosupport`. `scripts/just/db-local-docker.cjs` worked around that for the database and
 * said in its own header what it was leaving out — "the API layer — PostgREST, Kong, the edge
 * runtime". This is the edge-runtime third of that, and `scripts/just/api-local-docker.cjs`
 * starts it beside the other two.
 *
 * Not a function: the directory starts with an underscore and holds no `index.ts`, so
 * `supabase functions deploy` passes it by, the same way it passes `_shared` by.
 *
 * Every function in this repository has the same shape — `index.ts` calls `Deno.serve` on a
 * `handleRequest` exported from `handler.ts`. That uniformity is what makes one router
 * possible, so it is checked rather than assumed: see
 * `scripts/local-api/function-uniformity.test.ts`.
 */

import { functionNameOf } from "../../../scripts/local-api/function-route.ts";

const PORT = Number(Deno.env.get("ORBIT_FUNCTIONS_PORT") ?? "54326");
const FUNCTIONS_ROOT = new URL("../", import.meta.url);

type Handler = (request: Request) => Response | Promise<Response>;

/** Resolved once per function and remembered, including the failure. */
const loaded = new Map<string, Handler | null>();

async function resolveHandler(name: string): Promise<Handler | null> {
  const cached = loaded.get(name);
  if (cached !== undefined) return cached;

  let handler: Handler | null = null;
  try {
    const module = await import(new URL(`${name}/handler.ts`, FUNCTIONS_ROOT).href);
    const candidate = (module as { handleRequest?: unknown }).handleRequest;
    handler = typeof candidate === "function" ? (candidate as Handler) : null;
  } catch (error) {
    // Reported rather than swallowed: a function that fails to import and a function that does
    // not exist are the same 404 to the caller, and they need different fixes.
    console.error(`[serve-functions] ${name} failed to import:`, error);
    handler = null;
  }
  loaded.set(name, handler);
  return handler;
}

export async function routeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok", loaded: [...loaded.keys()] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const name = functionNameOf(url.pathname);
  if (!name) return new Response("Not found", { status: 404 });

  const handler = await resolveHandler(name);
  if (!handler) return new Response(`No such function: ${name}`, { status: 404 });

  return await handler(request);
}

if (import.meta.main) {
  Deno.serve({ port: PORT, hostname: "127.0.0.1" }, routeRequest);
}

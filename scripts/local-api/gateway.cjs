#!/usr/bin/env node
/**
 * One origin in front of the three services the app and the edge functions expect.
 *
 * On the platform — and under `supabase start` — Kong is that origin: `SUPABASE_URL` is a
 * single host and the path decides which service answers. `@supabase/supabase-js` is built on
 * that assumption and cannot be pointed at PostgREST and GoTrue separately; a client handed
 * PostgREST's URL sends `auth.getUser` to `/auth/v1/user` on it, gets PostgREST's 404, and
 * reports an ordinary "Unauthorized" — which reads as a credentials problem for as long as you
 * let it.
 *
 * Kong's own image is on disk, but it needs a generated declarative config to do this much. So
 * the routing table is the whole file: what the path prefixes mean, and nothing else.
 */

const http = require("http");

function resolveRoutes(env = process.env) {
  return [
    { prefix: "/rest/v1", port: Number(env.ORBIT_REST_PORT ?? 54324), strip: true },
    { prefix: "/auth/v1", port: Number(env.ORBIT_AUTH_PORT ?? 54325), strip: true },
    // Not stripped: the functions server routes on `/functions/v1/<name>` exactly as the
    // platform does, so it has to see the prefix it was written against.
    {
      prefix: "/functions/v1",
      port: Number(env.ORBIT_FUNCTIONS_PORT ?? 54326),
      strip: false,
    },
    // Longest prefix first, so a shorter neighbour can never shadow a longer one.
  ].sort((left, right) => right.prefix.length - left.prefix.length);
}

function matchRoute(routes, pathname) {
  return routes.find(
    (route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`),
  );
}

function forwardedPathFor(route, url) {
  if (!route.strip) return `${url.pathname}${url.search}`;
  const remainder = url.pathname.slice(route.prefix.length);
  return `${remainder || "/"}${url.search}`;
}

function createGateway(options = {}) {
  const routes = options.routes ?? resolveRoutes(options.env);

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/gateway/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", routes: routes.map((route) => route.prefix) }));
      return;
    }

    const route = matchRoute(routes, url.pathname);
    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `No route for ${url.pathname}` }));
      return;
    }

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: route.port,
        method: req.method,
        path: forwardedPathFor(route, url),
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", (error) => {
      // The port is in the message on purpose: from the client's side a dead upstream and a
      // wrong route are the same 502, and telling them apart is most of debugging this lane.
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `${route.prefix} upstream (127.0.0.1:${route.port}): ${error.message}`,
        }),
      );
    });

    req.pipe(upstream);
  });
}

function main() {
  const port = Number(process.env.ORBIT_GATEWAY_PORT ?? 54321);
  const routes = resolveRoutes();
  createGateway({ routes }).listen(port, "127.0.0.1", () => {
    console.log(`[gateway] listening on http://127.0.0.1:${port}`);
    for (const route of routes) {
      console.log(`[gateway]   ${route.prefix} -> 127.0.0.1:${route.port}`);
    }
  });
}

if (require.main === module) main();

module.exports = { createGateway, resolveRoutes, matchRoute, forwardedPathFor };

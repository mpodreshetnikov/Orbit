/**
 * The origin the browser used to reach this server.
 *
 * Behind a proxy -- Vercel, or Caddy on a self-hosted server -- `request.url` reflects the
 * address the app listens on, not the public one: a self-hosted Next.js standalone server reports
 * `https://0.0.0.0:3000`. Where the public origin is known, `APP_PUBLIC_ORIGIN` says so and nothing
 * the request carries is consulted (a self-hosted server sets it from its domain). Otherwise the
 * proxy's forwarded headers are the source of truth -- trusted because the proxy in front sets
 * them, as Vercel does -- and `request.url` is the fallback when there is no proxy.
 */
export function getRequestOrigin(request: Pick<Request, "url"> & { headers?: Headers }): string {
  const configured = process.env.APP_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const headers = request.headers;
  const forwardedHost = headers?.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = webProtocol(headers?.get("x-forwarded-proto")?.split(",")[0]?.trim());
    return `${proto}://${forwardedHost.split(",")[0]?.trim()}`;
  }

  const forwarded = headers?.get("forwarded");
  if (forwarded) {
    const host = /host="?([^;,"]+)"?/i.exec(forwarded)?.[1];
    const proto = webProtocol(/proto="?([^;,"]+)"?/i.exec(forwarded)?.[1]);
    if (host) {
      return `${proto}://${host}`;
    }
  }

  return new URL(request.url).origin;
}

/** A forwarded protocol, as long as it is one a browser should be sent to; https otherwise. */
function webProtocol(value: string | undefined): "http" | "https" {
  return value?.toLowerCase() === "http" ? "http" : "https";
}

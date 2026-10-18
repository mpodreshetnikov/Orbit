/**
 * The origin the browser used to reach this server.
 *
 * Behind a proxy -- Vercel, or Caddy on a self-hosted server -- `request.url` reflects the
 * address the app listens on, not the public one: a self-hosted Next.js standalone server reports
 * `https://0.0.0.0:3000`. The proxy's forwarded headers are the source of truth; `request.url`
 * remains the fallback when there is no proxy.
 */
export function getRequestOrigin(request: Pick<Request, "url"> & { headers?: Headers }): string {
  const headers = request.headers;
  const forwardedHost = headers?.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost.split(",")[0]?.trim()}`;
  }

  const forwarded = headers?.get("forwarded");
  if (forwarded) {
    const host = /host="?([^;,"]+)"?/i.exec(forwarded)?.[1];
    const proto = /proto="?([^;,"]+)"?/i.exec(forwarded)?.[1] ?? "https";
    if (host) {
      return `${proto}://${host}`;
    }
  }

  return new URL(request.url).origin;
}

/**
 * How a request path names an edge function.
 *
 * Shared deliberately: the Deno server that answers these requests lives under
 * `supabase/functions/_local/`, where the rest of the Deno code lives and where `tsc` does not
 * look, and this half has to be reachable from the Node test suite. Keeping the parsing here
 * means the rule that decides what `import()` is handed is covered by tests rather than
 * living only inside a file nothing but Deno ever loads.
 */

/**
 * A function name, and nothing else. The name comes off the request path, so anything that is
 * not a plain slug — a traversal, an absolute URL, a scheme, an empty segment — must never
 * reach `import()`.
 */
export const FUNCTION_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function isFunctionName(value: string): boolean {
  return FUNCTION_NAME.test(value);
}

/**
 * `/functions/v1/<name>/…` the way the platform routes it, and `/<name>/…` for a client
 * pointed straight at this server. Returns null when the path names nothing that could be a
 * function, so the caller answers 404 rather than reaching for a module.
 */
export function functionNameOf(pathname: string): string | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const candidate = segments[0] === "functions" && segments[1] === "v1" ? segments[2] : segments[0];
  if (!candidate) return null;
  return isFunctionName(candidate) ? candidate : null;
}

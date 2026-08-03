/**
 * Local type declaration for the `web-push` import in `handler.ts`.
 *
 * esm.sh advertises types for this module through an `X-TypeScript-Types`
 * header pointing at `@types/web-push`. That resolution is neither
 * version-pinned in `deno.json` nor content-pinned in `deno.lock` — the
 * lockfile records only a redirect for the `.d.ts`, not its hash — so the
 * served declarations can drift underneath a previously green build. They did:
 * `@types/web-push@3.6.4` stopped exposing a default export, breaking
 * `deno check` with TS1192 on a file nobody had touched.
 *
 * Referencing this file with `@ts-types` pins the type side. The runtime
 * specifier is unchanged, so the module Deno actually loads — and the frozen
 * lockfile — are untouched.
 *
 * The value is deliberately `unknown`: `handler.ts` narrows it through its own
 * `WebPushClientLike` interface, which stays the single source of truth for the
 * subset of the API this function calls.
 */
declare const webpush: unknown;
export default webpush;

/**
 * Local type declaration for the `web-push` import in `handler.ts`.
 *
 * `web-push` ships no types of its own, so Deno would otherwise resolve
 * `@types/web-push` implicitly. That package has already broken this build
 * once: `@types/web-push@3.6.4` stopped exposing a default export and
 * `deno check` failed with TS1192 on a file nobody had touched.
 *
 * Referencing this file with `@ts-types` pins the type side and keeps
 * `@types/*` out of the dependency graph entirely. The runtime specifier is
 * unchanged, so the module Deno actually loads — and the frozen lockfile — are
 * untouched.
 *
 * The value is deliberately `unknown`: `handler.ts` narrows it through its own
 * `WebPushClientLike` interface, which stays the single source of truth for the
 * subset of the API this function calls.
 */
declare const webpush: unknown;
export default webpush;

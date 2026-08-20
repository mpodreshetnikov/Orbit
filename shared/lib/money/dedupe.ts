/**
 * App-facing entry point for the canonical money dedupe hash.
 *
 * The implementation lives in `browserExtension/src/core/money-dedupe.ts` and not here, which looks
 * backwards until you look at how the extension is built: `browserExtension/src` is compiled by
 * plain `tsc` (`browserExtension/tsconfig.json`, `rootDir: "src"`) with no bundler, and the emitted
 * modules are loaded by Chrome as ES modules with the specifiers written verbatim. A bare
 * `@shared/...` import therefore fails twice — the extension's tsc has no such path mapping, and
 * even with one the emitted file would carry a specifier the browser cannot resolve. Only
 * `browserExtension/popup-src` can use `@shared`, because Vite bundles it.
 *
 * So the file has to sit under `browserExtension/src` to reach the extension at all, and the web app
 * reaches it through this re-export. One implementation, which is the whole point: the app and the
 * extension must agree on the hash or the same purchase is imported twice.
 */
export type { MoneyDedupeInput } from "../../../browserExtension/src/core/money-dedupe";
export {
  applyMoneyDedupeHashes,
  assignMoneyDedupeOccurrences,
  buildMoneyDedupeHash,
  buildMoneyDedupePayload,
} from "../../../browserExtension/src/core/money-dedupe";

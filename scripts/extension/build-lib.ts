import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_DEV_APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

export function parseArgs(argv: string[]): { mode: string; watch: boolean } {
  const args = new Set(argv.slice(2));
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "development";
  const watch = args.has("--watch");
  return { mode, watch };
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export function toCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function originToPattern(origin: string): string {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.host}/*`;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function parseDotEnv(filePath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!(await fileExists(filePath))) return result;
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

export function resolveAppOrigins(env: Record<string, string | undefined>, mode: string): string[] {
  const raw = env.NEXT_PUBLIC_APP_ORIGINS || env.NEXT_PUBLIC_APP_ORIGIN;

  if (!raw) {
    console.warn(
      `[extension:${mode}] NEXT_PUBLIC_APP_ORIGIN(S) not set. Using localhost defaults.`,
    );
    return DEFAULT_DEV_APP_ORIGINS;
  }

  const parsed = toCsvList(raw).map(normalizeOrigin).filter(Boolean);
  if (parsed.length === 0) {
    throw new Error("NEXT_PUBLIC_APP_ORIGIN has no valid values");
  }
  return unique(parsed);
}

export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function shouldIgnoreWatchEvent(filename: string | null): boolean {
  if (!filename) return true;
  const normalized = toPosix(filename);
  return (
    normalized === "dist" ||
    normalized.startsWith("dist/") ||
    normalized === "dist-firefox" ||
    normalized.startsWith("dist-firefox/") ||
    normalized === "src" ||
    normalized.startsWith("src/")
  );
}

/**
 * The add-on id Firefox stores the extension's data under and AMO signs it as. It is fixed for the
 * life of the add-on: a new id is a new add-on, with empty storage and no update path from the old.
 */
export const DEFAULT_GECKO_ID = "orbit@privateorbit.space";

/**
 * Firefox's oldest version the Firefox build is checked against. 127 is the hard floor: before it,
 * Manifest V3 host permissions were not granted at install and the user had to switch each site on
 * in about:addons, so neither the bank pages nor the app would see the extension. 128 is the ESR
 * line that follows it.
 */
export const GECKO_STRICT_MIN_VERSION = "128.0";

/**
 * A match pattern Firefox will honour. Firefox's patterns have no port: one that names a port
 * matches nothing, so the content script never reached `http://localhost:3000` and the tab was
 * reported as "Missing host permission" while `permissions.getAll()` listed it (Firefox 158,
 * 2026-10-21). Without the port the pattern matches every port of that host.
 */
export function toFirefoxMatchPattern(pattern: string): string {
  return pattern.replace(/^([a-z*]+:\/\/[^/:]+):\d+(\/)/, "$1$2");
}

/**
 * Permissions only the Chrome build uses. `nativeMessaging` belongs to the Chrome self-updater,
 * which a signed Firefox add-on does not need: Firefox updates it from `update_url`.
 */
export const CHROME_ONLY_PERMISSIONS = ["nativeMessaging"];

/** Files of the Chrome dist that stay out of the Firefox package, for the same reason. */
export const CHROME_ONLY_DIST_ENTRIES = ["updater"];

/**
 * The Chrome manifest rewritten for Firefox. Firefox's Manifest V3 does not run a background
 * service worker, so the same `background.js` runs as an event page through `background.scripts`.
 * `key` is Chrome's way to pin the extension id and means nothing to Firefox, whose id is
 * `browser_specific_settings.gecko.id`. `update_url` is where a signed install asks for new
 * versions; without it Firefox never updates a self-distributed add-on.
 */
export function toFirefoxManifest(
  manifest: Record<string, unknown>,
  options: { geckoId: string; updateUrl?: string },
): Record<string, unknown> {
  const {
    key: _key,
    background,
    host_permissions,
    content_scripts,
    permissions,
    ...rest
  } = manifest;
  const chromeBackground = (background ?? {}) as Record<string, unknown>;
  const script = chromeBackground.service_worker;
  if (typeof script !== "string" || !script) {
    throw new Error("The Chrome manifest has no background.service_worker to run in Firefox.");
  }

  const gecko: Record<string, unknown> = {
    id: options.geckoId,
    strict_min_version: GECKO_STRICT_MIN_VERSION,
    // AMO requires the declaration on every new add-on, and Firefox shows it at install. The
    // extension reads the bank's pages and sends the operations it finds to the user's Orbit.
    data_collection_permissions: { required: ["financialAndPaymentInfo", "websiteContent"] },
  };
  if (options.updateUrl) gecko.update_url = options.updateUrl;

  const patterns = (values: unknown) =>
    unique(((values as string[] | undefined) ?? []).map(toFirefoxMatchPattern));

  return {
    ...rest,
    ...(permissions
      ? {
          permissions: (permissions as string[]).filter(
            (permission) => !CHROME_ONLY_PERMISSIONS.includes(permission),
          ),
        }
      : {}),
    host_permissions: patterns(host_permissions),
    content_scripts: ((content_scripts as Record<string, unknown>[] | undefined) ?? []).map(
      (entry) => ({ ...entry, matches: patterns(entry.matches) }),
    ),
    background: {
      scripts: [script],
      ...(chromeBackground.type ? { type: chromeBackground.type } : {}),
    },
    browser_specific_settings: { gecko },
  };
}

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
    normalized === "src" ||
    normalized.startsWith("src/")
  );
}

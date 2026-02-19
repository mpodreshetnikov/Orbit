#!/usr/bin/env node

import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(rootDir, "browserExtension");
const distDir = path.join(extensionDir, "dist");
const manifestPath = path.join(extensionDir, "manifest.json");
const localEnvPath = path.join(rootDir, ".env.local");

const stableExtensionKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz84ynCFIwpvsQIcklAzf+8sVWXeZZocN8LTt6iEmtA8ZwHV0klI115PyOy4LlaEFEIp7YpwrfT5MaU+m9rbuCnhmOsK46omDGqM2eUnP4v3YGU3pMmyGcXvU6FGAIlelUlzkqKl5OzCnLdZKpJnVZSG2dcfCRINyp9MMI3209vgrqeqpmnCEMbr8JpMZ/+aAQLlMfOIIyYMcdP9Kr2DKbAZrm41lepCJOYdSGfy+HpO9Q1UB+XhSOq386hyhkK5LC3cfTGjlNApTHr3fzrMS/s04R/ACAR1BElRu8e32J2nOOtGm0LVW0XD9o53p1bok6nMtLawS4FUmWOPU7MdgrwIDAQAB";

const defaultDevAppOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

const EXTENSION_ALLOWED_HOST_PATTERNS = [
  "https://www.tbank.ru/*",
  "https://*.tbank.ru/*",
];

function parseArgs(argv: string[]): { mode: string; watch: boolean } {
  const args = new Set(argv.slice(2));
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "development";
  const watch = args.has("--watch");
  return { mode, watch };
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function toCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function originToPattern(origin: string): string {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.host}/*`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function parseDotEnv(filePath: string): Promise<Record<string, string>> {
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

async function resolveBuildEnv(mode: string): Promise<Record<string, string | undefined>> {
  if (mode === "development") {
    const localEnv = await parseDotEnv(localEnvPath);
    return { ...process.env, ...localEnv };
  }
  return { ...process.env };
}

function resolveAppOrigins(env: Record<string, string | undefined>, mode: string): string[] {
  const raw = env.NEXT_PUBLIC_APP_ORIGINS || env.NEXT_PUBLIC_APP_ORIGIN;

  if (!raw) {
    console.warn(
      `[extension:${mode}] NEXT_PUBLIC_APP_ORIGIN(S) not set. Using localhost defaults.`
    );
    return defaultDevAppOrigins;
  }

  const parsed = toCsvList(raw).map(normalizeOrigin).filter(Boolean);
  if (parsed.length === 0) {
    throw new Error("NEXT_PUBLIC_APP_ORIGIN has no valid values");
  }
  return unique(parsed);
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

/** Copy only static assets into dist (no generated .js/.css). */
async function copyStaticToDist(): Promise<void> {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.cp(path.join(extensionDir, "manifest.json"), path.join(distDir, "manifest.json"));
  await fs.cp(path.join(extensionDir, "popup.html"), path.join(distDir, "popup.html"));
  await fs.cp(path.join(extensionDir, "icons"), path.join(distDir, "icons"), { recursive: true });
  const swPath = path.join(extensionDir, "sw.js");
  if (await fileExists(swPath)) {
    await fs.cp(swPath, path.join(distDir, "sw.js"));
  }
}

function runTscExtension(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tscPath = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
    const child = spawn(process.execPath, [tscPath, "-p", path.join(extensionDir, "tsconfig.json")], {
      cwd: rootDir,
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tsc exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function runViteBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
    const child = spawn(
      process.execPath,
      [viteBin, "build", "--config", "vite.config.extension.ts"],
      { cwd: rootDir, stdio: "inherit" }
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Vite build exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function build(mode: string): Promise<void> {
  const env = await resolveBuildEnv(mode);
  const appOrigins = resolveAppOrigins(env, mode);
  const appPatterns = appOrigins.map(originToPattern);

  const manifest: Record<string, unknown> = JSON.parse(
    await fs.readFile(manifestPath, "utf8")
  );
  manifest.key = (env.EXTENSION_KEY || stableExtensionKey).trim();
  manifest.host_permissions = unique([
    ...appPatterns,
    ...EXTENSION_ALLOWED_HOST_PATTERNS,
  ]);
  manifest.content_scripts = (manifest.content_scripts as unknown[] || []).map((entry: unknown) => ({
    ...(entry as Record<string, unknown>),
    matches: appPatterns,
  }));

  if (env.EXTENSION_NAME) {
    manifest.name = env.EXTENSION_NAME;
  }
  if (env.EXTENSION_VERSION) {
    manifest.version = env.EXTENSION_VERSION;
  }

  await copyStaticToDist();
  await runTscExtension();
  await runViteBuild();

  const envJs = [
    `export const BUILD_MODE = ${JSON.stringify(mode)};`,
    `export const DEV_HOT_RELOAD = ${mode === "development"};`,
    `export const APP_ORIGINS = ${JSON.stringify(appOrigins)};`,
    `export const APP_ORIGIN_PATTERNS = ${JSON.stringify(appPatterns)};`,
    "",
  ].join("\n");

  await fs.writeFile(
    path.join(distDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(distDir, "env.js"), envJs, "utf8");
  await fs.writeFile(
    path.join(distDir, "reload-trigger.json"),
    `${JSON.stringify({ buildId: new Date().toISOString(), mode }, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `[extension:${mode}] built -> browserExtension/dist (origins: ${appOrigins.join(", ")})`
  );
}

function shouldIgnoreWatchEvent(filename: string | null): boolean {
  if (!filename) return true;
  const normalized = toPosix(filename);
  return (
    normalized === "dist" ||
    normalized.startsWith("dist/") ||
    normalized === "src" ||
    normalized.startsWith("src/")
  );
}

async function startWatch(mode: string): Promise<never> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let building = false;

  const scheduleBuild = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(async () => {
      timeoutId = null;
      if (building) return;
      building = true;
      try {
        await build(mode);
      } catch (error) {
        console.error(
          `[extension:${mode}] rebuild failed:`,
          error instanceof Error ? error.message : error
        );
      } finally {
        building = false;
      }
    }, 120);
  };

  const extensionWatcher = fsWatch(
    extensionDir,
    { recursive: true },
    (_event, filename) => {
      if (shouldIgnoreWatchEvent(filename ?? null)) return;
      scheduleBuild();
    }
  );

  let envWatcher: ReturnType<typeof fsWatch> | null = null;
  if (mode === "development" && (await fileExists(localEnvPath))) {
    envWatcher = fsWatch(localEnvPath, () => scheduleBuild());
  }

  console.log("[extension:development] watching extension sources for changes...");

  const cleanup = () => {
    extensionWatcher.close();
    if (envWatcher) envWatcher.close();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  return new Promise(() => {});
}

async function main(): Promise<void> {
  const { mode, watch } = parseArgs(process.argv);
  if (!["development", "production"].includes(mode)) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  await build(mode);

  if (watch) {
    await startWatch(mode);
  }
}

main().catch((error) => {
  console.error(
    "[extension] build failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});

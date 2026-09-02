#!/usr/bin/env node

import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  fileExists,
  originToPattern,
  parseArgs,
  parseDotEnv,
  resolveAppOrigins,
  shouldIgnoreWatchEvent,
  unique,
} from "./build-lib";
import { listMoneyImportSourceDefinitions } from "./money-import-sources";
import { buildClassicScriptBundles } from "./esbuild-widget";
import { formatClassicScriptProblems, verifyClassicScripts } from "./verify-classic-scripts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(rootDir, "browserExtension");
const distDir = path.join(extensionDir, "dist");
const manifestPath = path.join(extensionDir, "manifest.json");
const localEnvPath = path.join(rootDir, ".env.local");

const stableExtensionKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz84ynCFIwpvsQIcklAzf+8sVWXeZZocN8LTt6iEmtA8ZwHV0klI115PyOy4LlaEFEIp7YpwrfT5MaU+m9rbuCnhmOsK46omDGqM2eUnP4v3YGU3pMmyGcXvU6FGAIlelUlzkqKl5OzCnLdZKpJnVZSG2dcfCRINyp9MMI3209vgrqeqpmnCEMbr8JpMZ/+aAQLlMfOIIyYMcdP9Kr2DKbAZrm41lepCJOYdSGfy+HpO9Q1UB+XhSOq386hyhkK5LC3cfTGjlNApTHr3fzrMS/s04R/ACAR1BElRu8e32J2nOOtGm0LVW0XD9o53p1bok6nMtLawS4FUmWOPU7MdgrwIDAQAB";

const EXTENSION_ALLOWED_HOST_PATTERNS = listMoneyImportSourceDefinitions().flatMap(
  (source) => source.tabUrlPatterns,
);

function resolveSupabaseHostPattern(
  env: Record<string, string | undefined>,
  mode: string,
): string[] {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    console.warn(
      `[extension:${mode}] NEXT_PUBLIC_SUPABASE_URL is not set; extension edge calls may fail without host permission.`,
    );
    return [];
  }

  try {
    const parsed = new URL(supabaseUrl);
    return [`${parsed.protocol}//${parsed.host}/*`];
  } catch {
    console.warn(
      `[extension:${mode}] NEXT_PUBLIC_SUPABASE_URL is invalid (${supabaseUrl}); skipping host permission.`,
    );
    return [];
  }
}

async function resolveBuildEnv(): Promise<Record<string, string | undefined>> {
  const localEnv = await parseDotEnv(localEnvPath);
  return { ...process.env, ...localEnv };
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
    const child = spawn(
      process.execPath,
      [tscPath, "-p", path.join(extensionDir, "tsconfig.json")],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );
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
      { cwd: rootDir, stdio: "inherit" },
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Vite build exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function runEsbuildClassicScriptBundles(): Promise<void> {
  return buildClassicScriptBundles({ extensionDir, distDir });
}

async function build(mode: string): Promise<void> {
  const env = await resolveBuildEnv();
  const appOrigins = resolveAppOrigins(env, mode);
  const appPatterns = appOrigins.map(originToPattern);
  const supabasePatterns = resolveSupabaseHostPattern(env, mode);

  const manifest: Record<string, unknown> = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.key = (env.EXTENSION_KEY || stableExtensionKey).trim();
  manifest.host_permissions = unique([
    ...appPatterns,
    ...EXTENSION_ALLOWED_HOST_PATTERNS,
    ...supabasePatterns,
  ]);
  manifest.content_scripts = ((manifest.content_scripts as unknown[]) || []).map(
    (entry: unknown) => ({
      ...(entry as Record<string, unknown>),
      matches: appPatterns,
    }),
  );

  if (env.EXTENSION_NAME) {
    manifest.name = env.EXTENSION_NAME;
  }
  if (env.EXTENSION_VERSION) {
    manifest.version = env.EXTENSION_VERSION;
  }

  await copyStaticToDist();
  await runTscExtension();
  await runEsbuildClassicScriptBundles();
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
    "utf8",
  );
  await fs.writeFile(path.join(distDir, "env.js"), envJs, "utf8");
  await fs.writeFile(
    path.join(distDir, "reload-trigger.json"),
    `${JSON.stringify({ buildId: new Date().toISOString(), mode }, null, 2)}\n`,
    "utf8",
  );

  // After the manifest is written, so it verifies what was actually shipped rather than what the
  // template said.
  const classicScriptProblems = await verifyClassicScripts(distDir);
  if (classicScriptProblems.length > 0) {
    throw new Error(formatClassicScriptProblems(classicScriptProblems));
  }

  console.log(
    `[extension:${mode}] built -> browserExtension/dist (origins: ${appOrigins.join(", ")})`,
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
          error instanceof Error ? error.message : error,
        );
      } finally {
        building = false;
      }
    }, 120);
  };

  const extensionWatcher = fsWatch(extensionDir, { recursive: true }, (_event, filename) => {
    if (shouldIgnoreWatchEvent(filename ?? null)) return;
    scheduleBuild();
  });

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
  console.error("[extension] build failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

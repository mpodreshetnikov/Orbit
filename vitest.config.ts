import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.resolve(__dirname);
const alias = [
  {
    find: /^@\/lib\/supabase$/,
    replacement: path.join(rootDir, "src", "lib", "supabase.ts"),
  },
  {
    find: /^@\//,
    replacement: `${path.join(rootDir, "src")}${path.sep}`,
  },
  {
    find: /^@shared\//,
    replacement: `${path.join(rootDir, "shared")}${path.sep}`,
  },
];

const isCi = process.env.CI === "true" || process.env.CI === "1";

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

/**
 * Per-test limits, spread into every project below.
 *
 * They cannot live on the root `test` block alone. Vitest does not pass root-level test options
 * down to entries in `projects` — each project resolves its own — so a `testTimeout` set only at
 * the root is read by nothing and every test runs on the built-in 5-second default. The symptom
 * is a handful of the slowest tests timing out on CI under load, in whichever files happen to be
 * slowest, unrelated to the change being tested, which reads exactly like flakiness.
 */
export function sharedTestOptions() {
  return {
    testTimeout: readIntEnv("VITEST_TEST_TIMEOUT_MS", isCi ? 10_000 : 7_000),
    hookTimeout: readIntEnv("VITEST_HOOK_TIMEOUT_MS", isCi ? 15_000 : 12_000),
    retry: readIntEnv("VITEST_RETRY", 0),
  };
}

function resolveMaxWorkers(): number | string {
  const raw = process.env.VITEST_MAX_WORKERS?.trim();
  if (raw) {
    return raw;
  }

  return isCi ? "75%" : "50%";
}

export default defineConfig({
  // @ts-expect-error - Vite vs Vitest plugin type mismatch (different Vite instances)
  plugins: [react()],
  esbuild: {
    jsxInject: 'import React from "react"',
  },
  resolve: {
    alias,
  },
  test: {
    pool: "threads",
    maxWorkers: resolveMaxWorkers(),
    testTimeout: readIntEnv("VITEST_TEST_TIMEOUT_MS", isCi ? 10_000 : 7_000),
    hookTimeout: readIntEnv("VITEST_HOOK_TIMEOUT_MS", isCi ? 15_000 : 12_000),
    retry: readIntEnv("VITEST_RETRY", 0),
    alias: {
      "@": path.join(rootDir, "src"),
      "@shared": path.join(rootDir, "shared"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.{test,spec}.{ts,tsx}", "**/*.d.ts"],
    },
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          name: "web",
          ...sharedTestOptions(),
          environment: "jsdom",
          setupFiles: ["test/setup/web.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/lib/**/*.{test,spec}.{ts,tsx}", "src/**/route.test.ts", "src/**/*.d.ts"],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: "web-server",
          ...sharedTestOptions(),
          environment: "node",
          setupFiles: ["test/setup/node.ts"],
          include: ["src/**/route.test.ts"],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: "extension-ui",
          ...sharedTestOptions(),
          environment: "jsdom",
          setupFiles: ["test/setup/extension.ts"],
          include: ["browserExtension/popup-src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: "extension-core",
          ...sharedTestOptions(),
          environment: "node",
          setupFiles: ["test/setup/extension.ts"],
          include: ["browserExtension/src/**/*.{test,spec}.ts"],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: "node",
          ...sharedTestOptions(),
          environment: "node",
          setupFiles: ["test/setup/node.ts"],
          include: [
            "scripts/**/*.{test,spec}.ts",
            "src/lib/**/*.{test,spec}.ts",
            "native/**/*.{test,spec}.ts",
          ],
        },
      },
    ],
  },
});

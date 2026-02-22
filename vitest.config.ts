import os from "node:os";
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
    maxWorkers: os.cpus().length,
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
          environment: "node",
          setupFiles: ["test/setup/node.ts"],
          include: ["scripts/**/*.{test,spec}.ts", "src/lib/**/*.{test,spec}.ts"],
        },
      },
    ],
  },
});

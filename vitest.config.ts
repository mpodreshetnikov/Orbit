import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = path.resolve(__dirname);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/lib\/supabase$/,
        replacement: path.join(rootDir, "src", "lib", "supabase.ts").replace(/\\/g, "/"),
      },
      {
        find: /^@\//,
        replacement: `${path.join(rootDir, "src").replace(/\\/g, "/")}/`,
      },
      {
        find: /^@shared\//,
        replacement: `${path.join(rootDir, "shared").replace(/\\/g, "/")}/`,
      },
    ],
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html", "json-summary"],
      all: true,
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/stores/**/*.{ts,tsx}",
        "src/app/api/**/*.{ts,tsx}",
        "src/app/auth/**/*.{ts,tsx}",
        "src/hooks/use-current-user.ts",
        "src/hooks/use-icd-lookup.ts",
        "src/hooks/use-media-query.ts",
        "src/hooks/use-push-subscribe.ts",
        "browserExtension/src/core/**/*.{ts,tsx}",
        "browserExtension/src/connectors/registry.ts",
        "browserExtension/popup-src/helpers.ts",
        "scripts/extension/build-lib.ts",
      ],
      exclude: [
        "**/*.{test,spec}.{ts,tsx}",
        "**/*.d.ts",
        "test/**",
        "scripts/**/fixtures/**",
        "scripts/**/__fixtures__/**",
      ],
    },
    projects: [
      {
        test: {
          name: "web",
          environment: "jsdom",
          setupFiles: ["test/setup/web.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/lib/**/*.{test,spec}.{ts,tsx}", "src/**/route.test.ts", "src/**/*.d.ts"],
        },
      },
      {
        test: {
          name: "web-server",
          environment: "node",
          setupFiles: ["test/setup/node.ts"],
          include: ["src/**/route.test.ts"],
        },
      },
      {
        test: {
          name: "extension-ui",
          environment: "jsdom",
          setupFiles: ["test/setup/extension.ts"],
          include: ["browserExtension/popup-src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "extension-core",
          environment: "node",
          setupFiles: ["test/setup/extension.ts"],
          include: ["browserExtension/src/**/*.{test,spec}.ts"],
        },
      },
      {
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

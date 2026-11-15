/**
 * Architecture boundary lint (T-261115-csy / B5) — error severity.
 *
 * Separate from eslint.config.mjs so Next/core-web-vitals rules do not run on Deno edge sources.
 *
 * Covers:
 * (a) mobile → web allowlist (@orbit-types, @orbit-messages, @db / database.types)
 * (b) src/app ↛ deep supabase (functions / migrations / db)
 * (c) edge functions ↛ L1 presentation (src/components, src/app, mobile)
 */
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import boundaries from "eslint-plugin-boundaries";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsProjectFiles = [
  resolve(__dirname, "mobile/tsconfig.json"),
  resolve(__dirname, "tsconfig.json"),
  resolve(__dirname, "supabase/functions/tsconfig.json"),
];

/** @type {import("eslint").Linter.Config[]} */
const eslintBoundariesConfig = [
  {
    ignores: [
      "**/node_modules/**",
      "mobile/node_modules/**",
      ".next/**",
      "coverage/**",
      "browserExtension/dist/**",
      "ios/**",
      "supabase/.temp/**",
      "supabase/db/database.types.ts",
      "supabase/db/schema.snapshot.sql",
    ],
  },
  {
    files: ["mobile/src/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "supabase/functions/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      import: importPlugin,
      boundaries,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: tsProjectFiles,
          noWarnOnMultipleProjects: true,
        },
        node: true,
      },
      "boundaries/include": [
        "mobile/src/**",
        "src/**",
        "supabase/functions/**",
        "supabase/migrations/**",
        "supabase/db/**",
      ],
      "boundaries/elements": [
        // mode: "full" is required: default "folder" walks path suffixes, so
        // `src/components/**` would also match `mobile/src/components/**`.
        // Use `/**` (not `/**/*`) so files directly under the folder match too.
        { type: "db-types", pattern: "supabase/db/database.types.ts", mode: "full" },
        { type: "orbit-types", pattern: "src/types/**", mode: "full" },
        { type: "orbit-messages", pattern: "src/messages/**", mode: "full" },
        { type: "mobile", pattern: "mobile/src/**", mode: "full" },
        { type: "web-app", pattern: "src/app/**", mode: "full" },
        { type: "web-components", pattern: "src/components/**", mode: "full" },
        { type: "web-hooks", pattern: "src/hooks/**", mode: "full" },
        { type: "web-lib", pattern: "src/lib/**", mode: "full" },
        { type: "web-stores", pattern: "src/stores/**", mode: "full" },
        { type: "edge", pattern: "supabase/functions/**", mode: "full" },
        { type: "supabase-migrations", pattern: "supabase/migrations/**", mode: "full" },
        { type: "supabase-db", pattern: "supabase/db/**", mode: "full" },
      ],
    },
    rules: {
      // Do not enable no-unknown* — this is a narrow allowlist, not a full map.
      "boundaries/element-types": [
        "error",
        {
          default: "allow",
          message:
            "Architecture boundary pilot (T-261115-csy). See docs/design/common/architecture-boundary-lint.md",
          rules: [
            // (a) Mobile → web: default allow (npm, mobile/test, @orbit-types, @orbit-messages, @db);
            //     explicit disallow for non-allowlisted web / edge / SQL surfaces.
            {
              from: "mobile",
              disallow: [
                "web-app",
                "web-components",
                "web-hooks",
                "web-lib",
                "web-stores",
                "edge",
                "supabase-migrations",
                "supabase-db",
              ],
              message:
                "Mobile may import only @orbit-types/*, @orbit-messages/*, @db (database.types), and other mobile/src modules (Metro allowlist).",
            },
            // (b) Presentation routes must not pull edge/SQL artifacts.
            {
              from: "web-app",
              disallow: ["edge", "supabase-migrations", "supabase-db"],
              message:
                "src/app must not import supabase/functions, migrations, or db SQL artifacts (Rule L1 vs L3/L4).",
            },
            // (c) Edge workflow must not depend on L1 UI assumptions.
            {
              from: "edge",
              disallow: [
                "web-app",
                "web-components",
                "mobile",
                "web-hooks",
                "web-lib",
                "web-stores",
              ],
              message:
                "Edge functions must not import web/mobile presentation or client orchestration (Rule L3→L1).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintBoundariesConfig;

import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const tsProjectFiles = [
  resolve(__dirname, "tsconfig.json"),
  resolve(__dirname, "browserExtension/tsconfig.json"),
];

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "build/**",
      "coverage/**",
      "browserExtension/dist/**",
      "ios/**",
      "supabase/.temp/**",
      "supabase/functions/**",
      "supabase/db/database.types.ts",
      "supabase/db/schema.snapshot.sql",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: [
      "src/**/*.{ts,tsx}",
      "browserExtension/src/**/*.ts",
      "browserExtension/popup-src/**/*.tsx",
      "shared/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx,js,mjs,cjs}",
      "native/**/*.ts",
      "vite.config.extension.ts",
      "capacitor.config.ts",
      "tailwind.config.ts",
      "next.config.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
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
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "import/no-cycle": "error",
      "import/no-unresolved": "error",
    },
  },
  {
    files: ["browserExtension/src/**/*.ts", "browserExtension/popup-src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: tsProjectFiles,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
    },
  },
  {
    files: ["scripts/just/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["browserExtension/**", "**/browserExtension/**"],
              message: "Web app code must not import browser extension code.",
            },
            {
              group: ["scripts/**", "**/scripts/**"],
              message: "Web app code must not import build/runtime scripts.",
            },
            {
              group: ["supabase/functions/**", "**/supabase/functions/**"],
              message: "Web app code must not import Supabase edge function source.",
            },
            {
              group: ["supabase/migrations/**", "**/supabase/migrations/**"],
              message: "Web app code must not import migration files.",
            },
            {
              group: ["supabase/db/**", "**/supabase/db/**"],
              message: "Web app code must not import DB SQL artifacts directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^(React|_)$" },
      ],
    },
  },
  {
    files: ["src/types/database.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["browserExtension/src/**/*.ts", "browserExtension/popup-src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "Extension code must use @shared/* for shared UI/helpers, not web app imports.",
            },
            {
              group: ["scripts/**", "**/scripts/**"],
              message: "Extension code must not import build scripts.",
            },
            {
              group: ["browserExtension/dist/**", "**/browserExtension/dist/**"],
              message: "Extension source must not import generated dist artifacts.",
            },
            {
              group: [
                "node:*",
                "fs",
                "path",
                "child_process",
                "worker_threads",
                "module",
                "net",
                "tls",
                "dgram",
                "os",
              ],
              message: "Extension runtime/popup code cannot import Node-only modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["browserExtension/src/**/*.ts"],
    rules: {
      "import/no-unresolved": [
        "error",
        {
          ignore: ["\\.js$"],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.{ts,tsx,js,mjs,cjs}", "vite.config.extension.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["browserExtension/src/**", "**/browserExtension/src/**"],
              message: "Build scripts must not import extension runtime code.",
            },
            {
              group: ["browserExtension/popup-src/**", "**/browserExtension/popup-src/**"],
              message: "Build scripts must not import extension popup source.",
            },
            {
              group: ["browserExtension/dist/**", "**/browserExtension/dist/**"],
              message: "Build scripts must not import generated extension artifacts.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;

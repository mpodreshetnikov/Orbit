import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyChangedFiles } = require("./change-impact.cjs") as {
  classifyChangedFiles: (paths: string[]) => {
    extensionImpact: boolean;
    webImpact: boolean;
    dbImpact: boolean;
    functionsImpact: boolean;
    docsOnly: boolean;
  };
};

describe("change-impact", () => {
  it("treats the database tooling as a database change", () => {
    // Otherwise a change to the migration-check gate merges without the gate running — which is
    // how the commit that introduced it slipped through.
    expect(classifyChangedFiles(["scripts/just/db-data-migration-check.ts"]).dbImpact).toBe(true);
    expect(classifyChangedFiles(["scripts/just/db-local-docker.cjs"]).dbImpact).toBe(true);
    expect(classifyChangedFiles(["supabase/migrations/1_x.sql"]).dbImpact).toBe(true);
    expect(classifyChangedFiles(["scripts/just/coverage-report.cjs"]).dbImpact).toBe(false);
  });

  it("treats extension build surfaces as extension impact", () => {
    expect(classifyChangedFiles(["scripts/extension/build.ts"]).extensionImpact).toBe(true);
    expect(classifyChangedFiles(["vite.config.extension.ts"]).extensionImpact).toBe(true);
    expect(classifyChangedFiles(["browserExtension/src/background.ts"]).extensionImpact).toBe(true);
  });
});

describe("change-impact docsOnly", () => {
  it("flags a change confined to prose, and lights up no build or test surface", () => {
    const impact = classifyChangedFiles(["docs/design/core-beliefs.md", "AGENTS.md"]);

    expect(impact.docsOnly).toBe(true);
    expect(impact.webImpact).toBe(false);
    expect(impact.dbImpact).toBe(false);
    expect(impact.extensionImpact).toBe(false);
    expect(impact.functionsImpact).toBe(false);
  });

  it("clears the flag as soon as one file is not prose", () => {
    expect(classifyChangedFiles(["docs/design/core-beliefs.md", "src/app/page.tsx"]).docsOnly).toBe(
      false,
    );
    expect(classifyChangedFiles(["docs/design/core-beliefs.md", "justfile"]).docsOnly).toBe(false);
  });

  it("is false when nothing changed, so an empty diff never skips the gates", () => {
    expect(classifyChangedFiles([]).docsOnly).toBe(false);
  });

  it("treats the shared dedupe formula as a database change", () => {
    // The SQL migration reproduces `buildMoneyDedupeHash` character for character, and the only
    // thing comparing them is the data migration check — which the workflow guards on dbImpact.
    // Classified as web-only, a change to the formula merges without that comparison running.
    expect(classifyChangedFiles(["shared/lib/money/dedupe.ts"]).dbImpact).toBe(true);
    expect(classifyChangedFiles(["shared/lib/money/other.ts"]).dbImpact).toBe(false);
  });
});

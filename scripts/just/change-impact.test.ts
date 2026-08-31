import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyChangedFiles } = require("./change-impact.cjs") as {
  classifyChangedFiles: (paths: string[]) => {
    extensionImpact: boolean;
    webImpact: boolean;
    dbImpact: boolean;
    functionsImpact: boolean;
    fixturesImpact: boolean;
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

  it("treats the extraction corpus and its harness as fixture impact", () => {
    // The corpus matched no flag at all: `test/fixtures/` is not a source prefix and `isDocFile`
    // does not claim it either, so a corpus-only change reported no impact whatsoever. No gate
    // depends on these flags today, which is why nothing has broken -- but the first one that does
    // would skip precisely the pull requests that change the answers every score is measured
    // against.
    expect(
      classifyChangedFiles(["test/fixtures/extraction/cases/001-biochem-lipid-ru/expected.json"])
        .fixturesImpact,
    ).toBe(true);
    expect(
      classifyChangedFiles(["test/fixtures/extraction/shared/catalogs.json"]).fixturesImpact,
    ).toBe(true);
    expect(classifyChangedFiles(["scripts/extraction-eval/score.ts"]).fixturesImpact).toBe(true);
  });

  it("does not claim fixture impact for unrelated changes", () => {
    expect(classifyChangedFiles(["src/app/page.tsx"]).fixturesImpact).toBe(false);
    expect(classifyChangedFiles(["docs/DESIGN.md"]).fixturesImpact).toBe(false);
  });

  it("still treats a corpus-only change as something other than docs", () => {
    // `docsOnly` is what a pipeline would use to skip work entirely. A fixture change must never
    // qualify: it changes what the pipeline is measured against, not how it is described.
    const impact = classifyChangedFiles([
      "test/fixtures/extraction/cases/002-kidney-ultrasound-ru/expected.json",
    ]);
    expect(impact.docsOnly).toBe(false);
    expect(impact.fixturesImpact).toBe(true);
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
    // The preflight starts the daemon those checks run on, so a regression there stops all of
    // them — and it is the file this branch changed to make them runnable in the first place.
    expect(classifyChangedFiles(["scripts/just/docker-preflight.cjs"]).dbImpact).toBe(true);
  });
});

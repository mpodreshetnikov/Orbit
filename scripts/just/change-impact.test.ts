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
});

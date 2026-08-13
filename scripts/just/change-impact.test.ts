import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyChangedFiles } = require("./change-impact.cjs") as {
  classifyChangedFiles: (paths: string[]) => {
    extensionImpact: boolean;
    webImpact: boolean;
    dbImpact: boolean;
    functionsImpact: boolean;
    docsOnly: boolean;
    tasksOnly: boolean;
  };
};

describe("change-impact", () => {
  it("treats extension build surfaces as extension impact", () => {
    expect(classifyChangedFiles(["scripts/extension/build.ts"]).extensionImpact).toBe(true);
    expect(classifyChangedFiles(["vite.config.extension.ts"]).extensionImpact).toBe(true);
    expect(classifyChangedFiles(["browserExtension/src/background.ts"]).extensionImpact).toBe(true);
  });
});

describe("change-impact tasksOnly", () => {
  it("flags a change confined to the task registry, including nested decision records", () => {
    const impact = classifyChangedFiles([
      "docs/tasks/T-0012-do-the-thing.md",
      "docs/tasks/INDEX.md",
      "docs/tasks/decisions/ADR-0002-do-it-this-way.md",
    ]);

    expect(impact.tasksOnly).toBe(true);
    // A registry-only change must not light up any build or test surface.
    expect(impact.webImpact).toBe(false);
    expect(impact.dbImpact).toBe(false);
    expect(impact.extensionImpact).toBe(false);
    expect(impact.functionsImpact).toBe(false);
  });

  it("clears the flag as soon as one file lives outside the registry", () => {
    expect(
      classifyChangedFiles(["docs/tasks/T-0012-do-the-thing.md", "src/app/page.tsx"]).tasksOnly,
    ).toBe(false);
    expect(classifyChangedFiles(["docs/tasks/T-0012-do-the-thing.md", "justfile"]).tasksOnly).toBe(
      false,
    );
  });

  it("is narrower than docsOnly", () => {
    const designDocs = classifyChangedFiles(["docs/design/core-beliefs.md"]);
    expect(designDocs.docsOnly).toBe(true);
    expect(designDocs.tasksOnly).toBe(false);
  });

  it("requires a directory boundary rather than a name prefix", () => {
    // `docs/tasks-overview.md` is not inside the registry, so it must not take the fast path.
    expect(classifyChangedFiles(["docs/tasks-overview.md"]).tasksOnly).toBe(false);
  });

  it("is false when nothing changed, so an empty diff never skips the gates", () => {
    expect(classifyChangedFiles([]).tasksOnly).toBe(false);
  });
});

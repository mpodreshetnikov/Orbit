import { describe, expect, it } from "vitest";
import * as changeImpact from "./change-impact.cjs";

const { classifyChangedFiles } = changeImpact;

describe("change-impact", () => {
  it("marks docs-only changes", () => {
    const impact = classifyChangedFiles([
      "docs/QUALITY.md",
      "README.md",
      ".agents/skills/relevant-quality-checks/SKILL.md",
    ]);

    expect(impact.dbImpact).toBe(false);
    expect(impact.webImpact).toBe(false);
    expect(impact.extensionImpact).toBe(false);
    expect(impact.functionsImpact).toBe(false);
    expect(impact.docsOnly).toBe(true);
  });

  it("marks DB impact for migrations and supabase db SQL", () => {
    const impact = classifyChangedFiles([
      "supabase/migrations/20260303000001_add_table.sql",
      "supabase/db/functions/refresh_state.sql",
    ]);

    expect(impact.dbImpact).toBe(true);
    expect(impact.docsOnly).toBe(false);
  });

  it("marks web, extension, and edge function impacts independently", () => {
    const impact = classifyChangedFiles([
      "src/app/page.tsx",
      "browserExtension/src/core/import-runner.ts",
      "supabase/functions/health-ocr/index.ts",
    ]);

    expect(impact.webImpact).toBe(true);
    expect(impact.extensionImpact).toBe(true);
    expect(impact.functionsImpact).toBe(true);
    expect(impact.dbImpact).toBe(false);
    expect(impact.docsOnly).toBe(false);
  });
});

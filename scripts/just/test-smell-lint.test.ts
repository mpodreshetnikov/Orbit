import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeFile, run } from "./test-smell-lint.cjs";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("test-smell-lint", () => {
  it("flags a sole toBeTruthy expect", () => {
    const source = `
import { it, expect } from "vitest";
it("weak", () => {
  expect(value).toBeTruthy();
});
`;
    const findings = analyzeFile("x.test.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("lone-presence");
  });

  it("flags sole toContain and mock-call-only cases", () => {
    const source = `
import { it, expect, vi } from "vitest";
it("substring", () => {
  expect(html).toContain("<div>");
});
it("mocks only", () => {
  const spy = vi.fn();
  spy();
  expect(spy).toHaveBeenCalled();
  expect(spy).toHaveBeenCalledWith();
});
it("ok concrete", () => {
  expect(sum(1, 2)).toBe(3);
});
`;
    const findings = analyzeFile("y.test.ts", source);
    expect(findings.map((f) => f.kind).toSorted()).toEqual(["lone-tocontain", "mock-call-only"]);
  });

  it("honours test-smell-ok suppressions", () => {
    const source = `
it("allowed", () => {
  expect(host).toBeDefined(); // test-smell-ok: host from optional DOM probe
});
`;
    expect(analyzeFile("z.test.ts", source)).toHaveLength(0);
  });

  it("warn mode exits 0 even with findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-"));
    temps.push(dir);
    writeFileSync(
      join(dir, "sample.test.ts"),
      `import { it, expect } from "vitest";
it("weak", () => { expect(1).toBeTruthy(); });
`,
    );
    const result = run({ roots: [dir], fail: false });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  });

  it("fail mode exits 1 when smells remain", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-"));
    temps.push(dir);
    writeFileSync(
      join(dir, "sample.test.ts"),
      `import { it, expect } from "vitest";
it("weak", () => { expect(1).toBeTruthy(); });
`,
    );
    const result = run({ roots: [dir], fail: true });
    expect(result.exitCode).toBe(1);
  });
});

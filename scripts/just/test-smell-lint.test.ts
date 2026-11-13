import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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
    const source = [
      'import { it, expect } from "vitest";',
      'it("weak", () => {',
      "  expect(value).toBeTruthy();",
      "});",
      "",
    ].join("\n");
    const findings = analyzeFile("x.test.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("lone-presence");
  });

  it("flags sole toContain and mock-call-only cases", () => {
    const source = [
      'import { it, expect, vi } from "vitest";',
      'it("substring", () => {',
      '  expect(html).toContain("<div>");',
      "});",
      'it("mocks only", () => {',
      "  const spy = vi.fn();",
      "  spy();",
      "  expect(spy).toHaveBeenCalled();",
      "  expect(spy).toHaveBeenCalledWith();",
      "});",
      'it("ok concrete", () => {',
      "  expect(sum(1, 2)).toBe(3);",
      "});",
      "",
    ].join("\n");
    const findings = analyzeFile("y.test.ts", source);
    expect(findings.map((f) => f.kind).toSorted()).toEqual(["lone-tocontain", "mock-call-only"]);
  });

  it("analyzes the it callback body, not a nested vi.fn callback", () => {
    const source = [
      'it("weak with nested fn", () => {',
      "  const spy = vi.fn(() => {",
      "    return 1;",
      "  });",
      "  expect(spy()).toBeTruthy();",
      "});",
      "",
    ].join("\n");
    const findings = analyzeFile("nested.test.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("lone-presence");
  });

  it("does not treat nested waitFor mock asserts as mock-call-only when the test asserts a result", () => {
    const source = [
      'it("waits then asserts", async () => {',
      "  await waitFor(() => {",
      "    expect(spy).toHaveBeenCalled();",
      "  });",
      '  expect(result).toBe("ok");',
      "});",
      "",
    ].join("\n");
    expect(analyzeFile("wait.test.ts", source)).toHaveLength(0);
  });

  it("recognizes curried it.each / it.for callbacks", () => {
    const source = [
      'it.each([1, 2])("weak %s", (value) => {',
      "  expect(value).toBeTruthy();",
      "});",
      'it.for([3])("also %s", (value) => {',
      '  expect(String(value)).toContain("3");',
      "});",
      "",
    ].join("\n");
    const findings = analyzeFile("each.test.ts", source);
    expect(findings.map((f) => f.kind).toSorted()).toEqual(["lone-presence", "lone-tocontain"]);
  });

  it("counts .not matchers so a result assertion clears mock-call-only", () => {
    const source = [
      'it("mock plus negated result", () => {',
      "  expect(spy).toHaveBeenCalled();",
      '  expect(result).not.toEqual("wrong");',
      "});",
      'it("only negated mock", () => {',
      "  expect(spy).not.toHaveBeenCalled();",
      "});",
      "",
    ].join("\n");
    const findings = analyzeFile("not.test.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("mock-call-only");
    expect(findings[0].line).toBeGreaterThan(4);
  });

  it("skips it/test declarations inside string fixtures and comments", () => {
    const source = [
      "const fixture = `",
      'it("weak", () => {',
      "  expect(1).toBeTruthy();",
      "});",
      "`;",
      "const also = 'it(\"x\", () => { expect(1).toBeTruthy(); })';",
      '// it("commented", () => { expect(1).toBeTruthy(); });',
      'it("real", () => {',
      "  expect(2).toBe(2);",
      "});",
      "",
    ].join("\n");
    expect(analyzeFile("fixtures.test.ts", source)).toHaveLength(0);
  });

  it("honours test-smell-ok suppressions", () => {
    const source = [
      'it("allowed", () => {',
      "  expect(host).toBeDefined(); // test-smell-ok: host from optional DOM probe",
      "});",
      "",
    ].join("\n");
    expect(analyzeFile("z.test.ts", source)).toHaveLength(0);
  });

  it("warn mode exits 0 even with findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-"));
    temps.push(dir);
    writeFileSync(
      join(dir, "sample.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("weak", () => { expect(1).toBeTruthy(); });',
        "",
      ].join("\n"),
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
      [
        'import { it, expect } from "vitest";',
        'it("weak", () => { expect(1).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    const result = run({ roots: [dir], fail: true });
    expect(result.exitCode).toBe(1);
  });

  it("does not flag its own regression fixtures when analyzing this file", () => {
    // Self-check: string fixtures above must not be treated as executable tests.
    const self = readFileSync(__filename, "utf8");
    const findings = analyzeFile("scripts/just/test-smell-lint.test.ts", self);
    // Real cases in this file all use concrete oracles or suppressions.
    expect(findings).toEqual([]);
  });
});

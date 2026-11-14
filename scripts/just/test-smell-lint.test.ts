import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeFile,
  caseBodyRange,
  inNonCode,
  lastTopLevelArg,
  matchingParen,
  MOCK_CALL_MATCHERS,
  run,
  skipWs,
  TEST_NAME,
  testCallParens,
  walk,
  WEAK_PRESENCE,
} from "./test-smell-lint.cjs";

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
    expect(findings[0].line).toBe(3);
    expect(findings[0].file).toBe("x.test.ts");
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
    expect(analyzeFile("fixtures.test.ts", source)).toEqual([]);
  });

  it("returns no findings when only string-literal it() heads exist", () => {
    const source = 'const s = `it("w", () => { expect(1).toBeTruthy(); });`;\n';
    expect(analyzeFile("only-string.test.ts", source)).toEqual([]);
  });

  it("skips malformed heads that never open a call", () => {
    expect(analyzeFile("bare.test.ts", "it\n")).toEqual([]);
    // it.each without a curried title/callback call → testCallParens returns null
    expect(analyzeFile("each-only.test.ts", "it.each([1]);\n")).toEqual([]);
  });

  it("ignores expect() tokens that appear only inside string literals in a live case", () => {
    const source = ['it("t", () => {', '  const s = "expect(1).toBeTruthy();";', "});", ""].join(
      "\n",
    );
    expect(analyzeFile("str-expect.test.ts", source)).toEqual([]);
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

  it("exposes the weak-presence and mock-call matcher sets used by the classifier", () => {
    expect(WEAK_PRESENCE.has("toBeTruthy")).toBe(true);
    expect(WEAK_PRESENCE.has("toBeDefined")).toBe(true);
    expect(WEAK_PRESENCE.has("toBeFalsy")).toBe(true);
    expect(WEAK_PRESENCE.has("toBeUndefined")).toBe(true);
    expect(WEAK_PRESENCE.has("toBe")).toBe(false);
    expect(MOCK_CALL_MATCHERS.has("toHaveBeenCalled")).toBe(true);
    expect(MOCK_CALL_MATCHERS.has("toHaveBeenCalledWith")).toBe(true);
    expect(MOCK_CALL_MATCHERS.has("toHaveReturned")).toBe(true);
    expect(MOCK_CALL_MATCHERS.has("toBe")).toBe(false);
  });

  it("matches only *.test.* / *.spec.* filenames", () => {
    expect(TEST_NAME.test("a.test.ts")).toBe(true);
    expect(TEST_NAME.test("a.spec.tsx")).toBe(true);
    expect(TEST_NAME.test("a.test.mjs")).toBe(true);
    expect(TEST_NAME.test("a.ts")).toBe(false);
    expect(TEST_NAME.test("test.ts")).toBe(false);
  });
});

describe("test-smell-lint helpers", () => {
  it("inNonCode detects strings, line comments, and block comments", () => {
    const source = 'const a = "it("; // it(\n/* it( */ x';
    expect(inNonCode(source, source.indexOf('"it(') + 1)).toBe(true);
    expect(inNonCode(source, source.indexOf("// it(") + 3)).toBe(true);
    expect(inNonCode(source, source.indexOf("/* it(") + 3)).toBe(true);
    expect(inNonCode(source, source.lastIndexOf("x"))).toBe(false);
    expect(inNonCode('const s = "a\\\\b";', 12)).toBe(true);
    // Escaped quote stays inside the string; code after the closer is not.
    const escaped = 'const s = "a\\"b"; it("t", () => {});';
    expect(inNonCode(escaped, escaped.indexOf('"a') + 1)).toBe(true);
    expect(inNonCode(escaped, escaped.indexOf("it("))).toBe(false);
    // Template literals and single quotes count as non-code.
    expect(inNonCode("const s = `it(`; x", 12)).toBe(true);
    expect(inNonCode("const s = 'it('; x", 12)).toBe(true);
    // After block comment closes, following code is live.
    const block = "/* it( */\nit(";
    expect(inNonCode(block, block.indexOf("/*") + 2)).toBe(true);
    expect(inNonCode(block, block.lastIndexOf("it("))).toBe(false);
  });

  it("walk skips node_modules, dist, and dist-firefox directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-skip-"));
    temps.push(dir);
    for (const name of ["node_modules", "dist", "dist-firefox", "keep"]) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "x.test.ts"), "export {};\n");
    }
    const visited: string[] = [];
    walk(dir, (file: string) => visited.push(file));
    expect(visited).toEqual([join(dir, "keep", "x.test.ts")]);
  });

  it("matchingParen returns the matching closer and -1 when unbalanced", () => {
    const source = "fn(a, (b), c)";
    expect(matchingParen(source, 2)).toBe(12);
    expect(matchingParen(source, 6)).toBe(8);
    expect(matchingParen("fn(a", 2)).toBe(-1);
    expect(matchingParen('fn(")")', 2)).toBe(6);
  });

  it("skipWs advances past whitespace only", () => {
    expect(skipWs("  \n\tabc", 0)).toBe(4);
    expect(skipWs("abc", 0)).toBe(0);
    expect(skipWs("   ", 0)).toBe(3);
  });

  it("testCallParens finds the it call and the curried it.each second call", () => {
    const plain = 'it("t", () => {})';
    const plainCall = testCallParens(plain, 0, "it");
    expect(plainCall).not.toBeNull();
    expect(plain.slice(plainCall!.openIdx, plainCall!.closeIdx + 1)).toBe('("t", () => {})');

    const each = 'it.each([1])("t", (v) => { expect(v).toBe(1); })';
    const eachCall = testCallParens(each, 0, "it.each");
    expect(eachCall).not.toBeNull();
    expect(each.slice(eachCall!.openIdx, eachCall!.closeIdx + 1)).toContain("expect(v).toBe(1)");

    expect(testCallParens("it", 0, "it")).toBeNull();
    expect(testCallParens("it.each([1])", 0, "it.each")).toBeNull();
  });

  it("lastTopLevelArg returns the final comma-separated argument", () => {
    expect(lastTopLevelArg('"t", () => {}')).toEqual({ start: 4, end: 13 });
    expect(lastTopLevelArg("a, {b: 1}, c")).toEqual({ start: 10, end: 12 });
    expect(lastTopLevelArg("fn(1, 2), cb")).toEqual({ start: 9, end: 12 });
    expect(lastTopLevelArg("   ")).toBeNull();
    expect(lastTopLevelArg('"a,b", last')).toEqual({ start: 6, end: 11 });
    expect('"t", () => {}'.slice(4, 13)).toBe(" () => {}");
  });

  it("caseBodyRange extracts only the top-level it callback body", () => {
    const source = 'it("t", () => { expect(1).toBe(1); })';
    const call = testCallParens(source, 0, "it")!;
    const body = caseBodyRange(source, call.openIdx, call.closeIdx);
    expect(body).not.toBeNull();
    expect(source.slice(body!.start, body!.end)).toContain("expect(1).toBe(1)");

    const nested =
      'it("t", () => { const spy = vi.fn(() => { return 1; }); expect(spy()).toBe(1); })';
    const nestedCall = testCallParens(nested, 0, "it")!;
    const nestedBody = caseBodyRange(nested, nestedCall.openIdx, nestedCall.closeIdx);
    expect(nestedBody).not.toBeNull();
    expect(nested.slice(nestedBody!.start, nestedBody!.end)).toContain("vi.fn");
    expect(nested.slice(nestedBody!.start, nestedBody!.end)).toContain("expect(spy())");

    expect(caseBodyRange('it("t", 1)', 2, 9)).toBeNull();
  });

  it("walk visits only test files under a root", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-walk-"));
    temps.push(dir);
    writeFileSync(join(dir, "a.test.ts"), "export {};\n");
    writeFileSync(join(dir, "b.ts"), "export {};\n");
    const nested = join(dir, "nested");
    writeFileSync(join(dir, "keep.txt"), "x\n");
    mkdirSync(nested);
    writeFileSync(join(nested, "c.spec.ts"), "export {};\n");
    const visited: string[] = [];
    walk(dir, (file: string) => visited.push(file));
    expect(visited.toSorted()).toEqual(
      [join(dir, "a.test.ts"), join(nested, "c.spec.ts")].toSorted(),
    );
    walk(join(dir, "missing"), () => {
      throw new Error("should not visit missing root");
    });
  });

  it("flags toBeFalsy / toBeUndefined as lone-presence and skips empty cases", () => {
    const source = [
      'it("falsy", () => { expect(v).toBeFalsy(); });',
      'it("undef", () => { expect(v).toBeUndefined(); });',
      'it("empty", () => {});',
      'it("soft", () => { expect.soft(v).toBeTruthy(); });',
      "",
    ].join("\n");
    const kinds = analyzeFile("more.test.ts", source).map((f) => f.kind);
    expect(kinds.toSorted()).toEqual(["lone-presence", "lone-presence", "lone-presence"]);
  });

  it("warn mode truncates the printed list and clean roots exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-many-"));
    temps.push(dir);
    const lines = Array.from({ length: 45 }, (_, i) => {
      return `it("w${i}", () => { expect(v${i}).toBeTruthy(); });`;
    });
    writeFileSync(join(dir, "many.test.ts"), `${lines.join("\n")}\n`);
    const many = run({ roots: [dir], fail: false });
    expect(many.findings.length).toBe(45);
    expect(many.exitCode).toBe(0);

    const cleanDir = mkdtempSync(join(tmpdir(), "smell-clean-"));
    temps.push(cleanDir);
    writeFileSync(join(cleanDir, "ok.test.ts"), 'it("ok", () => { expect(1).toBe(1); });\n');
    const clean = run({ roots: [cleanDir], fail: true });
    expect(clean.findings).toEqual([]);
    expect(clean.exitCode).toBe(0);
  });
});

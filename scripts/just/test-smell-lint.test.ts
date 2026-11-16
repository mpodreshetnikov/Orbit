import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeFile,
  caseBodyRange,
  countByFileRule,
  evaluateBaselineGrowth,
  evaluateRatchet,
  inNonCode,
  lastTopLevelArg,
  loadBaseline,
  matchingParen,
  MOCK_CALL_MATCHERS,
  parseFileRuleKey,
  resolveBaselineBaseRef,
  run,
  skipWs,
  TEST_NAME,
  testCallParens,
  walk,
  WEAK_PRESENCE,
  writeBaseline,
  ZERO_SHA,
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

describe("test-smell-lint ratchet", () => {
  it("counts findings by file+rule key", () => {
    expect(
      countByFileRule([
        { file: "a.test.ts", kind: "lone-presence" },
        { file: "a.test.ts", kind: "lone-presence" },
        { file: "a.test.ts", kind: "mock-call-only" },
        { file: "b.test.ts", kind: "lone-presence" },
      ]),
    ).toEqual({
      "a.test.ts::lone-presence": 2,
      "a.test.ts::mock-call-only": 1,
      "b.test.ts::lone-presence": 1,
    });
  });

  it("fails when baseline is missing", () => {
    expect(evaluateRatchet({ "a.test.ts::lone-presence": 1 }, null)).toEqual([
      "missing baseline; run test-smell-lint --update-baseline",
    ]);
  });

  it("passes when current counts exactly match the baseline", () => {
    const counts = { "src/a.test.ts::mock-call-only": 2 };
    expect(evaluateRatchet(counts, { counts })).toEqual([]);
  });

  it("fails when a file+rule count exceeds the baseline", () => {
    const failures = evaluateRatchet(
      { "src/a.test.ts::mock-call-only": 3 },
      { counts: { "src/a.test.ts::mock-call-only": 2 } },
    );
    expect(failures.some((f) => f.includes(">") && f.includes("baseline 2"))).toBe(true);
  });

  it("fails when a finding appears in a NEW file (proof probe)", () => {
    const failures = evaluateRatchet(
      {
        "src/legacy.test.ts::lone-presence": 1,
        "src/brand-new.test.ts::lone-presence": 1,
      },
      { counts: { "src/legacy.test.ts::lone-presence": 1 } },
    );
    expect(failures).toContain("new file with findings: src/brand-new.test.ts");
    expect(failures.some((f) => f.includes("src/legacy.test.ts"))).toBe(false);
  });

  it("fails when the baseline is stale after findings shrink", () => {
    const failures = evaluateRatchet(
      { "src/a.test.ts::lone-presence": 1 },
      { counts: { "src/a.test.ts::lone-presence": 2 } },
    );
    expect(failures.some((f) => f.includes("< baseline 2") && f.includes("shrink"))).toBe(true);
  });

  it("dry probe: run() exits 1 for a new-file finding against a baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-ratchet-"));
    temps.push(dir);
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(
      join(dir, "legacy.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("weak", () => { expect(1).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    run({
      roots: [dir],
      updateBaseline: true,
      baselinePath,
      baseBaseline: null,
      silent: true,
    });
    writeFileSync(
      join(dir, "brand-new.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("also weak", () => { expect(0).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    const result = run({
      roots: [dir],
      enforceRatchet: true,
      baselinePath,
      baseBaseline: null,
      silent: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.ratchetFailures.some((f) => f.includes("new file with findings"))).toBe(true);
  });

  it("fails when the committed baseline grows a file+rule count vs base", () => {
    const failures = evaluateBaselineGrowth(
      { counts: { "src/a.test.ts::mock-call-only": 3 } },
      { counts: { "src/a.test.ts::mock-call-only": 2 } },
    );
    expect(failures.some((f) => f.includes("baseline grew") && f.includes("3 > 2"))).toBe(true);
  });

  it("fails when the committed baseline adds a new file vs base", () => {
    const failures = evaluateBaselineGrowth(
      {
        counts: {
          "src/legacy.test.ts::lone-presence": 1,
          "src/new.test.ts::lone-presence": 1,
        },
      },
      { counts: { "src/legacy.test.ts::lone-presence": 1 } },
    );
    expect(failures.includes("baseline grew: new file src/new.test.ts")).toBe(true);
    expect(failures.length).toBe(1);
  });

  it("allows shrinking the baseline and first introduction (no base baseline)", () => {
    expect(
      evaluateBaselineGrowth(
        { counts: { "src/a.test.ts::lone-presence": 1 } },
        { counts: { "src/a.test.ts::lone-presence": 2 } },
      ),
    ).toEqual([]);
    expect(evaluateBaselineGrowth({ counts: { "src/a.test.ts::lone-presence": 5 } }, null)).toEqual(
      [],
    );
  });

  it("refuses --update-baseline that raises a file+rule count vs base", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-raise-"));
    temps.push(dir);
    writeFileSync(
      join(dir, "a.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("a", () => { expect(1).toBeTruthy(); });',
        'it("b", () => { expect(2).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    const baselinePath = join(dir, "baseline.json");
    const probed = run({ roots: [dir], fail: false, silent: true });
    const key = Object.keys(probed.counts)[0];
    expect(key).toMatch(/::lone-presence$/);
    expect(probed.counts[key]).toBe(2);
    const result = run({
      roots: [dir],
      updateBaseline: true,
      baselinePath,
      checkBaselineGrowth: true,
      baseBaseline: { counts: { [key]: 1 } },
      silent: true,
    });
    expect(result.exitCode).toBe(1);
    expect(
      result.growthFailures.some((f) => f.includes("baseline grew") && f.includes("2 > 1")),
    ).toBe(true);
    expect(existsSync(baselinePath)).toBe(false);
  });

  it("dry probe: exceed and stale also fail run()", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-ratchet-ex-"));
    temps.push(dir);
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(
      join(dir, "known.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("a", () => { expect(1).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    run({
      roots: [dir],
      updateBaseline: true,
      baselinePath,
      baseBaseline: null,
      silent: true,
    });
    writeFileSync(
      join(dir, "known.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("a", () => { expect(1).toBeTruthy(); });',
        'it("b", () => { expect(2).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    const exceed = run({
      roots: [dir],
      enforceRatchet: true,
      baselinePath,
      baseBaseline: null,
      silent: true,
    });
    expect(exceed.exitCode).toBe(1);
    expect(exceed.ratchetFailures.some((f) => f.includes("> baseline 1"))).toBe(true);

    // Stale: restore one finding but leave baseline at 2 via manual rewrite of counts.
    writeFileSync(
      join(dir, "known.test.ts"),
      [
        'import { it, expect } from "vitest";',
        'it("a", () => { expect(1).toBeTruthy(); });',
        "",
      ].join("\n"),
    );
    const key = Object.keys(exceed.counts)[0];
    writeBaseline({ [key]: 2 }, baselinePath);
    const stale = run({
      roots: [dir],
      enforceRatchet: true,
      baselinePath,
      baseBaseline: null,
      silent: true,
    });
    expect(stale.exitCode).toBe(1);
    expect(stale.ratchetFailures.some((f) => f.includes("shrink baseline"))).toBe(true);
  });

  it("parseFileRuleKey splits file::rule and treats bare keys as unknown kind", () => {
    expect(parseFileRuleKey("src/a.test.ts::lone-presence")).toEqual({
      file: "src/a.test.ts",
      kind: "lone-presence",
    });
    expect(parseFileRuleKey("orphan")).toEqual({ file: "orphan", kind: "?" });
  });

  it("reports unknown-kind messages for bare keys on exceed and stale", () => {
    expect(
      evaluateRatchet({ orphan: 2 }, { counts: { orphan: 1 } }).some(
        (f) => f.includes("orphan ?") && f.includes("> baseline 1"),
      ),
    ).toBe(true);
    expect(
      evaluateRatchet({ orphan: 0 }, { counts: { orphan: 2 } }).some(
        (f) => f.includes("orphan ?") && f.includes("shrink"),
      ),
    ).toBe(true);
    expect(
      evaluateBaselineGrowth({ counts: { orphan: 2 } }, { counts: { orphan: 1 } }).some(
        (f) => f.includes("orphan ?") && f.includes("2 > 1"),
      ),
    ).toBe(true);
  });

  it("dedupes new-file messages when one new file has multiple rules", () => {
    const ratchet = evaluateRatchet(
      { "new.test.ts::lone-presence": 1, "new.test.ts::mock-call-only": 1 },
      { counts: { "old.test.ts::lone-presence": 1 } },
    );
    expect(ratchet.filter((f) => f.includes("new file with findings")).length).toBe(1);

    const growth = evaluateBaselineGrowth(
      {
        counts: {
          "new.test.ts::lone-presence": 1,
          "new.test.ts::mock-call-only": 1,
        },
      },
      { counts: { "old.test.ts::lone-presence": 1 } },
    );
    expect(growth.filter((f) => f.includes("baseline grew: new file")).length).toBe(1);
  });

  it("rejects missing or non-object head baseline counts", () => {
    expect(evaluateBaselineGrowth(null, { counts: {} })).toEqual(["missing head baseline"]);
    expect(evaluateBaselineGrowth({}, { counts: {} })).toEqual(["missing head baseline"]);
    expect(evaluateBaselineGrowth({ counts: "bad" }, { counts: {} })).toEqual([
      "missing head baseline",
    ]);
    expect(evaluateRatchet({}, { counts: "bad" })).toEqual([
      "missing baseline; run test-smell-lint --update-baseline",
    ]);
  });

  it("treats non-object base baseline counts as first introduction", () => {
    expect(
      evaluateBaselineGrowth({ counts: { "a::lone-presence": 1 } }, { counts: "bad" }),
    ).toEqual([]);
  });

  it("writeBaseline totals counts and loadBaseline returns null when missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "smell-baseline-io-"));
    temps.push(dir);
    const baselinePath = join(dir, "baseline.json");
    const written = writeBaseline(
      { "a.test.ts::lone-presence": 2, "b.test.ts::mock-call-only": 3 },
      baselinePath,
    );
    expect(written.total).toBe(5);
    expect(loadBaseline(baselinePath)?.total).toBe(5);
    expect(loadBaseline(join(dir, "missing.json"))).toBeNull();
  });

  it("resolveBaselineBaseRef prefers --base, then env, skipping zero SHA", () => {
    expect(resolveBaselineBaseRef(["node", "x", "--base", "explicit"], {}, () => false)).toBe(
      "explicit",
    );
    expect(() => resolveBaselineBaseRef(["node", "x", "--base"], {}, () => false)).toThrow(
      /Missing value for argument --base/,
    );
    expect(() =>
      resolveBaselineBaseRef(["node", "x", "--base", "--other"], {}, () => false),
    ).toThrow(/Missing value for argument --base/);
    expect(
      resolveBaselineBaseRef(["node", "x"], { SMELL_BASELINE_BASE: "from-smell" }, () => false),
    ).toBe("from-smell");
    expect(
      resolveBaselineBaseRef(
        ["node", "x"],
        { SMELL_BASELINE_BASE: ZERO_SHA, PR_SIZE_BASE: "from-pr-size" },
        () => false,
      ),
    ).toBe("from-pr-size");
    expect(resolveBaselineBaseRef(["node", "x"], {}, (ref) => ref === "origin/main")).toBe(
      "origin/main",
    );
    expect(resolveBaselineBaseRef(["node", "x"], {}, () => false)).toBeNull();
  });
});

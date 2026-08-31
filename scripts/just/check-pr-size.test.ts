import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as checkPrSize from "./check-pr-size.cjs";

const { evaluateChangeSize, globToRegExp, isReviewable, parseAllowlist, parseArgs } = checkPrSize;

const CASSETTE_RATIONALE = "recorded upstream responses, verified by replay rather than by reading";
const SPLIT_RATIONALE = "one migration and the code that reads it; splitting ships a broken schema";

/** git numstat: added, deleted, path. */
function numstat(rows: [number | "-", number | "-", string][]) {
  return rows.map(([added, deleted, file]) => `${added}\t${deleted}\t${file}`).join("\n");
}

function evaluate(
  rows: [number | "-", number | "-", string][],
  options: { allowlist?: string; branch?: string | null; limit?: number } = {},
) {
  return evaluateChangeSize({
    numstat: numstat(rows),
    allowlist: parseAllowlist(options.allowlist),
    branch: options.branch === undefined ? "feature/x" : options.branch,
    limit: options.limit,
  });
}

describe("change size evaluation", () => {
  it("passes a change the size of the pull requests that drew no review rounds", () => {
    const result = evaluate([
      [30, 10, "src/a.ts"],
      [16, 0, "src/b.ts"],
    ]);

    expect(result.addedLines).toBe(46);
    expect(result.files).toBe(2);
    expect(result.overLimit).toBe(false);
  });

  it("passes the 651-line change that drew five rounds, and fails the 3011-line one that drew twenty", () => {
    expect(evaluate([[651, 15, "scripts/just/deploy-supabase.cjs"]]).overLimit).toBe(false);
    expect(evaluate([[3011, 235, "src/lib/mcp/health/medications.ts"]]).overLimit).toBe(true);
  });

  it("counts added lines only, so a large deletion is not treated as review surface", () => {
    const result = evaluate([[10, 5000, "src/legacy.ts"]]);

    expect(result.addedLines).toBe(10);
    expect(result.overLimit).toBe(false);
  });

  it("excludes a lockfile without needing an allowlist entry", () => {
    const result = evaluate([
      [40000, 20000, "package-lock.json"],
      [12, 0, "package.json"],
    ]);

    expect(result.addedLines).toBe(12);
    expect(result.excludedAdded).toBe(40000);
    expect(result.overLimit).toBe(false);
  });

  it("excludes the generated skill mirror but counts the source it is generated from", () => {
    const result = evaluate([
      [200, 0, ".claude/skills/pr-review-follow-through/SKILL.md"],
      [200, 0, ".agents/skills/pr-review-follow-through/SKILL.md"],
    ]);

    expect(result.addedLines).toBe(200);
  });

  it("excludes an allowlisted path, which is the recorded-cassette case", () => {
    const result = evaluate(
      [
        [112000, 0, "test/fixtures/tbank/cassettes/dense-month/operations.json"],
        [300, 20, "browserExtension/src/connectors/tbank-web.ts"],
      ],
      { allowlist: `path test/fixtures/** # ${CASSETTE_RATIONALE}` },
    );

    expect(result.addedLines).toBe(300);
    expect(result.excludedAdded).toBe(112000);
    expect(result.overLimit).toBe(false);
  });

  it("counts a binary file as no lines rather than failing on git's dash", () => {
    const result = evaluate([
      ["-", "-", "public/logo.png"],
      [5, 0, "src/a.ts"],
    ]);

    expect(result.addedLines).toBe(5);
  });

  it("attributes a braced rename to the path a reviewer opens, not the one it left", () => {
    const result = evaluate([[900, 0, "{src => test/fixtures}/big.json"]], {
      allowlist: `path test/fixtures/** # ${CASSETTE_RATIONALE}`,
    });

    expect(result.addedLines).toBe(0);
  });

  it("keeps the unchanged part of a braced rename, so the new path stays whole", () => {
    // git writes the common prefix outside the braces: this is src/test/fixtures/big.json, which
    // an allowlist rooted at test/fixtures does not cover.
    const result = evaluate([[900, 0, "src/{old => test/fixtures}/big.json"]], {
      allowlist: `path test/fixtures/** # ${CASSETTE_RATIONALE}`,
    });

    expect(result.addedLines).toBe(900);
  });

  it("attributes an unbraced rename to its new path", () => {
    const result = evaluate([[900, 0, "src/old.json => test/fixtures/new.json"]], {
      allowlist: `path test/fixtures/** # ${CASSETTE_RATIONALE}`,
    });

    expect(result.addedLines).toBe(0);
  });

  it("exempts an allowlisted branch but still reports it as over the limit", () => {
    const result = evaluate([[3011, 0, "src/big.ts"]], {
      allowlist: `branch feature/x # ${SPLIT_RATIONALE}`,
    });

    expect(result.overLimit).toBe(true);
    expect(result.branchExemption?.rationale).toBe(SPLIT_RATIONALE);
  });

  it("does not let one branch's exemption cover another", () => {
    const result = evaluate([[3011, 0, "src/big.ts"]], {
      allowlist: `branch other/branch # ${SPLIT_RATIONALE}`,
      branch: "feature/x",
    });

    expect(result.branchExemption).toBeUndefined();
  });

  it("claims no branch exemption when the checkout names no branch", () => {
    const result = evaluate([[3011, 0, "src/big.ts"]], {
      allowlist: `branch feature/x # ${SPLIT_RATIONALE}`,
      branch: null,
    });

    expect(result.overLimit).toBe(true);
    expect(result.branchExemption).toBeUndefined();
  });

  it("names the largest files, because those are what a split separates", () => {
    const result = evaluate([
      [100, 0, "src/small.ts"],
      [900, 0, "src/huge.ts"],
    ]);

    expect(result.largest[0]).toEqual({ path: "src/huge.ts", added: 900 });
  });

  it("passes an empty diff", () => {
    expect(evaluate([]).addedLines).toBe(0);
    expect(evaluate([]).overLimit).toBe(false);
  });

  it("treats the limit as inclusive, so exactly the limit passes", () => {
    expect(evaluate([[1500, 0, "src/a.ts"]]).overLimit).toBe(false);
    expect(evaluate([[1501, 0, "src/a.ts"]]).overLimit).toBe(true);
  });

  it("uses the shipped limit when none is passed", () => {
    expect(checkPrSize.MAX_REVIEWABLE_ADDED_LINES).toBe(1500);
    expect(evaluate([[1501, 0, "src/a.ts"]], { limit: undefined }).limit).toBe(1500);
  });
});

describe("glob matching", () => {
  it("stops a single star at a slash", () => {
    expect(globToRegExp("test/*.json").test("test/a.json")).toBe(true);
    expect(globToRegExp("test/*.json").test("test/nested/a.json")).toBe(false);
  });

  it("crosses slashes with a double star", () => {
    expect(globToRegExp("test/**/cassettes/**").test("test/fixtures/x/cassettes/a/b.json")).toBe(
      true,
    );
  });

  it("matches a dot literally rather than as any character", () => {
    expect(globToRegExp("a.json").test("axjson")).toBe(false);
  });

  it("anchors at both ends, so a prefix is not a match", () => {
    expect(globToRegExp("src/a.ts").test("other/src/a.ts")).toBe(false);
  });
});

describe("reviewability", () => {
  it("treats ordinary source as reviewable", () => {
    expect(isReviewable("src/lib/mcp/health/medications.ts", [])).toBe(true);
  });

  it("treats a generated DB type file as not reviewable", () => {
    expect(isReviewable("src/types/database.types.ts", [])).toBe(false);
  });

  it("ignores a branch entry when deciding whether a path is reviewable", () => {
    const allowlist = parseAllowlist(`branch src/big.ts # ${SPLIT_RATIONALE}`);

    expect(isReviewable("src/big.ts", allowlist)).toBe(true);
  });
});

describe("allowlist parsing", () => {
  it("reads a path entry and the rationale that justifies it", () => {
    expect(parseAllowlist(`path test/fixtures/** # ${CASSETTE_RATIONALE}`)).toEqual([
      { kind: "path", value: "test/fixtures/**", rationale: CASSETTE_RATIONALE },
    ]);
  });

  it("reads a branch entry", () => {
    expect(parseAllowlist(`branch feature/x # ${SPLIT_RATIONALE}`)).toEqual([
      { kind: "branch", value: "feature/x", rationale: SPLIT_RATIONALE },
    ]);
  });

  it("rejects an entry with no rationale, so the exemption cannot skip its reason", () => {
    expect(() => parseAllowlist("path test/fixtures/**")).toThrow("Malformed allowlist entry");
    expect(() => parseAllowlist("path test/fixtures/** #")).toThrow("Malformed allowlist entry");
  });

  it("rejects an entry with no kind, so a bare glob cannot exempt itself", () => {
    expect(() => parseAllowlist(`test/fixtures/** # ${CASSETTE_RATIONALE}`)).toThrow(
      "Malformed allowlist entry",
    );
  });

  it("keeps whole-line comments and blank lines out of the entries", () => {
    expect(parseAllowlist(`# a header\n\npath a/** # ${CASSETTE_RATIONALE}\n`)).toHaveLength(1);
  });

  it("treats a missing or empty file as no exemptions", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });
});

describe("base ref resolution", () => {
  const script = path.join(__dirname, "check-pr-size.cjs");

  function runScript(args: string[], env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, PR_SIZE_BASE: "", PR_SIZE_BRANCH: "", ...env },
    });
  }

  it("fails rather than skipping when an explicitly requested base cannot be resolved", () => {
    const result = runScript(["--base", "no/such/ref"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve base ref 'no/such/ref'");
  });

  it("fails on an unresolvable base supplied through the environment, as CI supplies it", () => {
    const result = runScript([], { PR_SIZE_BASE: "no/such/ref" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve base ref");
  });

  // These assert that a base was resolved and measured against, not what the verdict was: the
  // verdict depends on how large the working tree happens to be, and a test that reads it would
  // fail on any branch legitimately over the limit -- including one raising the limit.
  function resolvedAgainst(result: ReturnType<typeof runScript>) {
    expect(result.status, result.stderr).toBeLessThan(2);
    return `${result.stdout}${result.stderr}`;
  }

  it("checks against the base it was given", () => {
    expect(resolvedAgainst(runScript([], { PR_SIZE_BASE: "origin/main" }))).toContain(
      "origin/main",
    );
  });

  it("treats the zero sha as no baseline rather than an unresolvable ref", () => {
    expect(resolvedAgainst(runScript([], { PR_SIZE_BASE: checkPrSize.ZERO_SHA }))).toContain(
      "origin/main",
    );
  });

  it("falls back to the default base when none is requested", () => {
    expect(resolvedAgainst(runScript([]))).toMatch(/against origin\/main|reviewable lines against/);
  });
});

describe("argument parsing", () => {
  it("reads an explicit base ref and branch", () => {
    expect(parseArgs(["--base", "origin/release", "--branch", "feature/x"])).toEqual({
      base: "origin/release",
      branch: "feature/x",
    });
  });

  it("defaults to no explicit base or branch", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["--base"])).toThrow("Missing value for argument --base");
    expect(() => parseArgs(["--branch", "--base", "x"])).toThrow(
      "Missing value for argument --branch",
    );
  });
});

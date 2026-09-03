import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as checkPrSize from "./check-pr-size.cjs";

const {
  evaluateChangeSize,
  formatFailure,
  formatWarning,
  globToRegExp,
  isPushToDefaultBranch,
  isReviewable,
  parseAllowlist,
  parseArgs,
} = checkPrSize;

const CASSETTE_RATIONALE = "recorded upstream responses, verified by replay rather than by reading";
const SPLIT_RATIONALE = "one migration and the code that reads it; splitting ships a broken schema";

/** git numstat: added, deleted, path. */
function numstat(rows: [number | "-", number | "-", string][]) {
  return rows.map(([added, deleted, file]) => `${added}\t${deleted}\t${file}`).join("\n");
}

function evaluate(
  rows: [number | "-", number | "-", string][],
  options: {
    allowlist?: string;
    branch?: string | null;
    limit?: number;
    warnAt?: number;
  } = {},
) {
  return evaluateChangeSize({
    numstat: numstat(rows),
    allowlist: parseAllowlist(options.allowlist),
    branch: options.branch === undefined ? "feature/x" : options.branch,
    limit: options.limit,
    warnAt: options.warnAt,
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

  it("steps aside on a push to main and nowhere else", () => {
    // A merge commit on main, measured against the commit before it, is the whole pull request
    // once more -- with no branch name for its allowlist entry to match. The gate has already
    // had its say on the pull request; main carries what was merged. Decided from the event
    // Actions reports, not from a branch name: a pull request from a fork may call its head
    // branch `main`, and must be measured like any other.
    expect(
      isPushToDefaultBranch({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" }),
    ).toBe(true);
    expect(
      isPushToDefaultBranch({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/pull/96/merge",
        PR_SIZE_BRANCH: "main",
      }),
    ).toBe(false);
    expect(
      isPushToDefaultBranch({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature/x" }),
    ).toBe(false);
    expect(isPushToDefaultBranch({})).toBe(false);
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

describe("the warning band below the limit", () => {
  it("warns while the branch still fits, which is while the cut can still be changed", () => {
    const result = evaluate([[1200, 0, "src/a.ts"]]);

    expect(result.overLimit).toBe(false);
    expect(result.nearLimit).toBe(true);
  });

  it("stays quiet below the mark", () => {
    expect(evaluate([[1125, 0, "src/a.ts"]]).nearLimit).toBe(false);
    expect(evaluate([[1126, 0, "src/a.ts"]]).nearLimit).toBe(true);
  });

  it("reports over the limit as over, not as near it", () => {
    const result = evaluate([[1501, 0, "src/a.ts"]]);

    expect(result.overLimit).toBe(true);
    expect(result.nearLimit).toBe(false);
  });

  it("defaults the mark to three quarters of the limit", () => {
    expect(checkPrSize.WARNING_FRACTION).toBe(0.75);
    expect(evaluate([[10, 0, "src/a.ts"]]).warnAt).toBe(1125);
  });

  it("takes an explicit mark", () => {
    expect(evaluate([[20, 0, "src/a.ts"]], { warnAt: 10 }).nearLimit).toBe(true);
  });
});

describe("what the failure tells the agent to do", () => {
  const failure = formatFailure(evaluate([[1501, 0, "src/a.ts"]]), "origin/main");

  // This text is the only part of the policy an agent reliably reads, because it arrives at the
  // moment the decision is made. An earlier version opened with "Split the branch", which is the
  // move docs/QUALITY.md rules out -- and the reason branches came out sliced into pieces that did
  // not stand on their own.
  it("names the milestone as the unit, before any move", () => {
    expect(failure).toContain("One pull request is one milestone");
    expect(failure.indexOf("One pull request is one milestone")).toBeLessThan(
      failure.indexOf("Re-cut on a milestone boundary"),
    );
  });

  it("gives the three moves in the order the policy puts them", () => {
    expect(failure.indexOf("Re-cut on a milestone boundary")).toBeLessThan(
      failure.indexOf("Stack --"),
    );
    expect(failure.indexOf("Stack --")).toBeLessThan(failure.indexOf("Allowlist the branch"));
  });

  it("rules out slicing a finished branch, and says splitting is not free", () => {
    expect(failure).toContain("Do not slice a finished branch");
    expect(failure).toContain("one opening review");
  });

  it("still names the largest files and the base it measured against", () => {
    expect(failure).toContain("src/a.ts");
    expect(failure).toContain("origin/main");
  });

  it("warns with the room left, and with the same moves", () => {
    const warning = formatWarning(evaluate([[1200, 0, "src/a.ts"]]), "origin/main");

    expect(warning).toContain("[pr-size]");
    expect(warning).toContain("300 short of the limit");
    expect(warning).toContain("Re-cut on a milestone boundary");
  });

  it("says CI will fail when an advisory run is already over the limit", () => {
    expect(formatWarning(evaluate([[1501, 0, "src/a.ts"]]), "origin/main")).toContain(
      "CI will fail on it",
    );
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

  it("treats the generated DB artifacts as not reviewable", () => {
    // The paths they actually have. This assertion previously named
    // `src/types/database.types.ts`, a file that does not exist, so it passed while the rule it
    // stands for matched nothing — and the miss was invisible because the artifacts were never
    // being regenerated.
    expect(isReviewable("supabase/db/schema.snapshot.sql", [])).toBe(false);
    expect(isReviewable("supabase/db/database.types.ts", [])).toBe(false);
  });

  it("still reads the hand-written SQL that sits beside them", () => {
    expect(isReviewable("supabase/db/functions/get_record_conditions.sql", [])).toBe(true);
    expect(isReviewable("supabase/db/policies/mcp_oauth.sql", [])).toBe(true);
    expect(isReviewable("src/types/database.ts", [])).toBe(true);
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

describe("the base a pull request run measures against", () => {
  const script = path.join(__dirname, "check-pr-size.cjs");
  const workflow = readFileSync(
    path.join(__dirname, "..", "..", ".github", "workflows", "main.yml"),
    "utf8",
  );

  it("is the first parent of the merge ref, not the base sha the event recorded", () => {
    // refs/pull/N/merge is a merge of the head into the base branch as it stands when the run is
    // created; HEAD^1 is that base tip. github.event.pull_request.base.sha is the base when the
    // event fired, and the tree contains everything merged since -- T-260902-h3e.
    expect(workflow).toMatch(
      /PR_SIZE_BASE: \$\{\{ github\.event_name == 'pull_request' && 'HEAD\^1' \|\| github\.event\.before \}\}/,
    );
    expect(workflow).toMatch(
      /MIGRATION_ORDER_BASE: \$\{\{ github\.event_name == 'pull_request' && 'HEAD\^1' \|\| github\.event\.before \}\}/,
    );
    expect(workflow).not.toMatch(/PR_SIZE_BASE: .*pull_request\.base\.sha/);
  });

  /** A repository shaped like a pull request run's checkout: the branch merged into a base that
   * moved on after the pull request was opened. Returns the base sha the event would have carried. */
  function buildMergeRefRepository(dir: string) {
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    const write = (name: string, lines: number) =>
      writeFileSync(
        path.join(dir, name),
        Array.from({ length: lines }, (_, i) => `${name} ${i}`).join("\n") + "\n",
      );

    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    write("base.ts", 5);
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const eventBaseSha = git("rev-parse", "HEAD");

    git("switch", "-q", "-c", "feature");
    write("feature.ts", 10);
    git("add", ".");
    git("commit", "-q", "-m", "the branch's own change");

    git("switch", "-q", "main");
    write("other.ts", 100);
    git("add", ".");
    git("commit", "-q", "-m", "somebody else's pull request, merged meanwhile");

    // What actions/checkout checks out for a pull_request event.
    git("merge", "-q", "--no-ff", "-m", "refs/pull/1/merge", "feature");
    return eventBaseSha;
  }

  function measure(dir: string, base: string) {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PR_SIZE_REPO_ROOT: dir,
        PR_SIZE_BASE: base,
        PR_SIZE_BRANCH: "pr-size-merge-ref-fixture",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    return `${result.stdout}${result.stderr}`;
  }

  it("charges the branch for its own lines only when measured from the merge ref's first parent", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pr-size-merge-ref-"));
    try {
      const eventBaseSha = buildMergeRefRepository(dir);

      expect(measure(dir, "HEAD^1")).toContain("10 reviewable line(s) added across 1 file(s)");
      // The defect, kept as the counter-example: against the event's base sha the branch is
      // charged for the 100 lines somebody else merged while it waited.
      expect(measure(dir, eventBaseSha)).toContain("110 reviewable line(s) added across 2 file(s)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("base ref resolution", () => {
  const script = path.join(__dirname, "check-pr-size.cjs");

  function runScript(args: string[], env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      // A named branch rather than "": empty makes the script fall back to the checkout's real
      // branch, so these tests would report on whichever branch happens to run them -- and pass or
      // fail depending on whether that branch is in `.large-change-allowlist`. This name is not,
      // and never should be, so what they measure is the base resolution they are about.
      env: {
        ...process.env,
        PR_SIZE_BASE: "",
        PR_SIZE_BRANCH: "pr-size-base-resolution-fixture",
        ...env,
      },
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

  // Whatever this tree happens to measure: an advisory run is a hook, and a hook that can fail a
  // commit or an edit is one somebody uninstalls. Enforcement is pre-push and CI.
  // `git push origin some-other-branch` pushes a ref that is not HEAD. Measuring the working tree
  // there reports on the wrong change, and the oversized ref goes out with the gate green.
  it("measures a head revision that is not the checkout", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" }).stdout.trim();
    const result = runScript(["--base", "origin/main", "--head", head]);

    expect(result.status, result.stderr).toBeLessThan(2);
    expect(`${result.stdout}${result.stderr}`).toContain("origin/main");
  });

  it("takes the base a stacked branch records in git config", () => {
    const branch = `pr-size-test-${process.pid}`;
    spawnSync("git", ["config", `branch.${branch}.prBase`, "origin/main"]);
    try {
      const result = runScript(["--branch", branch]);

      expect(result.status, result.stderr).toBeLessThan(2);
      expect(`${result.stdout}${result.stderr}`).toContain("origin/main");
    } finally {
      spawnSync("git", ["config", "--remove-section", `branch.${branch}`]);
    }
  });

  it("never fails in advisory mode, whatever the branch measures", () => {
    const result = runScript(["--advisory", "--warn-at", "0"]);

    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps advisory output off stdout, so a hook can parse its own", () => {
    expect(runScript(["--advisory", "--warn-at", "0"]).stdout).toBe("");
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

  it("reads the head revision, so a pushed ref that is not the checkout can be measured", () => {
    expect(parseArgs(["--head", "abc123", "--branch", "feature/x"])).toEqual({
      head: "abc123",
      branch: "feature/x",
    });
  });

  it("reads the advisory flag and the warning mark", () => {
    expect(parseArgs(["--advisory", "--warn-at", "800"])).toEqual({
      advisory: true,
      warnAt: "800",
    });
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["--base"])).toThrow("Missing value for argument --base");
    expect(() => parseArgs(["--branch", "--base", "x"])).toThrow(
      "Missing value for argument --branch",
    );
  });
});

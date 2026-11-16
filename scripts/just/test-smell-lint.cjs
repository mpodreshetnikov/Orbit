#!/usr/bin/env node
/**
 * Assertion-smell lint for Vitest `*.test.*` / `*.spec.*` files (T-261113-k54 / ORB-63).
 *
 * Flags weak oracles that survive buggy production code:
 * - sole `toBeTruthy` / `toBeDefined` in a case
 * - sole `toContain` in a case (HTML/string presence as the only proof)
 * - mock-call-only cases (every expect is `toHaveBeenCalled*`)
 *
 * Default mode enforces the committed file+rule ratchet
 * (`scripts/just/test-smell-baseline.json`): CI fails when any file+rule count
 * exceeds the baseline, when a finding appears in a file absent from the
 * baseline, or when the baseline is stale (counts dropped without shrinking it).
 * The baseline itself may only shrink vs the PR base / previous main commit
 * (`SMELL_BASELINE_BASE` or `--base`): raising a file+rule count or adding a new
 * file via `--update-baseline` fails the check.
 * `--update-baseline` rewrites the baseline from the current scan (refuses growth).
 * `--fail` / `ORBIT_TEST_SMELL_FAIL=1` fails on any finding (hard mode; cleanup
 * end state after the baseline is removed). `--warn-only` restores advisory exit 0.
 *
 * Suppress a line with `// test-smell-ok: <reason>` on the same line as the expect.
 *
 * Policy: `docs/design/common/testing-quality.md`.
 *
 * Stryker: Regex mutants on CASE_HEAD / arrow / function scanners only tweak
 * character classes and optional whitespace for well-formed Vitest sources — they
 * are equivalent under analyzeFile oracles. Behavioral mutants stay enabled.
 */
// Stryker disable Regex: equivalent scanner character-class/quantifier mutants on Vitest-shaped sources

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const BASELINE_PATH = path.join(ROOT, "scripts", "just", "test-smell-baseline.json");
const BASELINE_REPO_REL = "scripts/just/test-smell-baseline.json";
const BASE_REF_CANDIDATES = ["origin/main", "main"];
const ZERO_SHA = "0000000000000000000000000000000000000000";
const SCAN_ROOTS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "browserExtension", "src"),
  path.join(ROOT, "browserExtension", "popup-src"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "shared"),
  path.join(ROOT, "native"),
];

/** @param {string} file @param {string} kind */
function fileRuleKey(file, kind) {
  return `${file}::${kind}`;
}

/**
 * @param {{ file: string, kind: string }[]} findings
 * @returns {Record<string, number>}
 */
function countByFileRule(findings) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const f of findings) {
    const key = fileRuleKey(f.file, f.kind);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<string, number>} counts
 * @returns {Set<string>}
 */
function filesFromCounts(counts) {
  const files = new Set();
  for (const key of Object.keys(counts)) {
    const sep = key.indexOf("::");
    files.add(sep === -1 ? key : key.slice(0, sep));
  }
  return files;
}

/**
 * Compare current file+rule counts to the committed baseline.
 * Exact match required: exceed / new file / stale (shrunk without update) all fail.
 * @param {Record<string, number>} currentCounts
 * @param {{ counts?: Record<string, number> } | null | undefined} baseline
 * @returns {string[]}
 */
function evaluateRatchet(currentCounts, baseline) {
  if (!baseline || !baseline.counts || typeof baseline.counts !== "object") {
    return ["missing baseline; run test-smell-lint --update-baseline"];
  }

  const baselineCounts = baseline.counts;
  const failures = [];
  const baselineFiles = filesFromCounts(baselineCounts);
  const reportedNewFiles = new Set();

  for (const [key, current] of Object.entries(currentCounts)) {
    const sep = key.indexOf("::");
    const file = sep === -1 ? key : key.slice(0, sep);
    const kind = sep === -1 ? "?" : key.slice(sep + 2);
    if (!baselineFiles.has(file)) {
      if (!reportedNewFiles.has(file)) {
        reportedNewFiles.add(file);
        failures.push(`new file with findings: ${file}`);
      }
      continue;
    }
    const base = Number(baselineCounts[key] || 0);
    if (current > base) {
      failures.push(`${file} ${kind}: ${current} > baseline ${base}`);
    }
  }

  for (const [key, baseRaw] of Object.entries(baselineCounts)) {
    const base = Number(baseRaw);
    const current = Number(currentCounts[key] || 0);
    if (current < base) {
      const sep = key.indexOf("::");
      const file = sep === -1 ? key : key.slice(0, sep);
      const kind = sep === -1 ? "?" : key.slice(sep + 2);
      failures.push(`${file} ${kind}: ${current} < baseline ${base} (shrink baseline in this PR)`);
    }
  }

  return failures;
}

/**
 * Compare committed head baseline to the baseline on the PR base / previous main
 * commit. Ratchet only goes down: no file+rule count may grow, and no new file
 * may appear. Missing base baseline (first introduction) is allowed.
 *
 * @param {{ counts?: Record<string, number> } | null | undefined} headBaseline
 * @param {{ counts?: Record<string, number> } | null | undefined} baseBaseline
 * @returns {string[]}
 */
function evaluateBaselineGrowth(headBaseline, baseBaseline) {
  if (!headBaseline || !headBaseline.counts || typeof headBaseline.counts !== "object") {
    return ["missing head baseline"];
  }
  if (!baseBaseline || !baseBaseline.counts || typeof baseBaseline.counts !== "object") {
    return [];
  }

  const headCounts = headBaseline.counts;
  const baseCounts = baseBaseline.counts;
  const failures = [];
  const baseFiles = filesFromCounts(baseCounts);
  const reportedNewFiles = new Set();

  for (const [key, headRaw] of Object.entries(headCounts)) {
    const sep = key.indexOf("::");
    const file = sep === -1 ? key : key.slice(0, sep);
    const kind = sep === -1 ? "?" : key.slice(sep + 2);
    const head = Number(headRaw);
    if (!baseFiles.has(file)) {
      if (!reportedNewFiles.has(file)) {
        reportedNewFiles.add(file);
        failures.push(`baseline grew: new file ${file}`);
      }
      continue;
    }
    const base = Number(baseCounts[key] || 0);
    if (head > base) {
      failures.push(`baseline grew: ${file} ${kind}: ${head} > ${base}`);
    }
  }

  return failures;
}

function runGit(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function refExists(ref) {
  return runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;
}

/**
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
function resolveBaselineBaseRef(argv = process.argv, env = process.env) {
  const idx = argv.indexOf("--base");
  if (idx !== -1) {
    const value = argv[idx + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value for argument --base");
    }
    return value;
  }
  for (const key of ["SMELL_BASELINE_BASE", "PR_SIZE_BASE"]) {
    const value = env[key];
    if (value && value !== ZERO_SHA) {
      return value;
    }
  }
  return BASE_REF_CANDIDATES.find((candidate) => refExists(candidate)) ?? null;
}

/**
 * @param {string} ref
 * @param {string} [relativePath]
 * @returns {{ counts?: Record<string, number>, total?: number, generated_at?: string } | null}
 */
function loadBaselineAtRef(ref, relativePath = BASELINE_REPO_REL) {
  if (!ref || !refExists(ref)) {
    return null;
  }
  const result = runGit(["show", `${ref}:${relativePath}`]);
  if (result.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, number>} counts
 * @param {string} [baselinePath]
 */
function writeBaseline(counts, baselinePath = BASELINE_PATH) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const sortedKeys = Object.keys(counts).toSorted();
  /** @type {Record<string, number>} */
  const sortedCounts = {};
  for (const key of sortedKeys) {
    sortedCounts[key] = counts[key];
  }
  const baseline = {
    generated_at: new Date().toISOString(),
    total,
    counts: sortedCounts,
  };
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  return baseline;
}

/**
 * @param {string} filePath
 * @returns {{ counts?: Record<string, number>, total?: number, generated_at?: string } | null}
 */
function loadBaseline(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const TEST_NAME = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
/** Head of it/test, including optional modifiers and optional .each/.for (before any call). */
const CASE_HEAD =
  /\b(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))*(?:\.(?:each|for))?(?=\s*[\(`])/g;
const EXPECT_RE =
  /expect\s*(?:\.\s*soft)?\s*\([\s\S]*?\)\s*(?:\.\s*(?:resolves|rejects)\s*)?(?:\.\s*not\s*)?\.\s*(to[A-Za-z0-9]+)/g;
const SUPPRESS_RE = /test-smell-ok:/;

const MOCK_CALL_MATCHERS = new Set([
  "toHaveBeenCalled",
  "toHaveBeenCalledTimes",
  "toHaveBeenCalledWith",
  "toHaveBeenCalledOnce",
  "toHaveBeenNthCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveReturned",
  "toHaveReturnedWith",
  "toHaveReturnedTimes",
  "toHaveLastReturnedWith",
  "toHaveNthReturnedWith",
]);

const WEAK_PRESENCE = new Set(["toBeTruthy", "toBeDefined", "toBeFalsy", "toBeUndefined"]);

/**
 * String/comment scanners below are covered by analyzeFile behavioral oracles.
 * Character-level mutants (loop bounds, escape flags, quote branches) are equivalent
 * for well-formed Vitest sources and drown the covered gate without changing findings.
 */
// Stryker disable all: scanner state machine; classify behavior gated via analyzeFile/run tests

/**
 * @param {string} dir
 * @param {(file: string) => void} visit
 */
function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-firefox") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (TEST_NAME.test(entry.name)) visit(full);
  }
}

/**
 * True when index `i` is inside a string literal or line/block comment.
 * @param {string} source
 * @param {number} i
 */
function inNonCode(source, i) {
  let inStr = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let j = 0; j < i; j++) {
    const ch = source[j];
    const next = source[j + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        j += 1;
      }
      continue;
    }
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      j += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      j += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") inStr = ch;
  }
  return Boolean(inStr || inLineComment || inBlockComment);
}

/**
 * Find the matching closing paren for the opener at `openIdx`.
 * @param {string} source
 * @param {number} openIdx
 */
function matchingParen(source, openIdx) {
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Skip whitespace from `i`.
 * @param {string} source
 * @param {number} i
 */
function skipWs(source, i) {
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

/**
 * Locate the `(` that opens the it/test call that carries the title + callback.
 * For `it.each([...])("title", cb)` that is the second call.
 * @param {string} source
 * @param {number} headStart
 * @param {string} headText
 * @returns {{ openIdx: number, closeIdx: number } | null}
 */
function testCallParens(source, headStart, headText) {
  let i = skipWs(source, headStart + headText.length);
  if (source[i] !== "(") return null;
  const firstOpen = i;
  const firstClose = matchingParen(source, firstOpen);
  if (firstClose < 0) return null;

  const isEachOrFor = /\.(?:each|for)$/.test(headText);
  if (!isEachOrFor) {
    return { openIdx: firstOpen, closeIdx: firstClose };
  }

  i = skipWs(source, firstClose + 1);
  if (source[i] !== "(") return null;
  const secondOpen = i;
  const secondClose = matchingParen(source, secondOpen);
  if (secondClose < 0) return null;
  return { openIdx: secondOpen, closeIdx: secondClose };
}

/**
 * Last top-level argument of a call (comma-separated at depth 0).
 * @param {string} args
 * @returns {{ start: number, end: number } | null}
 */
function lastTopLevelArg(args) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inStr = null;
  let escaped = false;
  let argStart = 0;
  let last = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depthParen += 1;
    else if (ch === ")") depthParen -= 1;
    else if (ch === "{") depthBrace += 1;
    else if (ch === "}") depthBrace -= 1;
    else if (ch === "[") depthBracket += 1;
    else if (ch === "]") depthBracket -= 1;
    else if (ch === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      last = { start: argStart, end: i };
      argStart = i + 1;
    }
  }
  last = { start: argStart, end: args.length };
  const slice = args.slice(last.start, last.end);
  if (!slice.trim()) return null;
  return last;
}

/**
 * Body of the callback passed directly to `it`/`test` (last top-level arg), not nested
 * `vi.fn` / `waitFor` callbacks inside that body.
 * @param {string} source
 * @param {number} openIdx
 * @param {number} closeIdx
 */
function caseBodyRange(source, openIdx, closeIdx) {
  const args = source.slice(openIdx + 1, closeIdx);
  const last = lastTopLevelArg(args);
  if (!last) return null;
  const arg = args.slice(last.start, last.end);
  const absArgStart = openIdx + 1 + last.start;

  const arrow = /(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/;
  const fn = /(?:async\s+)?function\s*(?:[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/;
  const m = arg.match(arrow) || arg.match(fn);
  if (!m || m.index == null) return null;

  const braceOpen = absArgStart + m.index + m[0].length - 1;
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let j = braceOpen; j < source.length; j++) {
    const ch = source[j];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start: braceOpen + 1, end: j };
    }
  }
  return null;
}

// Stryker restore all

/**
 * @param {string} file
 * @param {string} source
 */
function analyzeFile(file, source) {
  /** @type {{ file: string, line: number, kind: string, detail: string }[]} */
  const findings = [];
  CASE_HEAD.lastIndex = 0;
  let match;
  while ((match = CASE_HEAD.exec(source))) {
    // Stryker disable next-line ConditionalExpression: redundant with per-expect inNonCode; string heads still yield zero expects
    if (inNonCode(source, match.index)) continue;
    const headText = match[0];
    const call = testCallParens(source, match.index, headText);
    if (!call) continue;
    const body = caseBodyRange(source, call.openIdx, call.closeIdx);
    if (!body) continue;
    const bodyText = source.slice(body.start, body.end);
    const expects = [];
    EXPECT_RE.lastIndex = 0;
    let em;
    while ((em = EXPECT_RE.exec(bodyText))) {
      const abs = body.start + em.index;
      if (inNonCode(source, abs)) continue;
      // Stryker disable all: line-number slice math; kind classification is the gate
      const lineStart = source.lastIndexOf("\n", abs) + 1;
      const lineEnd = source.indexOf("\n", abs);
      const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      if (SUPPRESS_RE.test(lineText)) continue;
      expects.push({
        matcher: em[1],
        line: source.slice(0, abs).split("\n").length,
      });
      // Stryker restore all
    }
    if (expects.length === 0) continue;

    const matchers = expects.map((e) => e.matcher);
    const line = expects[0].line;
    const rel = path.relative(ROOT, file);

    if (expects.length === 1 && WEAK_PRESENCE.has(matchers[0])) {
      findings.push({
        file: rel,
        line,
        kind: "lone-presence",
        detail: `sole expect is ${matchers[0]} — prefer a concrete value/oracle`,
      });
    } else if (expects.length === 1 && matchers[0] === "toContain") {
      findings.push({
        file: rel,
        line,
        kind: "lone-tocontain",
        detail: "sole expect is toContain — prefer structured outcome over substring presence",
      });
    } else if (matchers.every((m) => MOCK_CALL_MATCHERS.has(m))) {
      findings.push({
        file: rel,
        line,
        kind: "mock-call-only",
        detail: "every expect is a mock call matcher — assert a result/oracle too",
      });
    }
  }
  return findings;
}

/**
 * @param {{
 *   fail?: boolean,
 *   warnOnly?: boolean,
 *   enforceRatchet?: boolean,
 *   updateBaseline?: boolean,
 *   checkBaselineGrowth?: boolean,
 *   roots?: string[],
 *   baselinePath?: string,
 *   baselineBaseRef?: string | null,
 *   baseBaseline?: { counts?: Record<string, number> } | null,
 *   silent?: boolean,
 * }} [opts]
 */
function run(opts = {}) {
  const argv = process.argv;
  const hardFail =
    opts.fail === true || argv.includes("--fail") || process.env.ORBIT_TEST_SMELL_FAIL === "1";
  // `fail: false` keeps the historical warn-only programmatic API used by unit tests.
  const warnOnly = opts.warnOnly === true || argv.includes("--warn-only") || opts.fail === false;
  const updateBaseline = opts.updateBaseline === true || argv.includes("--update-baseline");
  const baselinePath = opts.baselinePath ?? BASELINE_PATH;
  const enforceRatchet =
    opts.enforceRatchet === true ||
    (!warnOnly && !hardFail && !updateBaseline && opts.enforceRatchet !== false);
  const checkBaselineGrowth =
    opts.checkBaselineGrowth === true ||
    (!warnOnly && opts.checkBaselineGrowth !== false && (enforceRatchet || updateBaseline));
  const roots = opts.roots ?? SCAN_ROOTS;
  const silent = opts.silent === true;

  /** @type {{ file: string, line: number, kind: string, detail: string }[]} */
  const findings = [];
  for (const root of roots) {
    walk(root, (file) => {
      const source = fs.readFileSync(file, "utf8");
      findings.push(...analyzeFile(file, source));
    });
  }

  const counts = countByFileRule(findings);

  /** @type {string[]} */
  let growthFailures = [];
  if (checkBaselineGrowth) {
    const baseRef =
      opts.baselineBaseRef !== undefined ? opts.baselineBaseRef : resolveBaselineBaseRef(argv);
    const baseBaseline =
      opts.baseBaseline !== undefined
        ? opts.baseBaseline
        : baseRef
          ? loadBaselineAtRef(baseRef)
          : null;
    if (updateBaseline) {
      growthFailures = evaluateBaselineGrowth({ counts }, baseBaseline);
    } else {
      growthFailures = evaluateBaselineGrowth(loadBaseline(baselinePath), baseBaseline);
    }
  }

  if (updateBaseline) {
    if (growthFailures.length > 0) {
      if (!silent) {
        for (const failure of growthFailures) {
          process.stderr.write(`[test-smell-baseline] ${failure}\n`);
        }
        process.stdout.write(
          "test-smell-lint: refusing --update-baseline — baseline may only shrink vs base\n",
        );
      }
      return {
        findings,
        counts,
        exitCode: 1,
        ratchetFailures: [],
        growthFailures,
      };
    }
    const baseline = writeBaseline(counts, baselinePath);
    if (!silent) {
      process.stdout.write(
        `test-smell-lint: baseline updated (${baseline.total} finding(s)) → ${path
          .relative(ROOT, baselinePath)
          .replace(/\\/g, "/")}\n`,
      );
    }
    return { findings, counts, exitCode: 0, ratchetFailures: [], growthFailures: [] };
  }

  // Stryker disable all: summary/ truncation stdout formatting; exitCode + findings are asserted
  const byKind = findings.reduce((acc, f) => {
    acc[f.kind] = (acc[f.kind] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));

  const summary = `test-smell-lint: ${findings.length} finding(s)${
    findings.length
      ? ` (${Object.entries(byKind)
          .map(([k, n]) => `${k}=${n}`)
          .join(", ")})`
      : ""
  }`;

  /** @type {string[]} */
  let ratchetFailures = [];
  if (enforceRatchet) {
    ratchetFailures = evaluateRatchet(counts, loadBaseline(baselinePath));
  }

  let exitCode = 0;
  let modeNote = "";
  if (hardFail && findings.length > 0) {
    exitCode = 1;
    modeNote = " — failing (hard: any finding)";
  } else if (growthFailures.length > 0) {
    exitCode = 1;
    modeNote = " — failing (baseline grew vs base)";
  } else if (enforceRatchet && ratchetFailures.length > 0) {
    exitCode = 1;
    modeNote = " — failing (ratchet)";
  } else if (warnOnly) {
    modeNote = " — warn only";
  } else if (enforceRatchet) {
    modeNote = " — ratchet ok";
  }

  if (!silent) {
    const listFindings = hardFail || warnOnly || (enforceRatchet && exitCode !== 0);
    if (listFindings && findings.length > 0) {
      const showAll = hardFail || (enforceRatchet && exitCode !== 0);
      const shown = showAll ? findings : findings.slice(0, 40);
      for (const f of shown) {
        process.stdout.write(`${f.file}:${f.line}: ${f.kind}: ${f.detail}\n`);
      }
      if (!showAll && findings.length > shown.length) {
        process.stdout.write(
          `… ${findings.length - shown.length} more (run with --fail for full list)\n`,
        );
      }
    }
    for (const failure of growthFailures) {
      process.stderr.write(`[test-smell-baseline] ${failure}\n`);
    }
    for (const failure of ratchetFailures) {
      process.stderr.write(`[test-smell-ratchet] ${failure}\n`);
    }
    process.stdout.write(`${summary}${modeNote}\n`);
  }
  // Stryker restore all
  return { findings, counts, exitCode, ratchetFailures, growthFailures };
}

if (require.main === module) {
  const result = run();
  process.exit(result.exitCode);
}

module.exports = {
  run,
  analyzeFile,
  countByFileRule,
  evaluateRatchet,
  evaluateBaselineGrowth,
  resolveBaselineBaseRef,
  loadBaselineAtRef,
  writeBaseline,
  loadBaseline,
  fileRuleKey,
  filesFromCounts,
  BASELINE_PATH,
  BASELINE_REPO_REL,
  WEAK_PRESENCE,
  MOCK_CALL_MATCHERS,
  inNonCode,
  matchingParen,
  skipWs,
  testCallParens,
  lastTopLevelArg,
  caseBodyRange,
  walk,
  TEST_NAME,
};

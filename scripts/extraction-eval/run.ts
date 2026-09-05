#!/usr/bin/env node
/**
 * Scored extraction eval.
 *
 *   just test-extraction                      replay recorded responses (free, offline)
 *   just test-extraction --live               call OpenRouter
 *   just test-extraction --live --record      call OpenRouter and refresh the cassettes
 *   just test-extraction --case 001           run a subset
 *   just test-extraction --live --repeat 3    run each case 3 times and report the spread
 *
 * Exits 0 regardless of score unless --fail-under is given. Scores are a report, not a gate:
 * with a small corpus a threshold is noise, and case 001 deliberately fails one dimension.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCassetteFetch, type CassetteMode } from "./cassette.ts";
import { loadCases } from "./corpus.ts";
import { CASSETTES_ROOT, DEFAULT_OUT_DIR, REPO_ROOT } from "./paths.ts";
import { runCasePipeline } from "./pipeline.ts";
import {
  formatCost,
  renderJson,
  renderMarkdown,
  renderVariance,
  totalCost,
  type CaseResult,
  type RunSummary,
} from "./report.ts";
import { aggregate, scoreCase } from "./score.ts";

const DEFAULT_MODEL = "openai/gpt-5.2:nitro";

interface ParsedArgs {
  live: boolean;
  record: boolean;
  cases: string[];
  model: string;
  outDir: string;
  failUnder: number | null;
  repeat: number;
  generatedAt: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    live: false,
    record: false,
    cases: [],
    model:
      process.env.OPENROUTER_HEALTH_STRUCTURE_MODEL &&
      process.env.OPENROUTER_HEALTH_STRUCTURE_MODEL.length > 0
        ? process.env.OPENROUTER_HEALTH_STRUCTURE_MODEL
        : DEFAULT_MODEL,
    outDir: DEFAULT_OUT_DIR,
    failUnder: null,
    repeat: 1,
    generatedAt: new Date().toISOString(),
  };
  let index = 2;
  while (index < argv.length) {
    const current = argv[index];
    if (current === "--live") parsed.live = true;
    else if (current === "--record") parsed.record = true;
    else if (current === "--case" && argv[index + 1]) parsed.cases.push(argv[++index]);
    else if (current === "--model" && argv[index + 1]) parsed.model = argv[++index];
    else if (current === "--out" && argv[index + 1]) parsed.outDir = path.resolve(argv[++index]);
    else if (current === "--fail-under" && argv[index + 1])
      parsed.failUnder = Number(argv[++index]);
    else if (current === "--repeat" && argv[index + 1]) parsed.repeat = Number(argv[++index]);
    index += 1;
  }
  // Recording without --live would mean recording replayed responses, which is a no-op that
  // silently looks like it worked. Treat it as the user meaning --live.
  if (parsed.record) parsed.live = true;

  if (!Number.isInteger(parsed.repeat) || parsed.repeat < 1) {
    throw new Error("--repeat needs a whole number of runs, 1 or more.");
  }
  // Replaying a cassette N times returns the same answer N times. That is not stability, but it
  // renders as a table of perfectly agreeing runs — which is precisely the false confidence the
  // repeat flag exists to remove. Refuse rather than produce it.
  if (parsed.repeat > 1 && !parsed.live) {
    throw new Error(
      "--repeat only means something with --live. Replaying cassettes N times returns the same " +
        "answer N times and would report a spread of zero, which looks like stability and is not.",
    );
  }
  // Recording samples one answer per request and the last write wins, so the cassettes would end
  // up holding run N while the report describes all N. Keep the corpus honest about what it is.
  if (parsed.repeat > 1 && parsed.record) {
    throw new Error(
      "--repeat cannot be combined with --record: recording keeps one answer per request, so the " +
        "cassettes would describe the last run while the report describes every run.",
    );
  }
  return parsed;
}

function table(headers: string[], rows: string[]): string[] {
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows];
}

export function resolveMode(args: Pick<ParsedArgs, "live" | "record">): CassetteMode {
  if (args.record) return "record";
  return args.live ? "live" : "replay";
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv);
  const mode = resolveMode(args);

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (mode !== "replay" && apiKey.length === 0) {
    throw new Error(
      "OPENROUTER_API_KEY is required for --live/--record. Omit both flags to replay cassettes.",
    );
  }

  const cases = await loadCases(args.cases);

  async function runPass(label: string): Promise<CaseResult[]> {
    const results: CaseResult[] = [];
    for (const evalCase of cases) {
      const cassette = await createCassetteFetch({
        dir: path.join(CASSETTES_ROOT, evalCase.id),
        mode,
      });
      // Only a case that ran end to end has exercised every request it needs, so only then is the
      // recorded set complete enough to prune against.
      let completed = false;
      let result: CaseResult;
      try {
        const { snapshot, diagnostics } = await runCasePipeline(
          evalCase.ocrText,
          evalCase.context,
          {
            fetchFn: cassette.fetchFn,
            apiKey: apiKey.length > 0 ? apiKey : "replay",
            model: args.model,
          },
        );
        result = {
          caseId: evalCase.id,
          score: scoreCase(
            evalCase.id,
            evalCase.expected,
            snapshot,
            evalCase.context.existingFindings,
          ),
          diagnostics,
        };
        completed = true;
        process.stdout.write(`[extraction-eval] ${label}${evalCase.id}: scored\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = { caseId: evalCase.id, error: message };
        process.stderr.write(`[extraction-eval] ${label}${evalCase.id}: FAILED — ${message}\n`);
      } finally {
        // Before the spend snapshot, not after: a case that failed at classify may still have an
        // extract request in flight, and its charge belongs on this case.
        await cassette.settled();
        await cassette.flush({ prune: completed });
      }
      result.stageSpend = cassette.stageSpend();
      results.push(result);
    }
    return results;
  }

  // Every pass, in order. With --repeat 1 this is the single run the report has always described;
  // with more, the last pass is the one rendered in full and every pass feeds the variance table.
  const passes: CaseResult[][] = [];
  for (let pass = 0; pass < args.repeat; pass++) {
    passes.push(await runPass(args.repeat > 1 ? `run ${pass + 1}/${args.repeat} ` : ""));
  }

  const results = passes[passes.length - 1];
  // Spend is totalled over every pass, unlike the scores: `results` is the last pass because that
  // is the one rendered in full, but N passes were paid for and the `## Cost` table below already
  // reports all N. A per-stage table covering one third of a `--repeat 3` run would contradict it.
  const spendCases = passes.flat();
  const scored = results.flatMap((result) => (result.score ? [result.score] : []));
  const summary: RunSummary = {
    model: args.model,
    mode,
    generatedAt: args.generatedAt,
    cases: results,
    spendCases,
    passCount: passes.length,
    aggregate: aggregate(scored),
  };

  const variance = renderVariance(
    passes.map((pass) => aggregate(pass.flatMap((result) => (result.score ? [result.score] : [])))),
  );
  // Across every pass, so a repeat run reports what the whole exercise cost rather than what its
  // last third did. Printed even for a single pass, where it equals that pass's own total.
  const spend = passes.map((pass) => totalCost(pass));
  const grandTotal = spend.reduce((sum, entry) => sum + entry.total, 0);
  const pricedRuns = spend.filter((entry) => entry.priced > 0).length;
  const runCosts =
    passes.length > 1
      ? [
          `## Cost`,
          "",
          ...table(
            ["run", "cost"],
            [
              ...spend.map(
                (entry, index) =>
                  `| run ${index + 1} | ${formatCost(entry.priced > 0 ? entry.total : null)} |`,
              ),
              `| **total** | **${formatCost(pricedRuns > 0 ? grandTotal : null)}** |`,
            ],
          ),
          "",
        ].join("\n")
      : "";

  const markdown = [renderMarkdown(summary), variance, runCosts].filter(Boolean).join("\n");
  await mkdir(args.outDir, { recursive: true });
  await writeFile(path.join(args.outDir, "report.md"), markdown, "utf8");
  await writeFile(path.join(args.outDir, "report.json"), renderJson(summary), "utf8");
  process.stdout.write(`\n${markdown}\n`);
  process.stdout.write(
    `[extraction-eval] wrote ${path.relative(REPO_ROOT, args.outDir)}/report.{md,json}\n`,
  );

  // Across every pass, not just the rendered one: a case that died on run 2 of 3 is exactly the
  // intermittent failure repeat runs exist to surface, and counting only the last pass would hide it.
  const failures = passes.flat().filter((result) => result.error).length;
  if (failures > 0) {
    process.stderr.write(`[extraction-eval] ${failures} case(s) failed to run\n`);
    return 1;
  }
  if (args.failUnder !== null && summary.aggregate.observations.f1 < args.failUnder) {
    process.stderr.write(
      `[extraction-eval] observations f1 ${summary.aggregate.observations.f1.toFixed(3)} < ${args.failUnder}\n`,
    );
    return 1;
  }
  return 0;
}

const invokedScript = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";
if (import.meta.url === invokedScript) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}

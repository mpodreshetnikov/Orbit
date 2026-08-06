#!/usr/bin/env node
/**
 * Scored extraction eval.
 *
 *   just test-extraction                      replay recorded responses (free, offline)
 *   just test-extraction --live               call OpenRouter
 *   just test-extraction --live --record      call OpenRouter and refresh the cassettes
 *   just test-extraction --case 001           run a subset
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
import { renderJson, renderMarkdown, type CaseResult, type RunSummary } from "./report.ts";
import { aggregate, scoreCase } from "./score.ts";

const DEFAULT_MODEL = "openai/gpt-5.2:nitro";

interface ParsedArgs {
  live: boolean;
  record: boolean;
  cases: string[];
  model: string;
  outDir: string;
  failUnder: number | null;
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
    index += 1;
  }
  // Recording without --live would mean recording replayed responses, which is a no-op that
  // silently looks like it worked. Treat it as the user meaning --live.
  if (parsed.record) parsed.live = true;
  return parsed;
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
  const results: CaseResult[] = [];

  for (const evalCase of cases) {
    const cassette = await createCassetteFetch({
      dir: path.join(CASSETTES_ROOT, evalCase.id),
      mode,
    });
    try {
      const { snapshot, diagnostics } = await runCasePipeline(evalCase.ocrText, evalCase.context, {
        fetchFn: cassette.fetchFn,
        apiKey: apiKey.length > 0 ? apiKey : "replay",
        model: args.model,
      });
      results.push({
        caseId: evalCase.id,
        score: scoreCase(
          evalCase.id,
          evalCase.expected,
          snapshot,
          evalCase.context.existingFindings,
        ),
        diagnostics,
      });
      process.stdout.write(`[extraction-eval] ${evalCase.id}: scored\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ caseId: evalCase.id, error: message });
      process.stderr.write(`[extraction-eval] ${evalCase.id}: FAILED — ${message}\n`);
    } finally {
      await cassette.flush();
    }
  }

  const scored = results.flatMap((result) => (result.score ? [result.score] : []));
  const summary: RunSummary = {
    model: args.model,
    mode,
    generatedAt: args.generatedAt,
    cases: results,
    aggregate: aggregate(scored),
  };

  const markdown = renderMarkdown(summary);
  await mkdir(args.outDir, { recursive: true });
  await writeFile(path.join(args.outDir, "report.md"), markdown, "utf8");
  await writeFile(path.join(args.outDir, "report.json"), renderJson(summary), "utf8");
  process.stdout.write(`\n${markdown}\n`);
  process.stdout.write(
    `[extraction-eval] wrote ${path.relative(REPO_ROOT, args.outDir)}/report.{md,json}\n`,
  );

  const failures = results.filter((result) => result.error).length;
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

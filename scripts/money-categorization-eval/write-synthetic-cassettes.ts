#!/usr/bin/env node
/**
 * Writes synthetic OpenRouter cassettes for every corpus case from the hand labels.
 *
 * Default replay must never call a paid provider. These cassettes encode the labeled answer so
 * the harness is free/offline/deterministic; `--live --record` replaces them with real model
 * answers when measuring quality.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cassetteKey } from "./cassette.ts";
import { loadCases, loadSharedCategories } from "./corpus.ts";
import { CASSETTES_ROOT } from "./paths.ts";
import { DEFAULT_EVAL_MODEL, buildBatchRequest, buildOpenRouterRequestBody } from "./pipeline.ts";

function syntheticResponse(
  lineItemId: string,
  categoryId: string | null,
  reason: string,
): Record<string, unknown> {
  return {
    id: "synthetic-money-categorize",
    model: DEFAULT_EVAL_MODEL,
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({
            items: [
              {
                line_item_id: lineItemId,
                category_id: categoryId,
                reason,
              },
            ],
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      cost: 0,
    },
  };
}

async function main(): Promise<void> {
  const [cases, shared] = await Promise.all([loadCases(), loadSharedCategories()]);
  for (const evalCase of cases) {
    const request = buildBatchRequest(evalCase.input, shared.candidateCategories);
    const body = buildOpenRouterRequestBody(request, DEFAULT_EVAL_MODEL);
    const hash = cassetteKey(body);
    const dir = path.join(CASSETTES_ROOT, evalCase.id);
    await mkdir(dir, { recursive: true });
    const entry = {
      request_hash: hash,
      stage: "categorize",
      model: DEFAULT_EVAL_MODEL,
      response: syntheticResponse(
        evalCase.input.line_item_id,
        evalCase.expected.category_id,
        `synthetic label for ${evalCase.id}`,
      ),
    };
    const filePath = path.join(dir, `categorize-${hash}.json`);
    await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    process.stdout.write(
      `[write-synthetic-cassettes] ${evalCase.id} → ${path.basename(filePath)}\n`,
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

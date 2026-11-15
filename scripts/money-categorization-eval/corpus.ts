// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../supabase/functions/_shared/deno.d.ts" />
/**
 * Loads the money categorization corpus off disk.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { MoneyCategorizeCandidateCategory } from "../../supabase/functions/money-categorize/service.ts";
import { CASES_ROOT, CATEGORIES_PATH } from "./paths.ts";
import type { CaseExpected, CaseInput } from "./types.ts";

export interface SharedCategories {
  candidateCategories: MoneyCategorizeCandidateCategory[];
  byId: Map<string, MoneyCategorizeCandidateCategory>;
  bySystemKey: Map<string, MoneyCategorizeCandidateCategory>;
}

export interface EvalCase {
  id: string;
  dir: string;
  input: CaseInput;
  expected: CaseExpected;
  meta: Record<string, unknown>;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function loadSharedCategories(): Promise<SharedCategories> {
  const raw = await readJson<{ candidateCategories: MoneyCategorizeCandidateCategory[] }>(
    CATEGORIES_PATH,
  );
  const candidateCategories = Array.isArray(raw.candidateCategories) ? raw.candidateCategories : [];
  const byId = new Map(candidateCategories.map((entry) => [entry.id, entry]));
  const bySystemKey = new Map(
    candidateCategories
      .filter((entry) => entry.canonical_system_key)
      .map((entry) => [entry.canonical_system_key as string, entry]),
  );
  return { candidateCategories, byId, bySystemKey };
}

export async function loadCases(filter: string[] = []): Promise<EvalCase[]> {
  const entries = await readdir(CASES_ROOT, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => filter.length === 0 || filter.some((needle) => id.includes(needle)))
    .sort();

  if (ids.length === 0) {
    throw new Error(
      filter.length > 0
        ? `no cases under ${CASES_ROOT} match ${filter.join(", ")}`
        : `no cases found under ${CASES_ROOT}`,
    );
  }

  return Promise.all(
    ids.map(async (id) => {
      const dir = path.join(CASES_ROOT, id);
      const [input, expected, meta] = await Promise.all([
        readJson<CaseInput>(path.join(dir, "input.json")),
        readJson<CaseExpected>(path.join(dir, "expected.json")),
        readJson<Record<string, unknown>>(path.join(dir, "meta.json")),
      ]);
      return { id, dir, input, expected, meta };
    }),
  );
}

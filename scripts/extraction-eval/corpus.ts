// The imports below reach into supabase/functions, which runs on Deno. Without this ambient
// declaration the web typecheck fails on `Cannot find name 'Deno'` in modules pulled in
// transitively (repository.ts, observability.ts). It is a types-only concern — nothing
// under stages/ touches `Deno` at runtime. There is nothing to `import` from a global
// declaration file, so the reference form is the only one available here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../supabase/functions/_shared/deno.d.ts" />
/**
 * Loads the corpus off disk and assembles the exact context health-structure would have been
 * handed in production.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { HealthStructureParseContext } from "../../supabase/functions/health-structure/service.ts";
import { CASES_ROOT, CATALOGS_PATH, CHECKUP_ITEMS_PATH } from "./paths.ts";
import type { CaseSnapshot } from "./types.ts";

export interface EvalCase {
  id: string;
  dir: string;
  ocrText: string;
  expected: CaseSnapshot;
  meta: Record<string, unknown>;
  context: HealthStructureParseContext;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function loadSharedContext(): Promise<{
  catalogs: Pick<
    HealthStructureParseContext,
    "observationCatalog" | "findingTypeCatalog" | "bodySiteCatalog"
  >;
  checkupItems: HealthStructureParseContext["checkupItems"];
}> {
  const catalogs = await readJson<Record<string, unknown>>(CATALOGS_PATH);
  const checkups = await readJson<Record<string, unknown>>(CHECKUP_ITEMS_PATH);
  return {
    catalogs: {
      observationCatalog: asArray(
        catalogs.observationCatalog,
      ) as HealthStructureParseContext["observationCatalog"],
      findingTypeCatalog: asArray(
        catalogs.findingTypeCatalog,
      ) as HealthStructureParseContext["findingTypeCatalog"],
      bodySiteCatalog: asArray(
        catalogs.bodySiteCatalog,
      ) as HealthStructureParseContext["bodySiteCatalog"],
    },
    checkupItems: asArray(checkups.checkupItems) as HealthStructureParseContext["checkupItems"],
  };
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

  const shared = await loadSharedContext();

  return Promise.all(
    ids.map(async (id) => {
      const dir = path.join(CASES_ROOT, id);
      const [ocrText, expected, meta] = await Promise.all([
        readFile(path.join(dir, "input.md"), "utf8"),
        readJson<CaseSnapshot>(path.join(dir, "expected.json")),
        readJson<Record<string, unknown>>(path.join(dir, "meta.json")),
      ]);

      const patientState = (meta.patient_state ?? {}) as Record<string, unknown>;
      // Per-case override wins; otherwise every case shares one checkup list, which is what makes
      // "completed nothing" a real negative rather than an empty-input artefact.
      const checkupItems = patientState.checkupItems
        ? (asArray(patientState.checkupItems) as HealthStructureParseContext["checkupItems"])
        : shared.checkupItems;

      return {
        id,
        dir,
        ocrText,
        expected,
        meta,
        context: {
          ...shared.catalogs,
          existingConditions: asArray(
            patientState.existingConditions,
          ) as HealthStructureParseContext["existingConditions"],
          existingFindings: asArray(
            patientState.existingFindings,
          ) as HealthStructureParseContext["existingFindings"],
          checkupItems,
        },
      };
    }),
  );
}

import type { HealthStructureParseContext } from "./service.ts";
import type { StructuredDataWithEntities } from "./types.ts";

export const E2E_FORCE_STRUCTURE_FAIL_MARKER = "[E2E_FORCE_STRUCTURE_FAIL]";

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveTitle(ocrText: string): string {
  const firstNonEmptyLine = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmptyLine) return "E2E Structured Record";

  const sanitized = firstNonEmptyLine.replace(E2E_FORCE_STRUCTURE_FAIL_MARKER, "").trim();
  return sanitized.length > 0 ? sanitized.slice(0, 120) : "E2E Structured Record";
}

export function parseStructuredDataE2EStub(
  ocrText: string,
  _context: HealthStructureParseContext,
): StructuredDataWithEntities {
  if (ocrText.includes(E2E_FORCE_STRUCTURE_FAIL_MARKER)) {
    throw new Error("E2E stub forced structure failure");
  }

  const summarySource = toSingleLine(ocrText).slice(0, 280);

  return {
    record_type: "other",
    title: resolveTitle(ocrText),
    record_date: null,
    summary: summarySource ? `E2E stub summary: ${summarySource}` : "E2E stub summary",
    keywords: ["e2e", "stub"],
    observations: [],
    findings: [],
    conditions: [],
    findings_to_resolve: [],
    conditions_to_resolve: [],
    checkups_to_complete: [],
  };
}

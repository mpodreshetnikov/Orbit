import type {
  CreateRecordFindingInput,
  FindingHistoryPoint,
  FindingLaterality,
  FindingResolutionStatus,
  FindingSeverity,
  FindingSummary,
} from "./finding";

/** A `record_findings` row as the history selects it, with its record and catalogues joined. */
export interface FindingListRow {
  id: string;
  record_id: string;
  finding_type_id: string | null;
  finding_code: string | null;
  finding_type_text: string;
  body_site_id: string | null;
  site_code: string | null;
  body_site_text: string | null;
  size_mm: number | null;
  count: number | null;
  resolution_status: FindingResolutionStatus;
  severity: string;
  laterality: string;
  morphology: string | null;
  description: string | null;
  histology: string | null;
  source_anchor: string;
  finding_date: string | null;
  created_at: string;
  medical_records: { person_id: string; record_date: string | null; status: string };
  finding_type_catalog: { name_ru: string | null; name_en: string | null } | null;
  body_site_catalog: { name_ru: string | null; name_en: string | null } | null;
}

/**
 * The history's select: findings of the person's active records. Filter it with
 * `.eq("medical_records.person_id", id)` and `.eq("medical_records.status", "active")`.
 */
export const FINDING_LIST_SELECT =
  "id, record_id, finding_type_id, finding_code, finding_type_text, body_site_id, site_code, " +
  "body_site_text, size_mm, count, resolution_status, severity, laterality, morphology, " +
  "description, histology, source_anchor, finding_date, created_at, " +
  "medical_records!inner(person_id, record_date, status), " +
  "finding_type_catalog(name_ru, name_en), body_site_catalog(name_ru, name_en)";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  severe: 0,
  moderate: 1,
  unknown: 2,
  mild: 3,
};

/** The day a finding was seen: its own date, else its record's, else when it was saved. */
export function findingPointDate(point: FindingHistoryPoint): string {
  return point.finding_date || point.record_date || point.created_at;
}

const pointTime = (point: FindingHistoryPoint) => new Date(findingPointDate(point)).getTime();

/**
 * A finding is identified by what it is and where: the catalogue codes, or the text written for
 * each when there is no code.
 */
export function findingKey(row: {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
}): string {
  const finding = row.finding_code || row.finding_type_text.toLowerCase().trim();
  const site = row.site_code || row.body_site_text?.toLowerCase().trim() || "unknown";
  return `${finding}::${site}`;
}

/**
 * Groups findings into one summary per finding and site, the history newest first. The latest size
 * and count are the latest known ones; a finding is resolved when its latest row says so. The most
 * severe come first, then the most recent.
 */
export function summarizeFindings(rows: FindingListRow[]): FindingSummary[] {
  const groups = new Map<string, { first: FindingListRow; history: FindingHistoryPoint[] }>();

  for (const r of rows) {
    const point: FindingHistoryPoint = {
      id: r.id,
      record_id: r.record_id,
      record_date: r.medical_records.record_date,
      finding_date: r.finding_date,
      size_mm: r.size_mm,
      count: r.count,
      resolution_status: r.resolution_status,
      severity: r.severity as FindingSeverity,
      laterality: r.laterality as FindingLaterality,
      morphology: r.morphology,
      description: r.description,
      histology: r.histology,
      source_anchor: r.source_anchor,
      created_at: r.created_at,
    };
    const key = findingKey(r);
    const group = groups.get(key);
    if (group) group.history.push(point);
    else groups.set(key, { first: r, history: [point] });
  }

  const summaries = Array.from(groups.values()).map(({ first, history }) => {
    history.sort((a, b) => pointTime(b) - pointTime(a));
    const latest = history[0];
    return {
      finding_code: first.finding_code,
      finding_type_text: first.finding_type_text,
      site_code: first.site_code,
      body_site_text: first.body_site_text,
      finding_type_id: first.finding_type_id,
      body_site_id: first.body_site_id,
      catalog_finding_name_ru: first.finding_type_catalog?.name_ru || null,
      catalog_finding_name_en: first.finding_type_catalog?.name_en || null,
      catalog_site_name_ru: first.body_site_catalog?.name_ru || null,
      catalog_site_name_en: first.body_site_catalog?.name_en || null,
      latest_size_mm: history.find((h) => h.size_mm !== null)?.size_mm ?? null,
      latest_count: history.find((h) => h.count !== null)?.count ?? null,
      latest_severity: latest.severity,
      latest_laterality: latest.laterality,
      latest_date: latest.finding_date || latest.record_date,
      is_resolved: latest.resolution_status === "resolved",
      occurrence_count: history.length,
      history,
    };
  });

  return summaries.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.latest_severity] - SEVERITY_ORDER[b.latest_severity];
    if (bySeverity !== 0) return bySeverity;
    const dateA = a.latest_date ? new Date(a.latest_date).getTime() : 0;
    const dateB = b.latest_date ? new Date(b.latest_date).getTime() : 0;
    return dateB - dateA;
  });
}

/** Summaries whose finding or site, by text, code or catalogue name, contains `search`. */
export function searchFindingSummaries(
  summaries: FindingSummary[],
  search: string | undefined,
): FindingSummary[] {
  const needle = search?.toLowerCase().trim();
  if (!needle) return summaries;
  return summaries.filter((s) =>
    [
      s.finding_type_text,
      s.body_site_text,
      s.finding_code,
      s.site_code,
      s.catalog_finding_name_ru,
      s.catalog_finding_name_en,
      s.catalog_site_name_ru,
      s.catalog_site_name_en,
    ].some((text) => text?.toLowerCase().includes(needle)),
  );
}

/** The row that marks a finding gone, attached to the record that shows it. */
export function resolvedFindingRow(
  personId: string,
  recordId: string,
  finding: FindingSummary,
): CreateRecordFindingInput {
  return {
    person_id: personId,
    record_id: recordId,
    finding_type_id: finding.finding_type_id,
    finding_code: finding.finding_code,
    finding_type_text: finding.finding_type_text,
    body_site_id: finding.body_site_id,
    site_code: finding.site_code,
    body_site_text: finding.body_site_text,
    size_mm: null,
    count: null,
    resolution_status: "resolved",
    severity: "unknown",
    laterality: finding.latest_laterality,
    source_anchor: "Marked as resolved by user",
    is_llm_extracted: false,
    is_user_verified: true,
  };
}

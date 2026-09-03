import { z } from "zod";
import {
  ALL_RECORD_STATUSES,
  getMedicalRecord,
  getRecordConditions,
  getRecordFindings,
  getRecordObservations,
  searchMedicalRecords,
} from "../health/records";
import { getObservationHistory, searchObservations } from "../health/observations";
import { getCondition, listConditions } from "../health/conditions";
import { getFindingHistory, searchFindings } from "../health/findings";
import {
  dateRangeSchema,
  paginationSchema,
  personSelectorSchema,
  uuidSchema,
} from "../schemas/common";
import { resolvePerson } from "../resolve-person";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList } from "../tool-result";
import type { McpToolServer } from "./types";

const RECORD_TYPES = [
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
  "procedure",
  "other",
] as const;

/**
 * Medical records and everything extracted from them: observations (lab
 * results), findings (things seen on imaging) and conditions (diagnoses).
 */
export function registerRecordTools(server: McpToolServer): void {
  server.registerTool(
    "search_medical_records",
    {
      title: "Search medical records",
      description:
        "Full-text search across medical documents (title, notes and OCR'd text). Leave the query empty to list recent records. Returns document metadata; use get_medical_record for the contents.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...paginationSchema,
        query: z.string().optional().describe("Free-text search terms."),
        record_type: z.enum(RECORD_TYPES).optional(),
        include_incomplete: z
          .boolean()
          .default(false)
          .describe(
            "Include documents still being processed or awaiting review. Off by default, since their extracted data is not final.",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    // Person is optional here: searching across everyone is a legitimate ask.
    withUserClient<{
      person_id?: string;
      person_name?: string;
      query?: string;
      record_type?: string;
      include_incomplete: boolean;
      limit: number;
      offset: number;
    }>(async (supabase, args) => {
      let personId: string | undefined;
      if (args.person_id || args.person_name) {
        const resolution = await resolvePerson(supabase, args);
        if (resolution.status !== "ok") {
          return fail(resolution.message, { candidates: resolution.candidates });
        }
        personId = resolution.person.id;
      }

      const records = await searchMedicalRecords(supabase, {
        query: args.query,
        personId,
        recordType: args.record_type,
        statuses: args.include_incomplete ? ALL_RECORD_STATUSES : undefined,
        limit: args.limit,
        offset: args.offset,
      });

      return ok(
        summarizeList(
          "medical records",
          records.map(
            (record) =>
              `${record.title} — ${record.record_type}${record.record_date ? `, ${record.record_date}` : ""} (id ${record.id})`,
          ),
          records.length,
        ),
        { records, limit: args.limit, offset: args.offset },
      );
    }),
  );

  server.registerTool(
    "get_medical_record",
    {
      title: "Get medical record",
      description:
        "Get one medical document in full: its notes, AI summary and keywords, attachments, plus every lab observation, finding and diagnosis extracted from it. This is the single call for 'show me that report'.",
      inputSchema: z.object({
        record_id: uuidSchema,
        include_ocr_text: z
          .boolean()
          .default(false)
          .describe("Include the raw OCR text. Long; only enable when the summary is not enough."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ record_id: string; include_ocr_text: boolean }>(async (supabase, args) => {
      const record = await getMedicalRecord(supabase, args.record_id);
      if (!record) {
        return fail(`No medical record with id ${args.record_id}.`);
      }

      const [observations, findings, conditions] = await Promise.all([
        getRecordObservations(supabase, args.record_id),
        getRecordFindings(supabase, args.record_id),
        getRecordConditions(supabase, args.record_id),
      ]);

      if (!args.include_ocr_text) {
        delete record.ocr_text;
      }

      return ok(
        `${record.title as string} (${record.record_type as string}${record.record_date ? `, ${record.record_date as string}` : ""}): ${observations.length} observation(s), ${findings.length} finding(s), ${conditions.length} diagnosis mention(s).`,
        { record, observations, findings, conditions },
      );
    }),
  );

  server.registerTool(
    "search_observations",
    {
      title: "Search lab results",
      description:
        "Search a person's lab and vital observations extracted from medical documents (haemoglobin, ferritin, cholesterol and so on), across all their records. Values come with both the raw and canonical-unit forms plus reference ranges. For manually tracked body metrics use list_measurements instead.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...paginationSchema,
        ...dateRangeSchema,
        query: z.string().optional().describe("Match against the analyte name or code."),
        obs_code: z.string().optional().describe("Exact analyte code, when known."),
        status: z
          .enum(["normal", "low", "high", "critical_low", "critical_high", "unknown"])
          .optional()
          .describe("Only results with this flag — useful for 'what was out of range?'."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const observations = await searchObservations(supabase, {
        personId: person.id,
        query: args.query,
        obsCode: args.obs_code,
        status: args.status,
        from: args.from,
        to: args.to,
        limit: args.limit,
        offset: args.offset,
      });

      return ok(
        summarizeList(
          `lab results for ${person.name}`,
          observations.map(
            (observation) =>
              `${observation.obs_name}: ${observation.value_numeric ?? observation.value_text ?? "?"} ${observation.unit ?? ""}` +
              `${observation.status && observation.status !== "normal" ? ` [${observation.status}]` : ""}` +
              `${observation.record_date ? ` — ${observation.record_date}` : ""}`,
          ),
          observations.length,
        ),
        { person, observations, limit: args.limit, offset: args.offset },
      );
    }),
  );

  server.registerTool(
    "get_observation_history",
    {
      title: "Get lab result history",
      description:
        "Time series for one lab analyte across all of a person's records, oldest first, for trend questions like 'is my ferritin improving?'.",
      inputSchema: z.object({
        ...personSelectorSchema,
        obs_code: z.string().describe("Analyte code. Find it via search_observations."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const history = await getObservationHistory(supabase, {
        personId: person.id,
        obsCode: args.obs_code,
        limit: args.limit,
      });

      if (history.length === 0) {
        return fail(
          `No results for analyte "${args.obs_code}" for ${person.name}. Use search_observations to discover the codes that exist.`,
        );
      }

      return ok(
        summarizeList(
          `results for ${history[0].obs_name} (${person.name})`,
          history.map(
            (row) =>
              `${row.record_date ?? "undated"}: ${row.value_numeric ?? row.value_text ?? "?"} ${row.unit ?? ""}${row.status && row.status !== "normal" ? ` [${row.status}]` : ""}`,
          ),
          history.length,
        ),
        { person, observations: history },
      );
    }),
  );

  server.registerTool(
    "list_conditions",
    {
      title: "List diagnoses",
      description:
        "List a person's diagnoses (conditions), with ICD-10 codes, current status and when each was first and last mentioned in their records.",
      inputSchema: z.object({
        ...personSelectorSchema,
        status: z.enum(["active", "resolved", "suspected", "history"]).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const conditions = await listConditions(supabase, {
        personId: person.id,
        status: args.status,
      });

      return ok(
        summarizeList(
          `diagnoses for ${person.name}`,
          conditions.map(
            (condition) =>
              `${condition.name}${condition.code ? ` (${condition.code})` : ""} — ${condition.current_status}` +
              `${condition.mention_count ? `, ${condition.mention_count} mention(s)` : ""} (id ${condition.id})`,
          ),
          conditions.length,
        ),
        { person, conditions },
      );
    }),
  );

  server.registerTool(
    "get_condition",
    {
      title: "Get diagnosis",
      description:
        "Get one diagnosis in detail: its ICD-10 naming, status history, every record that mentions it, and any checkups scheduled because of it.",
      inputSchema: z.object({ condition_id: uuidSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ condition_id: string }>(async (supabase, args) => {
      const detail = await getCondition(supabase, args.condition_id);
      if (!detail.condition) {
        return fail(`No diagnosis with id ${args.condition_id}.`);
      }

      // A closure waiting on a person is named in the summary, not only in the rows. The summary
      // is what gets read; a mention that says "resolved" while the condition says "active" is
      // otherwise reconciled by guessing, and the guess that a condition ended is the harmful one.
      const awaiting = detail.mentions.filter(
        (mention) => (mention as { awaiting_confirmation?: boolean }).awaiting_confirmation,
      ).length;

      return ok(
        `${detail.condition.name}${detail.condition.code ? ` (${detail.condition.code})` : ""} — ${detail.condition.current_status}. ${detail.mentions.length} record mention(s), ${detail.checkups.length} linked checkup(s).` +
          (awaiting > 0
            ? ` ${awaiting} mention(s) propose closing this condition but are not confirmed and have NOT changed its status — it is still ${detail.condition.current_status}.`
            : ""),
        detail as unknown as Record<string, unknown>,
      );
    }),
  );

  server.registerTool(
    "search_findings",
    {
      title: "Search findings",
      description:
        "Search a person's findings — discrete things seen on imaging or during an exam, such as polyps, cysts, nodules or stones — with size, count, severity and body site. A later entry with size 0 or count 0 means it resolved.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...paginationSchema,
        ...dateRangeSchema,
        query: z.string().optional().describe("Match finding type, body site or description."),
        finding_code: z.string().optional(),
        site_code: z.string().optional(),
        severity: z.enum(["mild", "moderate", "severe", "unknown"]).optional(),
        laterality: z.enum(["left", "right", "bilateral", "none"]).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const findings = await searchFindings(supabase, {
        personId: person.id,
        query: args.query,
        findingCode: args.finding_code,
        siteCode: args.site_code,
        severity: args.severity,
        laterality: args.laterality,
        from: args.from,
        to: args.to,
        limit: args.limit,
        offset: args.offset,
      });

      return ok(
        summarizeList(
          `findings for ${person.name}`,
          findings.map(
            (finding) =>
              `${finding.finding_type_text}${finding.body_site_text ? ` at ${finding.body_site_text}` : ""}` +
              `${finding.size_mm != null ? `, ${finding.size_mm}mm` : ""}` +
              `${finding.severity !== "unknown" ? `, ${finding.severity}` : ""}` +
              `${finding.is_resolved ? " [resolved]" : ""}` +
              `${finding.finding_date ? ` — ${finding.finding_date}` : ""}`,
          ),
          findings.length,
        ),
        { person, findings, limit: args.limit, offset: args.offset },
      );
    }),
  );

  server.registerTool(
    "get_finding_history",
    {
      title: "Get finding history",
      description:
        "Track one finding at one body site over time, oldest first — for questions like 'has that polyp grown?'.",
      inputSchema: z.object({
        ...personSelectorSchema,
        finding_code: z.string().describe("Finding type code. Discover it via search_findings."),
        site_code: z.string().optional().describe("Narrow to one body site."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const history = await getFindingHistory(supabase, {
        personId: person.id,
        findingCode: args.finding_code,
        siteCode: args.site_code,
        limit: args.limit,
      });

      if (history.length === 0) {
        return fail(
          `No findings coded "${args.finding_code}" for ${person.name}. Use search_findings to see what exists.`,
        );
      }

      return ok(
        summarizeList(
          `entries for ${history[0].finding_type_text} (${person.name})`,
          history.map(
            (finding) =>
              `${finding.finding_date ?? "undated"}: ${finding.size_mm != null ? `${finding.size_mm}mm` : "size unknown"}` +
              `${finding.count != null ? `, count ${finding.count}` : ""}${finding.is_resolved ? " [resolved]" : ""}`,
          ),
          history.length,
        ),
        { person, findings: history },
      );
    }),
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { RECORD_TYPE_LABELS, type RecordType } from "@/types/medical-record";
import { removeRecordDraft } from "../health/documents";
import {
  getMedicalRecord,
  getRecordConditions,
  getRecordFindings,
  getRecordObservations,
} from "../health/records";
import { uuidSchema } from "../schemas/common";
import { withUserClient } from "../tool-context";
import { fail, ok } from "../tool-result";
import { WRITE_SCOPE } from "../tools/scopes";
import type { McpAuthExtra } from "../verify-token";
import { MCP_APP_MIME_TYPE } from "./probe";
import { RECORD_DRAFT_HTML } from "./record-draft-page";

/**
 * A record's draft as a card in the Claude chat, approved or declined from the card itself
 * (T-261024-jpz). The owner reads what the document will put on the chart where the agent ingested
 * it, without opening the app.
 *
 * The server shapes the card's content (`buildDraftView`), so the page only lays it out: labels are
 * already Russian, flags already decided, and nothing in the page has to know the schema. Approve is
 * the existing `activate_medical_record`; decline is `decline_record_draft`, offered to the card
 * only, so the model never removes a record on its own.
 */
export const RECORD_DRAFT_RESOURCE_URI = "ui://orbit/record-draft.html";

const SEVERITY_LABELS: Record<string, string> = {
  mild: "лёгкая",
  moderate: "умеренная",
  severe: "выраженная",
};
const LATERALITY_LABELS: Record<string, string> = {
  left: "слева",
  right: "справа",
  bilateral: "с двух сторон",
};
const CONDITION_STATUS_LABELS: Record<string, string> = {
  active: "активный",
  resolved: "разрешён",
  suspected: "подозрение",
  history: "в анамнезе",
};

export interface DraftObservation {
  name: string;
  value: string;
  ref: string | null;
  flag: "high" | "low" | null;
  critical: boolean;
  recognised: boolean;
}
export interface DraftFinding {
  name: string;
  site: string | null;
  details: string | null;
  recognised: boolean;
}
export interface DraftCondition {
  name: string;
  code: string | null;
  status: string;
  proposed: boolean;
}
export interface DraftClosure {
  name: string;
  evidence: string | null;
}
export interface DraftView {
  record_id: string;
  status: string;
  title: string;
  type_label: string;
  record_date: string | null;
  person_name: string | null;
  summary: string | null;
  review_url: string | null;
  observations: DraftObservation[];
  findings: DraftFinding[];
  conditions: DraftCondition[];
  closures: DraftClosure[];
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result === "" ? null : result;
}

function referenceRange(row: Record<string, unknown>): string | null {
  const written = text(row.ref_range_text);
  if (written) return written;
  const low = text(row.ref_range_low);
  const high = text(row.ref_range_high);
  if (low && high) return `${low}–${high}`;
  if (low) return `от ${low}`;
  if (high) return `до ${high}`;
  return null;
}

export function buildDraftView(input: {
  record: Record<string, unknown>;
  personName: string | null;
  observations: Array<Record<string, unknown>>;
  findings: Array<Record<string, unknown>>;
  conditions: Array<Record<string, unknown>>;
  reviewUrl: string | null;
}): DraftView {
  const { record } = input;
  const type = String(record.record_type ?? "other") as RecordType;

  const observations = input.observations.map((row): DraftObservation => {
    const status = String(row.status ?? "");
    const value = [text(row.value_text) ?? text(row.value_numeric) ?? "—", text(row.unit)]
      .filter(Boolean)
      .join(" ");
    return {
      name: text(row.catalog_name_ru) ?? text(row.obs_name) ?? "Показатель",
      value,
      ref: referenceRange(row),
      flag: status.endsWith("high") ? "high" : status.endsWith("low") ? "low" : null,
      critical: status.startsWith("critical"),
      recognised: row.is_applied === true,
    };
  });

  const findings = input.findings.map((row): DraftFinding => {
    const size = text(row.size_mm);
    const count = text(row.count);
    const details = [
      size ? `${size} мм` : null,
      count && count !== "1" ? `×${count}` : null,
      SEVERITY_LABELS[String(row.severity)] ?? null,
      LATERALITY_LABELS[String(row.laterality)] ?? null,
      text(row.morphology),
    ].filter(Boolean);
    const siteText = text(row.body_site_text);
    return {
      name: text(row.catalog_finding_name_ru) ?? text(row.finding_type_text) ?? "Находка",
      site: text(row.catalog_site_name_ru) ?? siteText,
      details: details.length > 0 ? details.join(", ") : null,
      recognised: Boolean(row.finding_code) && (!siteText || Boolean(row.site_code)),
    };
  });

  const conditions: DraftCondition[] = [];
  const closures: DraftClosure[] = [];
  for (const row of input.conditions) {
    const name =
      text(row.condition_name) ?? text(row.condition_icd_name_ru) ?? text(row.condition_code);
    if (!name) continue;
    if (row.awaiting_confirmation === true) {
      const code = text(row.supporting_obs_code);
      const cited = input.observations.find((obs) => code && obs.obs_code === code);
      const citedName = cited ? (text(cited.catalog_name_ru) ?? text(cited.obs_name)) : null;
      closures.push({ name, evidence: citedName ?? code });
      continue;
    }
    // A closure a person already dismissed changes nothing, so it is not news on the card.
    if (row.not_applied_reason) continue;
    const status = String(row.status_in_record ?? "");
    conditions.push({
      name,
      code: text(row.condition_code),
      status: CONDITION_STATUS_LABELS[status] ?? status,
      proposed: row.is_proposal === true,
    });
  }

  return {
    record_id: String(record.id),
    status: String(record.status ?? ""),
    title: text(record.title) ?? "Медицинская запись",
    type_label: RECORD_TYPE_LABELS[type]?.ru ?? RECORD_TYPE_LABELS.other.ru,
    record_date: text(record.record_date),
    person_name: input.personName,
    summary: text(record.llm_summary) ?? text(record.notes),
    review_url: input.reviewUrl,
    observations,
    findings,
    conditions,
    closures,
  };
}

function reviewUrl(auth: McpAuthExtra, recordId: string): string | null {
  return auth.appOrigin ? `${auth.appOrigin}/health/records/${recordId}` : null;
}

export function registerRecordDraftApp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
) {
  server.registerResource(
    "orbit-record-draft",
    RECORD_DRAFT_RESOURCE_URI,
    {
      title: "Orbit record draft",
      description: "A medical record's draft, with approve and decline.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: RECORD_DRAFT_HTML }],
    }),
  );

  server.registerTool(
    "show_record_draft",
    {
      title: "Show record draft",
      description:
        "Show the owner an ingested record's draft as a card in the chat: what it will put on the chart (lab values, findings, diagnoses, closures), with Approve and Decline buttons the owner presses on the card. Call it right after ingest_medical_document instead of asking for approval in words. Approve on the card does what activate_medical_record does; Decline removes the draft (restorable in the app). Do not call activate_medical_record yourself after showing the card unless the owner asks you to in words.",
      inputSchema: z.object({ record_id: uuidSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: RECORD_DRAFT_RESOURCE_URI },
        "ui/resourceUri": RECORD_DRAFT_RESOURCE_URI,
      },
    },
    withUserClient<{ record_id: string }>(async (supabase, args, auth) => {
      const record = await getMedicalRecord(supabase, args.record_id);
      if (!record) return fail(`No medical record with id ${args.record_id}.`);
      const status = String(record.status);
      if (status !== "structure_review" && status !== "active" && status !== "removed") {
        return fail(
          `Record ${args.record_id} is ${status}; it has nothing to show yet. Call ingest_medical_document first.`,
        );
      }

      const [observations, findings, conditions, person] = await Promise.all([
        getRecordObservations(supabase, args.record_id),
        getRecordFindings(supabase, args.record_id),
        getRecordConditions(supabase, args.record_id),
        supabase.from("persons").select("name").eq("id", String(record.person_id)).maybeSingle(),
      ]);
      const view = buildDraftView({
        record,
        personName: (person.data as { name?: string } | null)?.name ?? null,
        observations,
        findings,
        conditions,
        reviewUrl: reviewUrl(auth, args.record_id),
      });

      const counts = `${view.observations.length} lab value(s), ${view.findings.length} finding(s), ${view.conditions.length} diagnosis mention(s), ${view.closures.length} closure(s) awaiting confirmation`;
      const next =
        status === "structure_review"
          ? "The owner approves or declines it on the card; wait for them. If the card does not show, give them the review link instead."
          : status === "active"
            ? "It is already approved."
            : "It was declined and set aside.";
      return ok(
        [
          `Showing the draft of "${view.title}" (${counts}). ${next}`,
          view.review_url ? `Review link: ${view.review_url}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        { draft: view },
      );
    }),
  );

  server.registerTool(
    "decline_record_draft",
    {
      title: "Decline record draft",
      description:
        "Used by the record draft card's Decline button: sets aside a record that has not been approved, as the app's Remove does. It can be restored in the app.",
      inputSchema: z.object({ record_id: uuidSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    withUserClient<{ record_id: string }>(async (supabase, args) => {
      const outcome = await removeRecordDraft(supabase, args.record_id);
      if (outcome.status === "not_found")
        return fail(`No medical record with id ${args.record_id}.`);
      if (outcome.status === "not_a_draft") {
        return fail(
          `Record ${args.record_id} is ${outcome.recordStatus}; only a record that has not been approved can be declined here.`,
        );
      }
      return ok(
        `Declined record ${args.record_id}; it is set aside and can be restored in the app.`,
        {
          record_id: args.record_id,
          status: "removed",
        },
      );
    }, WRITE_SCOPE),
  );
}

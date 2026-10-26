import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { RECORD_TYPE_LABELS, type RecordType } from "@/types/medical-record";
import {
  applyRecordProposals,
  dismissRecordProposals,
  getPendingCompletions,
  removeRecordDraft,
} from "../health/documents";
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
  description: string | null;
  histology: string | null;
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
  /** What approval sets it to: resolved and history are different chart statuses. */
  status: string;
  evidence: string | null;
}
export interface DraftCompletion {
  title: string;
  done_at: string;
  reason: string;
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
  completions: DraftCompletion[];
  /**
   * An approved record with closures or completions proposed after approval
   * (`propose_reconciliation`): the card asks the owner to confirm those, not to approve the record.
   */
  has_proposals: boolean;
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
  completions?: Array<{ title: string; done_at: string; reason: string }>;
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
      description: text(row.description),
      histology: text(row.histology),
      recognised: Boolean(row.finding_code) && (!siteText || Boolean(row.site_code)),
    };
  });

  const conditions: DraftCondition[] = [];
  const closures: DraftClosure[] = [];
  for (const row of input.conditions) {
    const name =
      text(row.condition_name) ?? text(row.condition_icd_name_ru) ?? text(row.condition_code);
    if (!name) continue;
    const status = String(row.status_in_record ?? "");
    if (row.awaiting_confirmation === true) {
      const code = text(row.supporting_obs_code);
      const cited = input.observations.find((obs) => code && obs.obs_code === code);
      const citedName = cited ? (text(cited.catalog_name_ru) ?? text(cited.obs_name)) : null;
      closures.push({
        name,
        status: CONDITION_STATUS_LABELS[status] ?? status,
        evidence: citedName ?? code,
      });
      continue;
    }
    // A closure a person already dismissed changes nothing, so it is not news on the card.
    if (row.not_applied_reason) continue;
    conditions.push({
      name,
      code: text(row.condition_code),
      status: CONDITION_STATUS_LABELS[status] ?? status,
      proposed: row.is_proposal === true,
    });
  }

  const completions = (input.completions ?? []).map(
    (row): DraftCompletion => ({ title: row.title, done_at: row.done_at, reason: row.reason }),
  );

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
    completions,
    has_proposals:
      String(record.status) === "active" && (closures.length > 0 || completions.length > 0),
  };
}

function reviewUrl(auth: McpAuthExtra, recordId: string): string | null {
  return auth.appOrigin ? `${auth.appOrigin}/health/records/${recordId}` : null;
}

/**
 * The drafts a queued card goes through: this one first, then each listed record that is still a
 * draft and readable by the caller, in the order given. One already decided is left out rather
 * than shown again.
 */
async function loadDraftQueue(
  supabase: SupabaseClient<Database>,
  first: DraftView,
  more: string[],
): Promise<Array<{ record_id: string; title: string }>> {
  const head = { record_id: first.record_id, title: first.title };
  const ids = [...new Set(more)].filter((id) => id !== first.record_id);
  if (ids.length === 0) return [head];
  const { data, error } = await supabase
    .from("medical_records")
    .select("id, title, status")
    .in("id", ids);
  if (error) throw new Error(`Failed to load the queued drafts: ${error.message}`);
  const rows = new Map(
    ((data ?? []) as Array<{ id: string; title: string | null; status: string }>).map((row) => [
      row.id,
      row,
    ]),
  );
  const rest = ids.flatMap((id) => {
    const row = rows.get(id);
    return row && row.status === "structure_review"
      ? [{ record_id: id, title: row.title ?? "Без названия" }]
      : [];
  });
  return [head, ...rest];
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
        "Show the owner an ingested record's draft as a card in the chat: what it will put on the chart (lab values, findings, diagnoses, closures), with Approve and Decline buttons the owner presses on the card. Call it right after ingest_medical_document instead of asking for approval in words. Approve on the card does what activate_medical_record does; Decline removes the draft (restorable in the app). Do not call activate_medical_record yourself after showing the card unless the owner asks you to in words. After propose_reconciliation, call it for that approved record: the card then asks the owner to confirm or decline the proposed closures and checkup completions.",
      inputSchema: z.object({
        record_id: uuidSchema,
        then_record_ids: z
          .array(uuidSchema)
          .max(19)
          .optional()
          .describe(
            "More drafts to go through on the same card after this one, in order. Use it when several documents were ingested together: the owner decides them one after another, and you get one chat message when they are done instead of one per draft.",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: RECORD_DRAFT_RESOURCE_URI },
        "ui/resourceUri": RECORD_DRAFT_RESOURCE_URI,
      },
    },
    withUserClient<{ record_id: string; then_record_ids?: string[] }>(
      async (supabase, args, auth) => {
        const record = await getMedicalRecord(supabase, args.record_id);
        if (!record) return fail(`No medical record with id ${args.record_id}.`);
        const status = String(record.status);
        if (status !== "structure_review" && status !== "active" && status !== "removed") {
          return fail(
            `Record ${args.record_id} is ${status}; it has nothing to show yet. Call ingest_medical_document first.`,
          );
        }

        const [observations, findings, conditions, completions, person] = await Promise.all([
          getRecordObservations(supabase, args.record_id),
          getRecordFindings(supabase, args.record_id),
          getRecordConditions(supabase, args.record_id),
          status === "removed" ? [] : getPendingCompletions(supabase, args.record_id),
          supabase.from("persons").select("name").eq("id", String(record.person_id)).maybeSingle(),
        ]);
        const view = buildDraftView({
          record,
          personName: (person.data as { name?: string } | null)?.name ?? null,
          observations,
          findings,
          conditions,
          completions,
          reviewUrl: reviewUrl(auth, args.record_id),
        });

        const counts = `${view.observations.length} lab value(s), ${view.findings.length} finding(s), ${view.conditions.length} diagnosis mention(s), ${view.closures.length} closure(s) awaiting confirmation, ${view.completions.length} checkup completion(s) awaiting confirmation`;
        const next =
          status === "structure_review"
            ? "The owner approves or declines it on the card; end your turn and wait: when they press a button the card posts a short message from them in the chat, and the outcome is in your context. If the card does not show, give them the review link instead."
            : view.has_proposals
              ? "It is approved; the owner confirms or declines the proposed closures and completions on the card. Nothing has changed on the chart until they confirm; end your turn and wait: when they press a button the card posts a short message from them in the chat, and the outcome is in your context."
              : status === "active"
                ? "It is already approved."
                : "It was declined and set aside.";
        const queue = await loadDraftQueue(supabase, view, args.then_record_ids ?? []);
        return ok(
          [
            `Showing the draft of "${view.title}" (${counts}). ${next}`,
            queue.length > 1
              ? `The card then goes through ${queue.length - 1} more draft(s): ${queue
                  .slice(1)
                  .map((item) => `"${item.title}"`)
                  .join(
                    ", ",
                  )}. You get one message from the owner when they have been through them.`
              : null,
            view.review_url ? `Review link: ${view.review_url}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          queue.length > 1 ? { draft: view, queue } : { draft: view },
        );
      },
    ),
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
  server.registerTool(
    "confirm_record_proposals",
    {
      title: "Confirm proposed closures",
      description:
        "Used by the record draft card's Confirm button on an approved record: the closures and checkup completions proposed for it reach the chart.",
      inputSchema: z.object({ record_id: uuidSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    withUserClient<{ record_id: string }>(async (supabase, args) => {
      const record = await getMedicalRecord(supabase, args.record_id);
      if (!record) return fail(`No medical record with id ${args.record_id}.`);
      if (record.status !== "active") {
        return fail(
          `Record ${args.record_id} is ${String(record.status)}; only an approved record's proposals are confirmed here.`,
        );
      }
      const outcome = await applyRecordProposals(supabase, args.record_id);
      const lines = [
        `Confirmed on "${String(record.title)}": ${outcome.mentionsConfirmed} closure(s), ${outcome.checkupsCompleted} checkup(s) marked done.`,
      ];
      if (outcome.closuresLeftPending > 0) {
        lines.push(
          `${outcome.closuresLeftPending} closure(s) left awaiting confirmation: the measurement they cite is no longer in range on this record.`,
        );
      }
      return ok(lines.join("\n"), { record_id: args.record_id, status: "active", ...outcome });
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "dismiss_record_proposals",
    {
      title: "Decline proposed closures",
      description:
        "Used by the record draft card's Decline button on an approved record: the closures and checkup completions proposed for it are turned down, and the record itself stays approved.",
      inputSchema: z.object({ record_id: uuidSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    withUserClient<{ record_id: string }>(async (supabase, args) => {
      const record = await getMedicalRecord(supabase, args.record_id);
      if (!record) return fail(`No medical record with id ${args.record_id}.`);
      if (record.status !== "active") {
        return fail(
          `Record ${args.record_id} is ${String(record.status)}; only an approved record's proposals are declined here.`,
        );
      }
      const outcome = await dismissRecordProposals(supabase, args.record_id);
      return ok(
        `Declined on "${String(record.title)}": ${outcome.closuresDismissed} closure(s), ${outcome.completionsDropped} checkup completion(s). The record stays approved.`,
        { record_id: args.record_id, status: "active", ...outcome },
      );
    }, WRITE_SCOPE),
  );
}

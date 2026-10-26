import { z } from "zod";
import type { IcdLookupResult } from "@/types";
import {
  ALLOWED_PAGE_MIME_TYPES,
  MAX_PAGE_BYTES,
  activateMedicalRecord,
  createDraftRecord,
  dismissConditionClosure,
  findMissingPages,
  getIngestCandidates,
  getIngestableRecord,
  getRecordExtractionIssues,
  isIngestableStatus,
  signPageUploads,
  suggestReconciliation,
  type PageUpload,
} from "../health/documents";
import {
  reviewReconciliationDecision,
  type ReconciliationDecision,
  type ReconciliationSuggestion,
} from "../health/reconciliation-gate";
import { getRecordConditions, getRecordFindings, getRecordObservations } from "../health/records";
import { isoDateSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { invokeEdgeFunctionAsUser } from "../supabase-user-client";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok } from "../tool-result";
import type { McpAuthExtra } from "../verify-token";
import { RECORD_TYPES } from "./records";
import { WRITE_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

/**
 * Bringing a medical document in from the owner's own Claude (ADR-261021-z02, T-260914-6n1).
 *
 * The client reads the pages; the server decides what reaches the chart. The flow is: create the
 * record and upload its pages, look up what the document could close, submit the transcription and
 * extraction, then approve -- or leave the record in review for the owner to approve in the app.
 */

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const anchor = z
  .string()
  .describe(
    "A short snippet copied verbatim from source_text. Anything whose anchor is not found in source_text is refused.",
  );
const confidence = z.number().min(0).max(1).optional();

const observationSchema = z.object({
  obs_name_text: z.string().describe("The analyte label exactly as printed."),
  value: z.string().describe("The value as printed."),
  value_numeric: nullableNumber,
  unit_text: nullableString.describe("The unit exactly as printed; the server converts it."),
  ref_range: nullableString,
  ref_range_low: nullableNumber,
  ref_range_high: nullableNumber,
  status: z
    .enum(["normal", "low", "high", "critical_low", "critical_high", "unknown"])
    .nullable()
    .optional(),
  source_anchor: anchor,
  confidence,
});

const findingFields = {
  finding_type_text: z
    .string()
    .describe(
      "What was seen, as written. The server codes the finding from this label, so it must match a finding_type catalogue name or synonym.",
    ),
  finding_code: nullableString.describe(
    "Ignored: the server takes the code from finding_type_text. Kept for compatibility.",
  ),
  body_site_text: nullableString.describe(
    "Where, as written. The server codes the site from this label, so it must match a body_site catalogue name or synonym.",
  ),
  site_code: nullableString.describe(
    "Ignored: the server takes the code from body_site_text. Kept for compatibility.",
  ),
};

const findingSchema = z.object({
  ...findingFields,
  size_mm: nullableNumber,
  count: nullableNumber,
  severity: z.enum(["mild", "moderate", "severe", "unknown"]).optional(),
  laterality: z.enum(["left", "right", "bilateral", "none"]).optional(),
  morphology: nullableString,
  description: nullableString,
  histology: nullableString,
  finding_date: isoDateSchema.nullable().optional(),
  source_anchor: anchor,
  confidence,
});

const conditionSchema = z.object({
  name: z.string(),
  icd_code: nullableString.describe("ICD-10 code if the document gives one."),
  status: z.enum(["active", "resolved", "suspected", "history"]),
  source_anchor: anchor,
  confidence,
});

const absenceSchema = z.object({ ...findingFields, source_anchor: anchor, confidence });

const PAGE_RULES = `Pages: ${ALLOWED_PAGE_MIME_TYPES.join(", ")}, up to ${MAX_PAGE_BYTES / 1024 / 1024} MiB each.`;

function formatUploads(uploads: PageUpload[]): string {
  return uploads
    .map(
      (upload, index) =>
        `${index + 1}. ${upload.filename} (${upload.mime_type})\n   curl -sS -X PUT -H "Content-Type: ${upload.mime_type}" --data-binary @"<local path to ${upload.filename}>" "${upload.upload_url}"`,
    )
    .join("\n");
}

function formatSuggestion(item: ReconciliationSuggestion): string {
  const id = item.kind === "condition" ? `condition_id ${item.id}` : `checkup_item_id ${item.id}`;
  return `- ${item.kind}: ${item.label} -- ${item.reason} (${id})`;
}

const RECONCILE_YOURSELF =
  "The server sees only words and dates, so also add anything else this document closes that you found yourself: get_ingest_candidates lists every condition, open finding and scheduled checkup with its id. A diagnosis the document establishes that the person does not have yet goes in extraction.conditions.";

/** Why a submission that has not decided what the document closes is sent back, and what to do. */
function reconciliationRefusal(
  verdict: Exclude<ReturnType<typeof reviewReconciliationDecision>, { ok: true }>,
  alsoDue: ReconciliationSuggestion[],
): string {
  const lines = [
    "Not ingested: decide what this document closes first, in this same call, then send it again. Nothing was stored.",
  ];
  if (verdict.unruled.length > 0) {
    lines.push(
      verdict.missing === "decision"
        ? "The server thinks this document may close:"
        : "The server thinks this document may close these, and reconciliation does not rule on them:",
      ...verdict.unruled.map(formatSuggestion),
      "For each one: put it in reconciliation.conditions_to_resolve or reconciliation.checkups_to_complete, or in reconciliation.not_applicable with the reason it does not apply.",
    );
  } else {
    lines.push(
      verdict.missing === "decision"
        ? "reconciliation is missing. The server found nothing this document obviously closes, but say so yourself."
        : "reconciliation closes nothing and does not say that nothing applies.",
    );
  }
  if (alsoDue.length > 0) {
    lines.push(
      "Also due in the period this document dates from (complete them if the document covers them):",
      ...alsoDue.map(formatSuggestion),
    );
  }
  lines.push(
    RECONCILE_YOURSELF,
    "When the document closes nothing, send reconciliation.nothing_to_reconcile: true.",
  );
  return lines.join("\n");
}

function formatRejections(label: string, rows: unknown): string[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return [
    `${label}:`,
    ...rows.map((row) => {
      const entry = row as { entityKind?: string; reason?: string };
      return `- ${entry.entityKind ?? "entity"}: ${entry.reason ?? "no reason given"}`;
    }),
  ];
}

/** The ICD catalogue behind the app's own lookup; an unreachable catalogue must not block approval. */
async function lookupIcd(auth: McpAuthExtra, code: string): Promise<IcdLookupResult | null> {
  try {
    const { status, payload } = await invokeEdgeFunctionAsUser(auth, "icd-lookup", { code });
    return status === 200 && payload && typeof payload === "object"
      ? (payload as IcdLookupResult)
      : null;
  } catch {
    return null;
  }
}

/** The record's page in the app, where the owner reviews it and approves or deletes it. */
function reviewUrl(auth: McpAuthExtra, recordId: string): string | null {
  return auth.appOrigin ? `${auth.appOrigin}/health/records/${recordId}` : null;
}

export function registerDocumentTools(server: McpToolServer): void {
  server.registerTool(
    "create_medical_record",
    {
      title: "Create medical record",
      description: `Start bringing in a medical document you have read: creates a draft record for the person and returns one upload link per page, with the curl command that uploads it. Upload every page, then call ingest_medical_document with what you read. ${PAGE_RULES} The draft is visible in the app; nothing reaches the chart until the record is approved.`,
      inputSchema: z.object({
        ...personSelectorSchema,
        record_type: z.enum(RECORD_TYPES),
        title: z.string().min(1).describe("Short title, e.g. the name of the test or visit."),
        record_date: isoDateSchema
          .optional()
          .describe("Date the document describes (YYYY-MM-DD), if you know it."),
        pages: z
          .array(
            z.object({
              filename: z.string().min(1),
              mime_type: z.enum(ALLOWED_PAGE_MIME_TYPES),
            }),
          )
          .min(1)
          .max(30)
          .describe("The files of the document, in page order."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withPerson<{
      person_id?: string;
      person_name?: string;
      record_type: (typeof RECORD_TYPES)[number];
      title: string;
      record_date?: string;
      pages: Array<{ filename: string; mime_type: (typeof ALLOWED_PAGE_MIME_TYPES)[number] }>;
    }>(async (supabase, person, args, auth) => {
      const { recordId, uploads } = await createDraftRecord(supabase, {
        personId: person.id,
        userId: auth.authUserId,
        recordType: args.record_type,
        recordDate: args.record_date ?? null,
        title: args.title.trim(),
        pages: args.pages,
      });

      return ok(
        [
          `Created draft record "${args.title.trim()}" for ${person.name} (record_id ${recordId}).`,
          `Upload each page with its link (valid for two hours, one upload each):`,
          formatUploads(uploads),
          `Then call ingest_medical_document with record_id ${recordId}.`,
        ].join("\n"),
        {
          record_id: recordId,
          person_id: person.id,
          uploads,
          review_url: reviewUrl(auth, recordId),
        },
      );
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "get_ingest_candidates",
    {
      title: "Get what a document could close",
      description:
        "List what a new document about this person could close: their conditions (with the condition_id a closure must cite), their open imaging findings, and their scheduled checkups (with the checkup_item_id a completion must cite). Call this before every ingest_medical_document: ingest refuses a submission that has not decided what the document closes, and the decision goes in that same call, not later.",
      inputSchema: z.object({ ...personSelectorSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson<{ person_id?: string; person_name?: string }>(async (supabase, person) => {
      const candidates = await getIngestCandidates(supabase, person.id);
      const lines = [
        `What a document about ${person.name} could close:`,
        `Conditions (${candidates.conditions.length}):`,
        ...candidates.conditions.map(
          (c) =>
            `- ${c.name}${c.code ? ` [${c.code}]` : ""} — ${c.current_status} (condition_id ${c.id})`,
        ),
        `Open findings (${candidates.findings.length}):`,
        ...candidates.findings.map(
          (f) =>
            `- ${f.finding_type_text}${f.finding_code ? ` [${f.finding_code}]` : ""}${f.body_site_text || f.site_code ? ` at ${f.body_site_text ?? ""}${f.site_code ? ` [${f.site_code}]` : ""}` : ""}`,
        ),
        `Scheduled checkups (${candidates.checkups.length}):`,
        ...candidates.checkups.map(
          (c) => `- ${c.title} (${c.category}), due ${c.next_due_at} (checkup_item_id ${c.id})`,
        ),
      ];
      return ok(lines.join("\n"), { person_id: person.id, ...candidates });
    }),
  );

  server.registerTool(
    "ingest_medical_document",
    {
      title: "Ingest medical document",
      description: [
        "Submit what you read from a record's uploaded pages. The server runs its own checks on it, the same ones the app's pipeline runs: every entity's source_anchor must appear verbatim in source_text; lab names are matched to the observation catalogue and values converted to canonical units; a condition closure is accepted only when this document's own in-range measurement supports it, and is left pending confirmation; a finding closure is accepted only when an asserted absence in this document covers it.",
        "Print names and units as written. Put a finding the document says is NOT there (e.g. 'конкременты не выявлены') in extraction.asserted_absences, never in findings.",
        "Before submitting findings or absences, look up each finding type and body site with search_catalog_entries (catalogs finding_type and body_site). The server codes them from their labels, and a label no entry carries stays uncoded: it cannot be tracked over time, and uncoded findings at different sites merge into one history. When an entry is missing, add it first with upsert_catalog_entry, putting the document's wording in its Russian synonyms; when one exists under another wording, add that wording as a synonym. One finding per site.",
        "Every submission carries reconciliation, decided now and not after approval: the conditions this document resolves, the findings it settles and the checkups it completes (ids from get_ingest_candidates), the server's suggestions you rule out in not_applicable with a reason, or nothing_to_reconcile: true when it closes nothing. A submission without that decision, or that leaves a server suggestion unruled, is refused before anything is stored, and the refusal lists what the server thinks the document may close.",
        "The record moves to review, not to the chart. The reply lists what was stored, what was refused and why, observations the catalogue did not recognise (dropped at approval unless added with upsert_catalog_entry and the document re-ingested), and closures awaiting confirmation. Re-submitting replaces the previous submission for this record.",
      ].join(" "),
      inputSchema: z.object({
        record_id: uuidSchema,
        source_text: z
          .string()
          .min(1)
          .describe(
            "The full text of the document as you transcribed it from the pages, in reading order. Stored as the record's text.",
          ),
        classification: z.object({
          record_type: z.enum(RECORD_TYPES),
          title: z.string(),
          record_date: isoDateSchema.nullable(),
          summary: z.string().describe("Two or three factual sentences, no advice."),
          keywords: z.array(z.string()).max(12).default([]),
        }),
        extraction: z.object({
          observations: z.array(observationSchema).default([]),
          findings: z.array(findingSchema).default([]),
          conditions: z.array(conditionSchema).default([]),
          asserted_absences: z.array(absenceSchema).default([]),
        }),
        reconciliation: z
          .object({
            conditions_to_resolve: z
              .array(
                z.object({
                  condition_id: uuidSchema.describe("From get_ingest_candidates."),
                  supporting_obs_code: nullableString.describe(
                    "The observation code of the in-range measurement in this document that shows it resolved (e.g. vitamin_b12).",
                  ),
                  reason: z.string(),
                  source_anchor: anchor,
                  confidence,
                }),
              )
              .default([]),
            findings_to_resolve: z
              .array(
                z.object({
                  ...findingFields,
                  reason: z.string(),
                  source_anchor: anchor,
                  confidence,
                }),
              )
              .default([]),
            checkups_to_complete: z
              .array(
                z.object({
                  checkup_item_id: uuidSchema.describe("From get_ingest_candidates."),
                  suggested_done_at: isoDateSchema,
                  reason: z.string(),
                }),
              )
              .default([]),
            not_applicable: z
              .array(
                z.object({
                  id: uuidSchema.describe(
                    "The condition_id or checkup_item_id of a suggestion this document does not close.",
                  ),
                  reason: z.string().min(1),
                }),
              )
              .default([])
              .describe(
                "Suggestions the server made that you checked and that this document does not close, each with why.",
              ),
            nothing_to_reconcile: z
              .boolean()
              .optional()
              .describe(
                "true when you checked and this document closes nothing; required when every list above is empty.",
              ),
          })
          .optional()
          .describe(
            "Required: what this document shows has resolved or been done, decided in this call. Send nothing_to_reconcile: true when nothing has; a submission without reconciliation is refused.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<{
      record_id: string;
      source_text: string;
      classification: Record<string, unknown>;
      extraction: Record<string, unknown>;
      reconciliation?: Record<string, unknown>;
    }>(async (supabase, args, auth) => {
      const record = await getIngestableRecord(supabase, args.record_id);
      if (!record) return fail(`No medical record with id ${args.record_id}.`);
      if (!isIngestableStatus(record.status)) {
        return fail(
          `Record ${args.record_id} is ${record.status}; only a record that has not been approved can be ingested. Create a new record for a new document.`,
        );
      }

      const missing = await findMissingPages(supabase, record);
      if (missing.length > 0) {
        const uploads = await signPageUploads(supabase, missing);
        return fail(
          [
            `${missing.length} of ${record.attachments.length} page(s) of this record have not been uploaded. Upload them, then call ingest_medical_document again:`,
            formatUploads(uploads),
          ].join("\n"),
          { record_id: record.id, uploads },
        );
      }

      const decision = args.reconciliation as ReconciliationDecision | undefined;
      const classification = args.classification as { record_date?: unknown };
      const extraction = args.extraction as { observations?: Array<{ obs_name_text?: unknown }> };
      const context = await suggestReconciliation(supabase, record.person_id, {
        recordDate:
          typeof classification.record_date === "string" ? classification.record_date : null,
        sourceText: args.source_text,
        observationLabels: (extraction.observations ?? []).flatMap((row) =>
          typeof row.obs_name_text === "string" ? [row.obs_name_text] : [],
        ),
      });
      const verdict = reviewReconciliationDecision(context, decision);
      if (!verdict.ok) {
        return fail(reconciliationRefusal(verdict, context.alsoDue), {
          record_id: record.id,
          suggestions: verdict.unruled,
          also_due: context.alsoDue,
        });
      }

      // The rulings and the flag are this tool's own; the edge function takes the closures.
      const ruledOut = decision?.not_applicable ?? [];
      const reconciliation = {
        conditions_to_resolve: decision?.conditions_to_resolve ?? [],
        findings_to_resolve: decision?.findings_to_resolve ?? [],
        checkups_to_complete: decision?.checkups_to_complete ?? [],
      };
      const { status, payload } = await invokeEdgeFunctionAsUser(auth, "health-ingest", {
        record_id: record.id,
        source_text: args.source_text,
        classification: args.classification,
        extraction: args.extraction,
        reconciliation,
      });
      const result = (payload && typeof payload === "object" ? payload : {}) as {
        success?: boolean;
        error?: string;
        rejected?: unknown[];
        dropped_condition_resolutions?: unknown[];
      };
      if (status !== 200 || result.success !== true) {
        return fail(
          `The server did not accept the document (HTTP ${status}): ${result.error ?? (typeof payload === "string" ? payload.slice(0, 500) : "no reason given")}`,
        );
      }

      const [observations, findings, conditions, issues] = await Promise.all([
        getRecordObservations(supabase, record.id),
        getRecordFindings(supabase, record.id),
        getRecordConditions(supabase, record.id),
        getRecordExtractionIssues(supabase, record.id),
      ]);
      const unmatched = observations.filter((row) => row.is_applied !== true);
      const uncoded = findings.filter((row) => !row.finding_code || !row.site_code);
      const pending = conditions.filter((row) => row.awaiting_confirmation === true);

      const lines = [
        `Ingested record ${record.id}; it is now in review, not on the chart.`,
        ...(ruledOut.length > 0
          ? [
              `Ruled out by you: ${ruledOut.map((item) => `${String(item.id)} (${String(item.reason)})`).join("; ")}.`,
            ]
          : []),
        `Stored ${observations.length} observation(s), ${findings.length} finding(s), ${conditions.length} diagnosis mention(s).`,
      ];
      if (unmatched.length > 0) {
        lines.push(
          `Not recognised by the observation catalogue (dropped at approval unless added with upsert_catalog_entry and re-ingested):`,
          ...unmatched.map((row) =>
            `- ${String(row.obs_name)} ${String(row.value_text ?? "")} ${String(row.unit ?? "")}`.trimEnd(),
          ),
        );
      }
      if (uncoded.length > 0) {
        lines.push(
          `Findings the catalogues did not recognise (add the finding type or body site with upsert_catalog_entry, with this wording as a synonym, and re-ingest; uncoded, they cannot be tracked over time):`,
          ...uncoded.map(
            (row) =>
              `- ${String(row.finding_type_text)}${row.finding_code ? "" : " (no finding type)"}${row.body_site_text ? ` at ${String(row.body_site_text)}` : ""}${row.site_code ? "" : " (no body site)"}`,
          ),
        );
      }
      if (pending.length > 0) {
        lines.push(
          `Closures awaiting confirmation (approving the record confirms them; dismiss_condition_closure rejects one):`,
          ...pending.map(
            (row) =>
              `- ${String(row.condition_name)} → ${String(row.status_in_record)}, citing ${String(row.supporting_obs_code ?? "no measurement")} (condition_record_id ${String(row.id)})`,
          ),
        );
      }
      lines.push(
        ...formatRejections("Refused", result.rejected),
        ...formatRejections("Condition closures refused", result.dropped_condition_resolutions),
      );
      if (issues.length > 0) {
        lines.push(
          `Corrections made while storing:`,
          ...issues.map(
            (issue) =>
              `- ${String(issue.entity_kind)}${issue.entity_label ? ` "${String(issue.entity_label)}"` : ""}${issue.field ? ` ${String(issue.field)}` : ""}: ${String(issue.resolution)}${issue.received ? ` (received ${String(issue.received)})` : ""}`,
          ),
        );
      }
      const review = reviewUrl(auth, record.id);
      lines.push(
        review
          ? `Next: call show_record_draft so the owner approves or declines the draft on its card in this chat. If the card does not show, give them this link to review it in the app: ${review}. Call activate_medical_record yourself only when they agree in words.`
          : `Next: call show_record_draft so the owner approves or declines the draft on its card in this chat. Call activate_medical_record yourself only when they agree in words.`,
      );

      return ok(lines.join("\n"), {
        record_id: record.id,
        observations,
        findings,
        conditions,
        extraction_issues: issues,
        rejected: result.rejected ?? [],
        dropped_condition_resolutions: result.dropped_condition_resolutions ?? [],
        review_url: review,
      });
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "dismiss_condition_closure",
    {
      title: "Dismiss proposed condition closure",
      description:
        "Reject a closure a document proposed for a condition (one listed as awaiting confirmation). The condition stays as it was, and approving the record later will not confirm this closure.",
      inputSchema: z.object({
        condition_record_id: uuidSchema.describe(
          "From ingest_medical_document or get_medical_record.",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<{ condition_record_id: string }>(async (supabase, args) => {
      const { status } = await dismissConditionClosure(supabase, args.condition_record_id);
      if (status === "not_found") {
        return fail(`No diagnosis mention with id ${args.condition_record_id}.`);
      }
      if (status === "not_a_pending_closure") {
        return fail(
          `Diagnosis mention ${args.condition_record_id} is not an unconfirmed closure, so there is nothing to dismiss.`,
        );
      }
      return ok(`Dismissed closure ${args.condition_record_id}; the condition keeps its status.`, {
        condition_record_id: args.condition_record_id,
        review_decision: "dismissed",
      });
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "activate_medical_record",
    {
      title: "Approve medical record",
      description:
        "Approve an ingested record, as the owner's Approve button in the app does: unrecognised observations are dropped, proposed diagnoses become conditions, the record's data goes on the chart, closures awaiting confirmation are confirmed unless the measurement they cite no longer holds, and suggested checkup completions are recorded. Only after the owner has agreed to what the record says.",
      inputSchema: z.object({ record_id: uuidSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<{ record_id: string }>(async (supabase, args, auth) => {
      const record = await getIngestableRecord(supabase, args.record_id);
      if (!record) return fail(`No medical record with id ${args.record_id}.`);
      if (record.status !== "structure_review") {
        return fail(
          `Record ${args.record_id} is ${record.status}; only a record in review can be approved. Ingest it first.`,
        );
      }

      const outcome = await activateMedicalRecord(supabase, record, {
        lookupIcd: (code) => lookupIcd(auth, code),
      });

      const lines = [`Approved "${record.title}"; it is on the chart now.`];
      if (outcome.droppedUnmatchedObservations > 0) {
        lines.push(`Dropped ${outcome.droppedUnmatchedObservations} unrecognised observation(s).`);
      }
      lines.push(
        `New or linked conditions: ${outcome.proposalsMaterialized}${outcome.proposalsSkipped > 0 ? ` (${outcome.proposalsSkipped} proposal(s) skipped: no name to match on)` : ""}. Diagnosis mentions confirmed: ${outcome.mentionsConfirmed}. Checkups marked done: ${outcome.checkupsCompleted}.`,
      );
      if (outcome.closuresLeftPending > 0) {
        lines.push(
          `${outcome.closuresLeftPending} closure(s) left awaiting confirmation: the measurement they cite is no longer in range on this record.`,
        );
      }
      return ok(lines.join("\n"), { record_id: record.id, ...outcome });
    }, WRITE_SCOPE),
  );
}

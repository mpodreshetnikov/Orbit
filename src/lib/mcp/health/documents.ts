import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ConditionRecordWithDetails, IcdLookupResult } from "@/types";
import {
  materializeConditionProposals,
  recomputeConditionCurrentStatus,
} from "@/lib/conditions/materialize-proposals";
import {
  proposedClosureStillHolds,
  type PersistedObservation,
} from "@/lib/conditions/resolution-proposal";
import { isConfirmedByRecordApproval, isUnverifiedClosure } from "@/types/condition-closure";
import {
  pickReconciliationSuggestions,
  type GateCheckup,
  type GateCondition,
  type ReconciliationContext,
} from "./reconciliation-gate";

/**
 * Bringing a document in over MCP (ADR-261021-z02, T-260914-6n1).
 *
 * The owner's Claude reads the pages itself; the server keeps everything that decides what reaches
 * the chart. So this layer does the parts of the web upload and review screens that are not
 * reading: it opens a draft record and hands out upload links for its pages, lists what the
 * document could close, and activates the record by the same rules the review screen's Approve
 * button applies. The extraction itself goes to the `health-ingest` edge function, which runs the
 * server's own stages on it.
 */

export const ATTACHMENT_BUCKET = "medical-attachments";

/** What the bucket accepts (`storage.buckets.allowed_mime_types` on `medical-attachments`). */
export const ALLOWED_PAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export const MAX_PAGE_BYTES = 20 * 1024 * 1024;

/** Statuses a document may be ingested from: never one a person has already approved. */
const INGESTABLE = ["draft", "ocr_failed", "ocr_review", "structure_review"] as const;
const INGESTABLE_STATUSES = new Set<string>(INGESTABLE);

const OBSERVATION_RECHECK_COLUMNS =
  "obs_code, is_applied, value_numeric, value_canonical, ref_range_low, ref_range_high, ref_range_low_canonical, ref_range_high_canonical, status";

export interface PageUpload {
  attachment_id: string;
  filename: string;
  mime_type: string;
  storage_path: string;
  upload_url: string;
}

/** Storage keys take ASCII only; the original name is kept on the attachment row. */
export function storagePathForPage(
  personId: string,
  recordId: string,
  index: number,
  filename: string,
): string {
  return `${personId}/${recordId}/${index + 1}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
}

/**
 * A draft record with one attachment row per page, and a signed upload link for each.
 *
 * The rows are written first and the files arrive later, by the client's own PUT; ingestion checks
 * that every page actually landed before it accepts the document. The draft is ordinary: the web
 * app lists it, and deleting it there removes its folder.
 */
export async function createDraftRecord(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    userId: string;
    recordType: Database["public"]["Enums"]["record_type"];
    recordDate: string | null;
    title: string;
    pages: Array<{ filename: string; mime_type: string }>;
  },
): Promise<{ recordId: string; uploads: PageUpload[] }> {
  const { data: record, error } = await supabase
    .from("medical_records")
    .insert({
      person_id: params.personId,
      created_by_user_id: params.userId,
      record_type: params.recordType,
      record_date: params.recordDate,
      title: params.title,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !record) {
    throw new Error(`Failed to create the record: ${error?.message ?? "no row returned"}`);
  }
  const recordId = (record as { id: string }).id;

  const rows = params.pages.map((page, index) => ({
    record_id: recordId,
    storage_path: storagePathForPage(params.personId, recordId, index, page.filename),
    mime_type: page.mime_type,
    original_filename: page.filename,
    sort_order: index,
  }));
  const { data: attachments, error: attachmentError } = await supabase
    .from("record_attachments")
    .insert(rows)
    .select("id, storage_path, mime_type, original_filename");
  if (attachmentError || !attachments) {
    // A record with no pages is not what was asked for; take it back out rather than leave it.
    await supabase.from("medical_records").delete().eq("id", recordId);
    throw new Error(
      `Failed to register the pages: ${attachmentError?.message ?? "no rows returned"}`,
    );
  }

  const uploads = await signPageUploads(
    supabase,
    attachments as Array<{
      id: string;
      storage_path: string;
      mime_type: string;
      original_filename: string;
    }>,
  );
  return { recordId, uploads };
}

/**
 * A signed upload link per page. Storage keeps the link valid for two hours and accepts one upload
 * through it; a page whose file never arrived can simply be signed again.
 */
export async function signPageUploads(
  supabase: SupabaseClient<Database>,
  attachments: Array<{
    id: string;
    storage_path: string;
    mime_type: string;
    original_filename: string;
  }>,
): Promise<PageUpload[]> {
  const uploads: PageUpload[] = [];
  for (const attachment of attachments) {
    const { data: signed, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(attachment.storage_path);
    if (error || !signed) {
      throw new Error(
        `Failed to create an upload link for ${attachment.original_filename}: ${error?.message ?? "no link returned"}`,
      );
    }
    uploads.push({
      attachment_id: attachment.id,
      filename: attachment.original_filename,
      mime_type: attachment.mime_type,
      storage_path: attachment.storage_path,
      upload_url: signed.signedUrl,
    });
  }
  return uploads;
}

export interface IngestableRecord {
  id: string;
  person_id: string;
  status: string;
  title: string;
  attachments: Array<{
    id: string;
    original_filename: string;
    storage_path: string;
    mime_type: string;
  }>;
}

export async function getIngestableRecord(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<IngestableRecord | null> {
  const { data, error } = await supabase
    .from("medical_records")
    .select(
      "id, person_id, status, title, attachments:record_attachments ( id, original_filename, storage_path, mime_type )",
    )
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the record: ${error.message}`);
  return (data as unknown as IngestableRecord | null) ?? null;
}

export function isIngestableStatus(status: string): boolean {
  return INGESTABLE_STATUSES.has(status);
}

/** The pages of a record whose file is not in storage yet. */
export async function findMissingPages(
  supabase: SupabaseClient<Database>,
  record: IngestableRecord,
): Promise<IngestableRecord["attachments"]> {
  const folder = `${record.person_id}/${record.id}`;
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .list(folder, { limit: 1000 });
  if (error) throw new Error(`Failed to check the uploaded pages: ${error.message}`);
  const present = new Set((data ?? []).map((file) => `${folder}/${file.name}`));
  return record.attachments.filter((attachment) => !present.has(attachment.storage_path));
}

export interface IngestCandidates {
  conditions: Array<{
    id: string;
    name: string;
    code: string | null;
    current_status: string;
  }>;
  findings: Array<{
    finding_code: string | null;
    finding_type_text: string;
    site_code: string | null;
    body_site_text: string | null;
  }>;
  checkups: Array<{ id: string; title: string; category: string; next_due_at: string }>;
}

/**
 * What a document about this person could close, with the ids the reconciliation must cite.
 *
 * The same three lists the server's own reconcile stage is shown, read the same way, so a closure
 * the client proposes refers to exactly the rows `health-ingest` will check it against.
 */
export async function getIngestCandidates(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<IngestCandidates> {
  const [conditions, findings, checkups] = await Promise.all([
    supabase
      .from("conditions")
      .select("id, name, code, current_status")
      .eq("person_id", personId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("record_findings")
      .select(
        "finding_code, finding_type_text, site_code, body_site_text, resolution_status, medical_records!inner(person_id, status)",
      )
      .eq("medical_records.person_id", personId)
      .eq("medical_records.status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("checkup_items")
      .select("id, title, category, next_due_at")
      .eq("person_id", personId)
      .eq("status", "active")
      .not("next_due_at", "is", null)
      .order("next_due_at", { ascending: true }),
  ]);
  for (const result of [conditions, findings, checkups]) {
    if (result.error)
      throw new Error(`Failed to load what the document could close: ${result.error.message}`);
  }

  // One entry per finding and site: the history holds every report that mentioned it, and a
  // resolution row closes the finding it names rather than being an open finding itself.
  const seen = new Set<string>();
  const openFindings: IngestCandidates["findings"] = [];
  for (const row of (findings.data ?? []) as Array<Record<string, unknown>>) {
    if (row.resolution_status === "resolved") continue;
    const finding = {
      finding_code: (row.finding_code as string | null) ?? null,
      finding_type_text: (row.finding_type_text as string | null) ?? "Unknown finding",
      site_code: (row.site_code as string | null) ?? null,
      body_site_text: (row.body_site_text as string | null) ?? null,
    };
    const key = `${finding.finding_code ?? finding.finding_type_text.toLowerCase()}::${finding.site_code ?? finding.body_site_text ?? "none"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    openFindings.push(finding);
  }

  return {
    conditions: (conditions.data ?? []) as IngestCandidates["conditions"],
    findings: openFindings,
    checkups: (checkups.data ?? []) as IngestCandidates["checkups"],
  };
}

/**
 * What this document looks able to close, from the person's conditions and checkups as they stand
 * (`reconciliation-gate.ts` decides; this only reads). A hint the agent must rule on before
 * `health-ingest` is called, never a closure.
 */
export async function suggestReconciliation(
  supabase: SupabaseClient<Database>,
  personId: string,
  document: { recordDate: string | null; sourceText: string; observationLabels: string[] },
): Promise<ReconciliationContext> {
  const [conditions, checkups] = await Promise.all([
    supabase
      .from("conditions")
      .select("id, name, code, current_status")
      .eq("person_id", personId)
      .is("deleted_at", null),
    supabase
      .from("checkup_items")
      .select("id, title, category, schedule, next_due_at")
      .eq("person_id", personId)
      .eq("status", "active")
      .not("next_due_at", "is", null)
      .order("next_due_at", { ascending: true }),
  ]);
  for (const result of [conditions, checkups]) {
    if (result.error) {
      throw new Error(`Failed to load what the document could close: ${result.error.message}`);
    }
  }

  const items = (checkups.data ?? []) as Array<Omit<GateCheckup, "last_done_at">>;
  const lastDone = new Map<string, string>();
  if (items.length > 0) {
    const { data, error } = await supabase
      .from("checkup_completions")
      .select("checkup_item_id, done_at")
      .in(
        "checkup_item_id",
        items.map((item) => item.id),
      )
      .order("done_at", { ascending: false });
    if (error) throw new Error(`Failed to load checkup completions: ${error.message}`);
    for (const row of (data ?? []) as Array<{ checkup_item_id: string; done_at: string }>) {
      if (!lastDone.has(row.checkup_item_id)) lastDone.set(row.checkup_item_id, row.done_at);
    }
  }

  return pickReconciliationSuggestions({
    conditions: (conditions.data ?? []) as GateCondition[],
    checkups: items.map((item) => ({ ...item, last_done_at: lastDone.get(item.id) ?? null })),
    recordDate: document.recordDate,
    sourceText: document.sourceText,
    observationLabels: document.observationLabels,
    today: new Date().toISOString().slice(0, 10),
  });
}

export async function getRecordExtractionIssues(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from("record_extraction_issues")
    .select("entity_kind, entity_label, field, received, resolution, applied_fallback, detail")
    .eq("record_id", recordId);
  if (error) throw new Error(`Failed to load extraction issues: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Reject a proposed closure. Mirrors the review screen's Dismiss: the decision is recorded and the
 * row is deliberately left unverified, so it stays suppressed and approving the record later does
 * not sweep it back up (`isConfirmedByRecordApproval`).
 */
export async function dismissConditionClosure(
  supabase: SupabaseClient<Database>,
  conditionRecordId: string,
): Promise<{ status: "dismissed" | "not_found" | "not_a_pending_closure" }> {
  const { data, error } = await supabase
    .from("condition_records")
    .select("id, status_in_record, is_llm_extracted, is_user_verified, review_decision")
    .eq("id", conditionRecordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the closure: ${error.message}`);
  if (!data) return { status: "not_found" };

  const row = data as {
    status_in_record: string;
    is_llm_extracted: boolean;
    is_user_verified: boolean;
  };
  if (!isUnverifiedClosure(row)) return { status: "not_a_pending_closure" };

  const { error: updateError } = await supabase
    .from("condition_records")
    .update({ review_decision: "dismissed" })
    .eq("id", conditionRecordId);
  if (updateError) throw new Error(`Failed to dismiss the closure: ${updateError.message}`);
  return { status: "dismissed" };
}

/**
 * Decline a record nobody has approved, as the app's Remove does: the record is set aside, not
 * erased, so it can still be restored from the app. An approved record is refused -- taking a
 * record off the chart is a decision for the app, not for a card in a chat.
 */
export async function removeRecordDraft(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<{ status: "removed" | "not_found" | "not_a_draft"; recordStatus?: string }> {
  const { data, error } = await supabase
    .from("medical_records")
    .select("id, status")
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the record: ${error.message}`);
  if (!data) return { status: "not_found" };
  if (!INGESTABLE_STATUSES.has(data.status)) {
    return { status: "not_a_draft", recordStatus: data.status };
  }

  // Guarded by status too: approved in the app between the read and this write, the record stays.
  const { data: updated, error: updateError } = await supabase
    .from("medical_records")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", recordId)
    .in("status", INGESTABLE)
    .select("id");
  if (updateError) throw new Error(`Failed to remove the record: ${updateError.message}`);
  if (!updated || updated.length === 0) {
    const { data: now } = await supabase
      .from("medical_records")
      .select("status")
      .eq("id", recordId)
      .maybeSingle();
    if (!now) return { status: "not_found" };
    return { status: "not_a_draft", recordStatus: now.status };
  }
  return { status: "removed" };
}

export interface ActivationOutcome {
  droppedUnmatchedObservations: number;
  proposalsMaterialized: number;
  proposalsSkipped: number;
  /** Diagnosis mentions confirmed by the approval, closures among them. */
  mentionsConfirmed: number;
  /** Closures left pending because the measurement they cite no longer holds on this record. */
  closuresLeftPending: number;
  checkupsCompleted: number;
}

/**
 * Approve an ingested record, by the rules the review screen's Approve button applies
 * (`runSave(true)` in `structure-review-step.tsx`), in the same order:
 *
 * 1. observations nobody could match to the catalogue are deleted, as the screen deletes the rows a
 *    person left unapplied;
 * 2. condition proposals become conditions (`materializeConditionProposals`) -- before the record
 *    turns active, so a failed write leaves it in review rather than active with diagnoses missing;
 * 3. the record turns active, and its observations and findings are marked verified;
 * 4. every mention nobody has ruled on is confirmed, except a closure whose measurements no longer
 *    hold on the record (`proposedClosureStillHolds`), which stays pending;
 * 5. suggested checkup completions are recorded with this record as their evidence.
 */
export async function activateMedicalRecord(
  supabase: SupabaseClient<Database>,
  record: { id: string; person_id: string },
  deps: { lookupIcd: (code: string) => Promise<IcdLookupResult | null> },
): Promise<ActivationOutcome> {
  const { data: dropped, error: dropError } = await supabase
    .from("record_observations")
    .delete()
    .eq("record_id", record.id)
    .eq("is_applied", false)
    .select("id");
  if (dropError) throw new Error(`Failed to drop unmatched observations: ${dropError.message}`);

  const mentions = await loadConditionMentions(supabase, record.id);
  const materialization = await materializeConditionProposals(
    mentions.filter((mention) => mention.is_proposal),
    { supabase, personId: record.person_id, lookupIcd: deps.lookupIcd },
  );

  const { data: activated, error: activateError } = await supabase
    .from("medical_records")
    .update({ status: "active" })
    .eq("id", record.id)
    .select("llm_suggested_checkup_completions")
    .single();
  if (activateError || !activated) {
    throw new Error(`Failed to activate the record: ${activateError?.message ?? "no row"}`);
  }

  for (const table of ["record_observations", "record_findings"] as const) {
    const { error } = await supabase
      .from(table)
      .update({ is_user_verified: true })
      .eq("record_id", record.id)
      .eq("is_user_verified", false);
    if (error) throw new Error(`Failed to verify ${table}: ${error.message}`);
  }

  // Read again: materialisation has just verified the proposals, and what is left unverified is
  // what approving the record rules on.
  const unruled = (await loadConditionMentions(supabase, record.id)).filter(
    isConfirmedByRecordApproval,
  );
  let persisted: PersistedObservation[] = [];
  if (unruled.some((mention) => mention.supporting_obs_code)) {
    const { data, error } = await supabase
      .from("record_observations")
      .select(OBSERVATION_RECHECK_COLUMNS)
      .eq("record_id", record.id);
    // A read that failed is not evidence that the closure still holds.
    if (error) throw new Error(`Failed to re-check the cited measurements: ${error.message}`);
    persisted = (data ?? []) as unknown as PersistedObservation[];
  }
  const confirmable = unruled.filter(
    (mention) => !mention.supporting_obs_code || proposedClosureStillHolds(mention, persisted),
  );
  for (const mention of confirmable) {
    const { error } = await supabase
      .from("condition_records")
      .update({ is_user_verified: true, review_decision: "confirmed" })
      .eq("id", mention.id);
    if (error) throw new Error(`Failed to confirm a diagnosis mention: ${error.message}`);
    // Confirming is what lets a closure reach the chart; the status follows from it.
    if (mention.condition_id) {
      await recomputeConditionCurrentStatus(supabase, mention.condition_id);
    }
  }

  const suggested = parseSuggestedCompletions(
    (activated as { llm_suggested_checkup_completions: unknown }).llm_suggested_checkup_completions,
  );
  for (const suggestion of suggested) {
    const { error } = await supabase.from("checkup_completions").insert({
      checkup_item_id: suggestion.checkup_item_id,
      done_at: suggestion.suggested_done_at.slice(0, 10),
      note: suggestion.reason || null,
      evidence_record_id: record.id,
    });
    if (error) throw new Error(`Failed to record a checkup completion: ${error.message}`);
  }
  if (suggested.length > 0) {
    const { error } = await supabase
      .from("medical_records")
      .update({ llm_suggested_checkup_completions: null })
      .eq("id", record.id);
    if (error) throw new Error(`Failed to clear the applied checkup suggestions: ${error.message}`);
  }

  return {
    droppedUnmatchedObservations: (dropped ?? []).length,
    proposalsMaterialized: materialization.materialized,
    proposalsSkipped: materialization.skipped,
    mentionsConfirmed: confirmable.length,
    closuresLeftPending: unruled.length - confirmable.length,
    checkupsCompleted: suggested.length,
  };
}

async function loadConditionMentions(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<ConditionRecordWithDetails[]> {
  const { data, error } = await supabase.rpc("get_record_conditions", { p_record_id: recordId });
  if (error) throw new Error(`Failed to load the record's diagnoses: ${error.message}`);
  return (data ?? []) as unknown as ConditionRecordWithDetails[];
}

function parseSuggestedCompletions(
  value: unknown,
): Array<{ checkup_item_id: string; suggested_done_at: string; reason: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = item as Record<string, unknown> | null;
    if (
      !entry ||
      typeof entry.checkup_item_id !== "string" ||
      typeof entry.suggested_done_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}/.test(entry.suggested_done_at)
    ) {
      return [];
    }
    return [
      {
        checkup_item_id: entry.checkup_item_id,
        suggested_done_at: entry.suggested_done_at,
        reason: typeof entry.reason === "string" ? entry.reason : "",
      },
    ];
  });
}

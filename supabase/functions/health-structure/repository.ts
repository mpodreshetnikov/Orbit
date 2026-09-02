import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/database.types.ts";
import type {
  BodySiteCatalogItem,
  CheckupItemForContext,
  ExistingCondition,
  ExistingFinding,
  FindingTypeCatalogItem,
  ObservationCatalogItem,
} from "./types.ts";
import {
  ClaimLostError,
  claimRecordViaRpc,
  renewClaimViaRpc,
} from "../_shared/processing-claim.ts";
import type { ResolutionRepository } from "./resolution.ts";

interface AuthenticatedUser {
  id: string;
  email: string | null;
}

/** The storage bucket a record's own pages live in. */
const ATTACHMENT_BUCKET = "medical-attachments";

export interface HealthStructureRepository extends ResolutionRepository {
  authenticateAllowedUser(token: string): Promise<AuthenticatedUser | null>;
  getRecord(recordId: string): Promise<Record<string, unknown> | null>;
  /** The record's attachments in document order, for the pages the extraction stage reads. */
  getAttachments(recordId: string): Promise<Array<{ storage_path: string; mime_type: string }>>;
  downloadAttachment(storagePath: string): Promise<Blob | null>;
  fetchObservationCatalog(): Promise<ObservationCatalogItem[]>;
  fetchFindingTypeCatalog(): Promise<FindingTypeCatalogItem[]>;
  fetchBodySiteCatalog(): Promise<BodySiteCatalogItem[]>;
  fetchPersonConditions(personId: string): Promise<ExistingCondition[]>;
  fetchPersonActiveFindings(personId: string): Promise<ExistingFinding[]>;
  fetchUpcomingOverdueCheckupItems(personId: string): Promise<CheckupItemForContext[]>;
  /**
   * Take ownership of the record for this run, or report that someone else has it.
   * Returns the run id on success and null when the record is already claimed.
   */
  claimRecord(recordId: string): Promise<string | null>;
  /** Extend this run's lease while it is still working; false once the claim has been taken. */
  renewClaim(recordId: string, runId: string): Promise<boolean>;
  /** Terminal write, applied only while this run still owns the record. */
  updateMedicalRecord(
    recordId: string,
    patch: Record<string, unknown>,
    options?: { runId?: string },
  ): Promise<void>;
  replaceRecordObservations(recordId: string, rows: Record<string, unknown>[]): Promise<void>;
  replaceRecordFindings(recordId: string, rows: Record<string, unknown>[]): Promise<void>;
  /** Replace the record's extraction issues, so a re-run does not stack yesterday's. */
  replaceRecordExtractionIssues(recordId: string, rows: Record<string, unknown>[]): Promise<void>;
  clearConditionRecords(recordId: string): Promise<void>;
}

export interface HealthStructureRepositoryConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  createClientFn?: typeof createClient;
  log?: Pick<Console, "log" | "error" | "warn">;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export function createSupabaseHealthStructureRepository(
  config: HealthStructureRepositoryConfig = {},
): HealthStructureRepository {
  const createClientFn = config.createClientFn ?? createClient;
  const log = config.log ?? console;
  const supabaseUrl = config.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = config.supabaseAnonKey ?? Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey =
    config.supabaseServiceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment not configured");
  }

  const resolvedSupabaseUrl = supabaseUrl;
  const resolvedServiceRoleKey = supabaseServiceRoleKey;

  const admin = createClientFn<Database>(resolvedSupabaseUrl, resolvedServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as SupabaseClient<Database>;

  function createUserClient(token: string): SupabaseClient<Database> {
    if (!supabaseAnonKey) throw new Error("Supabase anon environment not configured");
    return createClientFn<Database>(resolvedSupabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }) as SupabaseClient<Database>;
  }

  async function authenticateAllowedUser(token: string): Promise<AuthenticatedUser | null> {
    try {
      const userClient = createUserClient(token);
      const {
        data: { user },
        error: authError,
      } = await userClient.auth.getUser(token);
      if (authError || !user) return null;

      const { data: allowedUser, error: allowlistError } = await admin
        .from("allowed_users")
        .select("id")
        .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
        .single();
      if (allowlistError || !allowedUser) return null;
      return { id: user.id, email: user.email ?? null };
    } catch {
      return null;
    }
  }

  async function getAttachments(
    recordId: string,
  ): Promise<Array<{ storage_path: string; mime_type: string }>> {
    const { data, error } = await admin
      .from("record_attachments")
      .select("storage_path, mime_type")
      .eq("record_id", recordId)
      // The same tiebreak health-ocr applies: the page markers in the transcription and the
      // images sent with it have to describe the same order.
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(`Failed to fetch attachments: ${error.message}`);
    return (data ?? []) as Array<{ storage_path: string; mime_type: string }>;
  }

  async function downloadAttachment(storagePath: string): Promise<Blob | null> {
    const { data, error } = await admin.storage.from(ATTACHMENT_BUCKET).download(storagePath);
    if (error || !data) return null;
    return data;
  }

  async function getRecord(recordId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await admin
      .from("medical_records")
      .select("id, person_id, ocr_text, status")
      .eq("id", recordId)
      .single();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function fetchObservationCatalog(): Promise<ObservationCatalogItem[]> {
    const { data, error } = await admin
      .from("observation_catalog")
      .select(
        "id, obs_code, name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, accepted_units",
      )
      .order("obs_code");

    if (error) {
      log.error("Error fetching observation catalog:", error);
      return [];
    }
    return (data ?? []) as ObservationCatalogItem[];
  }

  async function fetchFindingTypeCatalog(): Promise<FindingTypeCatalogItem[]> {
    const { data, error } = await admin
      .from("finding_type_catalog")
      .select("id, finding_code, name_ru, name_en, synonyms_ru, synonyms_en")
      .order("finding_code");

    if (error) {
      log.error("Error fetching finding catalog:", error);
      return [];
    }
    return (data ?? []) as FindingTypeCatalogItem[];
  }

  async function fetchBodySiteCatalog(): Promise<BodySiteCatalogItem[]> {
    const { data, error } = await admin
      .from("body_site_catalog")
      .select("id, site_code, name_ru, name_en, parent_site_code, synonyms_ru, synonyms_en")
      .order("site_code");

    if (error) {
      log.error("Error fetching body-site catalog:", error);
      return [];
    }
    return (data ?? []) as BodySiteCatalogItem[];
  }

  async function fetchPersonConditions(personId: string): Promise<ExistingCondition[]> {
    const { data, error } = await admin
      .from("conditions")
      .select("id, name, code, current_status, onset_date, resolved_date")
      .eq("person_id", personId)
      .is("deleted_at", null)
      .order("name");
    if (error) {
      log.error("Error fetching person conditions:", error);
      return [];
    }
    return (data ?? []) as ExistingCondition[];
  }

  async function fetchPersonActiveFindings(personId: string): Promise<ExistingFinding[]> {
    const { data, error } = await admin
      .from("record_findings")
      .select(
        "finding_code,finding_type_text,site_code,body_site_text,finding_type_id,body_site_id,resolution_status,medical_records!inner(person_id,status)",
      )
      .eq("medical_records.person_id", personId)
      .eq("medical_records.status", "active")
      .order("created_at", { ascending: false });

    if (error || !data) {
      if (error) log.error("Error fetching active findings:", error);
      return [];
    }

    const results: ExistingFinding[] = [];
    const seen = new Set<string>();

    for (const raw of data as unknown[]) {
      const row = raw as Record<string, unknown>;
      // A resolution row closes the finding it names; it is not itself an active finding.
      if (row.resolution_status === "resolved") continue;

      const findingCode = normalizeText(row.finding_code);
      const findingTypeText = normalizeText(row.finding_type_text) ?? "Unknown finding";
      const siteCode = normalizeText(row.site_code);
      const bodySiteText = normalizeText(row.body_site_text);
      const key = `${findingCode ?? findingTypeText.toLowerCase()}::${siteCode ?? bodySiteText ?? "none"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        finding_code: findingCode,
        finding_type_text: findingTypeText,
        site_code: siteCode,
        body_site_text: bodySiteText,
        finding_type_id: normalizeText(row.finding_type_id),
        body_site_id: normalizeText(row.body_site_id),
      });
    }

    return results;
  }

  async function fetchUpcomingOverdueCheckupItems(
    personId: string,
  ): Promise<CheckupItemForContext[]> {
    const { data, error } = await admin
      .from("checkup_items")
      .select("id, title, category, next_due_at")
      .eq("person_id", personId)
      .eq("status", "active")
      .not("next_due_at", "is", null)
      .order("next_due_at", { ascending: true });

    if (error) {
      log.error("Error fetching checkup items:", error);
      return [];
    }

    return (data ?? []) as CheckupItemForContext[];
  }

  async function claimRecord(recordId: string): Promise<string | null> {
    return await claimRecordViaRpc(admin, recordId, "structuring");
  }

  async function renewClaim(recordId: string, runId: string): Promise<boolean> {
    return await renewClaimViaRpc(admin, recordId, runId);
  }

  async function updateMedicalRecord(
    recordId: string,
    patch: Record<string, unknown>,
    options: { runId?: string } = {},
  ): Promise<void> {
    let query = admin
      .from("medical_records")
      .update(patch as Database["public"]["Tables"]["medical_records"]["Update"])
      .eq("id", recordId);
    // A worker that has lost its claim must not resurrect its result over whatever replaced it.
    if (options.runId) query = query.eq("processing_run_id", options.runId);
    const { data, error } = await query.select("id");

    if (error) throw new Error(`Failed to update record: ${error.message}`);
    if (options.runId && (data ?? []).length === 0) throw new ClaimLostError(recordId);
  }

  async function replaceRecordObservations(
    recordId: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    await admin.from("record_observations").delete().eq("record_id", recordId);
    if (rows.length === 0) return;
    const { error } = await admin
      .from("record_observations")
      .insert(rows as Database["public"]["Tables"]["record_observations"]["Insert"][]);
    if (error) throw new Error(`Failed to insert observations: ${error.message}`);
  }

  async function replaceRecordFindings(
    recordId: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    await admin.from("record_findings").delete().eq("record_id", recordId);
    if (rows.length === 0) return;
    const { error } = await admin
      .from("record_findings")
      .insert(rows as Database["public"]["Tables"]["record_findings"]["Insert"][]);
    if (error) throw new Error(`Failed to insert findings: ${error.message}`);
  }

  async function replaceRecordExtractionIssues(
    recordId: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    // Checked, unlike a fire-and-forget delete: a delete that failed turns "replace" into
    // "append" for a run with corrections, and into "keep the old warnings" for a clean one --
    // and the clean case is the one that would silently report a problem that no longer exists.
    const { error: deleteError } = await admin
      .from("record_extraction_issues")
      .delete()
      .eq("record_id", recordId);
    if (deleteError) {
      throw new Error(`Failed to clear extraction issues: ${deleteError.message}`);
    }
    if (rows.length === 0) return;
    const { error } = await admin
      .from("record_extraction_issues")
      .insert(rows as Database["public"]["Tables"]["record_extraction_issues"]["Insert"][]);
    if (error) throw new Error(`Failed to insert extraction issues: ${error.message}`);
  }

  async function clearConditionRecords(recordId: string): Promise<void> {
    await admin.from("condition_records").delete().eq("record_id", recordId);
  }

  async function insertConditionRecord(payload: Record<string, unknown>): Promise<void> {
    await admin
      .from("condition_records")
      .insert(payload as Database["public"]["Tables"]["condition_records"]["Insert"]);
  }

  async function recomputeConditionCurrentStatus(conditionId: string): Promise<void> {
    // A closure written by the model and confirmed by nobody must not end an entry in someone's
    // medical record, so it is excluded here rather than filtered downstream: the exclusion runs
    // before the limit, or a suppressed closure would merely hide the row beneath it and leave the
    // status stale in a different way. Both closing statuses count -- `resolved` says the
    // condition ended, `history` says it no longer bears on today, and either takes it off the
    // active chart. `active` and `suspected` are how conditions reach the chart at all, so they
    // still apply unreviewed.
    //
    // The web app carries the same rule in `src/lib/conditions/unverified-closure.ts`; this tree
    // imports nothing from that one, so it is written twice on purpose. Change one, change both.
    const { data } = await admin
      .from("condition_records")
      .select("status_in_record, medical_records!inner(record_date)")
      .eq("condition_id", conditionId)
      .or(
        "status_in_record.not.in.(resolved,history),is_llm_extracted.is.false,is_user_verified.is.true",
      )
      .order("medical_records(record_date)", { ascending: false })
      .limit(1)
      .maybeSingle();

    const status = normalizeText(asRecord(data)?.status_in_record);
    if (!status) return;

    await admin.from("conditions").update({ current_status: status }).eq("id", conditionId);
  }

  async function insertFinding(payload: Record<string, unknown>): Promise<void> {
    await admin
      .from("record_findings")
      .insert(payload as Database["public"]["Tables"]["record_findings"]["Insert"]);
  }

  return {
    authenticateAllowedUser,
    getRecord,
    getAttachments,
    downloadAttachment,
    fetchObservationCatalog,
    fetchFindingTypeCatalog,
    fetchBodySiteCatalog,
    fetchPersonConditions,
    fetchPersonActiveFindings,
    fetchUpcomingOverdueCheckupItems,
    claimRecord,
    renewClaim,
    updateMedicalRecord,
    replaceRecordObservations,
    replaceRecordFindings,
    replaceRecordExtractionIssues,
    clearConditionRecords,
    insertConditionRecord,
    recomputeConditionCurrentStatus,
    insertFinding,
  };
}

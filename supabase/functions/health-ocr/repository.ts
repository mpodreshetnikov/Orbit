import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/database.types.ts";
import {
  ClaimLostError,
  claimRecordViaRpc,
  renewClaimViaRpc,
} from "../_shared/processing-claim.ts";

const BUCKET_NAME = "medical-attachments";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface OcrRecord {
  id: string;
  person_id: string;
  status: string;
}

export interface OcrAttachment {
  id: string;
  storage_path: string;
  mime_type: string;
  original_filename: string;
}

export interface HealthOcrRepository {
  authenticateUser(token: string): Promise<AuthenticatedUser | null>;
  isAllowedUser(user: AuthenticatedUser): Promise<boolean>;
  getRecord(recordId: string): Promise<OcrRecord | null>;
  getAttachments(recordId: string): Promise<OcrAttachment[]>;
  downloadAttachment(storagePath: string): Promise<Blob | null>;
  /**
   * Take ownership of the record for this run, or report that someone else has it.
   * Returns the run id on success and null when the record is already claimed.
   */
  claimRecord(recordId: string): Promise<string | null>;
  /** Extend this run's lease while it is still working; false once the claim has been taken. */
  renewClaim(recordId: string, runId: string): Promise<boolean>;
  updateRecordSuccess(
    recordId: string,
    payload: { ocrText: string; title: string },
    options?: { runId?: string },
  ): Promise<void>;
  updateRecordFailure(
    recordId: string,
    errorMessage: string,
    options?: { runId?: string },
  ): Promise<void>;
}

interface CreateRepositoryDeps {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey?: string;
  createClientFn?: typeof createClient;
}

function createUserClient(deps: CreateRepositoryDeps, token: string): SupabaseClient<Database> {
  const createClientFn = deps.createClientFn ?? createClient;
  return createClientFn<Database>(
    deps.supabaseUrl,
    deps.supabaseAnonKey || deps.supabaseServiceRoleKey,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

function createAdminClient(deps: CreateRepositoryDeps): SupabaseClient<Database> {
  const createClientFn = deps.createClientFn ?? createClient;
  return createClientFn<Database>(deps.supabaseUrl, deps.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as SupabaseClient<Database>;
}

export function createSupabaseHealthOcrRepository(deps: CreateRepositoryDeps): HealthOcrRepository {
  const admin = createAdminClient(deps);

  return {
    async authenticateUser(token) {
      const userClient = createUserClient(deps, token);
      const {
        data: { user },
        error,
      } = await userClient.auth.getUser(token);
      if (error || !user) return null;
      return { id: user.id, email: user.email ?? null };
    },

    async isAllowedUser(user) {
      const { data, error } = await admin
        .from("allowed_users")
        .select("id")
        .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
        .single();
      return !(error || !data);
    },

    async getRecord(recordId) {
      const { data, error } = await admin
        .from("medical_records")
        .select("id, person_id, status")
        .eq("id", recordId)
        .single();

      if (error || !data) return null;
      return data as OcrRecord;
    },

    async getAttachments(recordId) {
      const { data, error } = await admin
        .from("record_attachments")
        .select("id, storage_path, mime_type, original_filename")
        .eq("record_id", recordId)
        // `id` breaks the tie, because `sort_order` is not unique -- the single-upload path
        // leaves it at zero -- and health-structure orders the same attachments for the page
        // images it sends alongside this text. Two arbitrary orders would let extraction read a
        // table against the wrong page.
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch attachments: ${error.message}`);
      }
      return (data ?? []) as OcrAttachment[];
    },

    async downloadAttachment(storagePath) {
      const { data, error } = await admin.storage.from(BUCKET_NAME).download(storagePath);
      if (error || !data) return null;
      return data;
    },

    async claimRecord(recordId) {
      return await claimRecordViaRpc(admin, recordId, "ocr_processing");
    },

    async renewClaim(recordId, runId) {
      return await renewClaimViaRpc(admin, recordId, runId);
    },

    async updateRecordSuccess(recordId, payload, options = {}) {
      let query = admin
        .from("medical_records")
        .update({
          ocr_text: payload.ocrText,
          title: payload.title,
          status: "ocr_review",
          ocr_error: null,
          processing_run_id: null,
          processing_started_at: null,
        })
        .eq("id", recordId);
      // A worker whose client already gave up used to overwrite the ocr_failed that replaced it.
      if (options.runId) query = query.eq("processing_run_id", options.runId);
      const { data, error } = await query.select("id");

      if (error) {
        throw new Error(`Failed to update record: ${error.message}`);
      }
      if (options.runId && (data ?? []).length === 0) throw new ClaimLostError(recordId);
    },

    async updateRecordFailure(recordId, errorMessage, options = {}) {
      let query = admin
        .from("medical_records")
        .update({
          status: "ocr_failed",
          ocr_error: errorMessage,
          processing_run_id: null,
          processing_started_at: null,
        })
        .eq("id", recordId);
      if (options.runId) query = query.eq("processing_run_id", options.runId);
      const { data } = await query.select("id");
      if (options.runId && (data ?? []).length === 0) throw new ClaimLostError(recordId);
    },
  };
}

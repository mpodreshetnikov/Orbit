"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import { fetchEdgeFunctionWithTelemetry } from "@/lib/observability/edge-function-fetch";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
import {
  formatClientOcrFailure,
  MAX_OCR_ERROR_LENGTH,
  parseOcrFailureCause,
  translateOcrFailure,
} from "@/lib/health/ocr-failure";
import type { HealthOcrResponse } from "@/types";

interface BackgroundOCRInput {
  recordId: string;
  personId: string;
  personName: string;
  files?: File[];
}

interface RetryOCRInput {
  recordId: string;
  personId: string;
  personName: string;
}

const OCR_FAILED_UPDATE_RETRIES = 3;
const OCR_FAILED_UPDATE_DELAY_MS = 1500;
const OCR_UPLOAD_RETRIES = 3;
const OCR_UPLOAD_RETRY_DELAY_MS = 1200;
const RETRYABLE_UPLOAD_ERROR_RE = /\bfailed to fetch\b|network|timeout|fetch failed/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUploadError(message: string): boolean {
  return RETRYABLE_UPLOAD_ERROR_RE.test(message.toLowerCase());
}

/**
 * Decide what a failed hand-off actually means before writing anything.
 *
 * The acceptance call is short, but a lost response is not the same as a lost request: the server
 * may have claimed the record and started transcribing before the connection dropped. Writing
 * `ocr_failed` from here on that ambiguity marks a live run as failed, and the user is told the
 * document failed while it is being read.
 *
 * The record itself settles it. A claim means a worker owns the work; a status past OCR means it
 * already finished. Only a record that nobody owns and that never moved on is this caller's to
 * fail.
 */
export async function reconcileAfterFailedHandoff(
  supabase: ReturnType<typeof createClient>,
  recordId: string,
  errorMessage: string,
): Promise<"claimed" | "already-finished" | "failed" | "unknown"> {
  const { data, error } = await supabase
    .from("medical_records")
    .select("status, processing_run_id")
    .eq("id", recordId)
    .single();

  // The read failed too. Leave the record alone rather than guessing: a stalled record is
  // recovered by the lease sweep, while a wrong `ocr_failed` over a live run is not recovered
  // at all.
  if (error || !data) return "unknown";

  if (data.processing_run_id) return "claimed";
  if (data.status !== "ocr_processing") return "already-finished";

  return (await updateRecordToOcrFailed(supabase, recordId, errorMessage)) ? "failed" : "unknown";
}

/**
 * Write a failure this side is the only witness to.
 *
 * Only for failures the server never saw: whatever `health-ocr` persisted is more careful than
 * anything composable here, and this used to overwrite it on every failure path — cause and
 * length cap alike.
 */
export async function updateRecordToOcrFailed(
  supabase: ReturnType<typeof createClient>,
  recordId: string,
  errorMessage: string,
): Promise<boolean> {
  const durableMessage = errorMessage.slice(0, MAX_OCR_ERROR_LENGTH);
  for (let attempt = 0; attempt < OCR_FAILED_UPDATE_RETRIES; attempt++) {
    const { error } = await supabase
      .from("medical_records")
      .update({ status: "ocr_failed", ocr_error: durableMessage })
      .eq("id", recordId);
    if (!error) return true;
    if (attempt < OCR_FAILED_UPDATE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, OCR_FAILED_UPDATE_DELAY_MS));
    }
  }
  return false;
}

/**
 * Read a failed response without inventing a story about it.
 *
 * A JSON body from `health-ocr` carries the service's own classified message, and `persisted`
 * says whether the record already holds it. An answer is not proof of a write: a token that
 * expired between the session read and the call is refused before the service knows which record
 * the caller meant, so it answers in JSON and writes nothing. Only a persisted failure is one the
 * browser can leave alone.
 *
 * Anything else (a gateway error, an empty body, a status line) never reached the service, so the
 * browser composes the one cause it can honestly claim. The body itself is not quoted; it is not
 * ours, and an HTTP status says as much as a proxy's HTML page does.
 */
async function readFailureMessage(
  response: Response,
): Promise<{ message: string; persisted: boolean }> {
  const errorText = await response.text();
  try {
    const parsed = JSON.parse(errorText) as { error?: string; persisted?: boolean };
    if (parsed?.error) return { message: parsed.error, persisted: parsed.persisted === true };
  } catch {
    // Not our payload; fall through.
  }
  return {
    message: formatClientOcrFailure("service_unreachable", `HTTP ${response.status}`),
    persisted: false,
  };
}

/**
 * Make a failure the browser is about to persist translatable.
 *
 * A thrown `Failed to fetch` is the browser's own English, and a reader in another language
 * cannot be shown it. Anything already classified is left exactly as it is — the service's
 * message must never be re-wrapped.
 */
function asDurableClientFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (parseOcrFailureCause(raw)) return raw;
  return formatClientOcrFailure("service_unreachable", raw || "processing failed");
}

export function useBackgroundOCR() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const addJob = useProcessingQueueStore((state) => state.addJob);
  const updateJob = useProcessingQueueStore((state) => state.updateJob);
  const addNotification = useProcessingQueueStore((state) => state.addNotification);

  const startBackgroundOCR = useCallback(
    async ({ recordId, personId, personName, files = [] }: BackgroundOCRInput) => {
      const jobId = recordId;
      const hasFilesToUpload = files.length > 0;

      // Add job to processing queue
      addJob({
        id: jobId,
        recordId,
        personId,
        personName,
        stage: hasFilesToUpload ? "uploading" : "processing",
        progress: hasFilesToUpload ? 0 : 40,
      });

      try {
        const supabase = createClient();

        // Get current session for auth
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          throw new Error(formatClientOcrFailure("not_authenticated"));
        }

        if (hasFilesToUpload) {
          // Update status: uploading
          updateJob(jobId, { stage: "uploading", progress: 10 });

          // Upload files sequentially with retry on transient network errors.
          for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const fileExt = file.name.split(".").pop() || "bin";
            const fileName = `${Date.now()}-${index}.${fileExt}`;
            const storagePath = `${personId}/${recordId}/${fileName}`;

            let uploadErrorMessage: string | null = null;
            for (let attempt = 0; attempt < OCR_UPLOAD_RETRIES; attempt++) {
              const { error: uploadError } = await supabase.storage
                .from("medical-attachments")
                .upload(storagePath, file, {
                  cacheControl: "3600",
                  upsert: false,
                });

              if (!uploadError) {
                uploadErrorMessage = null;
                break;
              }

              uploadErrorMessage = uploadError.message;
              const hasNextAttempt = attempt < OCR_UPLOAD_RETRIES - 1;
              if (!hasNextAttempt || !isRetryableUploadError(uploadErrorMessage)) {
                break;
              }

              await sleep(OCR_UPLOAD_RETRY_DELAY_MS * (attempt + 1));
            }

            if (uploadErrorMessage) {
              throw new Error(formatClientOcrFailure("upload_failed", uploadErrorMessage));
            }

            // Create attachment record
            const { error: attachError } = await supabase.from("record_attachments").insert({
              record_id: recordId,
              storage_path: storagePath,
              mime_type: file.type,
              original_filename: file.name,
              file_size: file.size,
              sort_order: index,
            });

            if (attachError) {
              await supabase.storage.from("medical-attachments").remove([storagePath]);
              throw new Error(
                formatClientOcrFailure(
                  "upload_failed",
                  `failed to create attachment: ${attachError.message}`,
                ),
              );
            }

            const progress = 10 + Math.round(((index + 1) / files.length) * 20);
            updateJob(jobId, { stage: "uploading", progress: Math.min(progress, 30) });
          }
        }

        // Update record status to "ocr_processing"
        await supabase
          .from("medical_records")
          .update({ status: "ocr_processing" })
          .eq("id", recordId);

        // Update status: processing (OCR)
        updateJob(jobId, { stage: "processing", progress: 40 });

        // Call health-ocr edge function with timeout
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error(
            formatClientOcrFailure("service_unreachable", "no service URL configured"),
          );
        }

        // No timeout: the call now returns as soon as the record is claimed, and the
        // transcription that follows is reported by the record's status. The 120-second abort
        // this replaces was how a five-page document ended up marked failed while the server
        // was still transcribing it.
        const response = await fetchEdgeFunctionWithTelemetry(
          `${supabaseUrl}/functions/v1/health-ocr`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ record_id: recordId }),
          },
          {
            component: "use-background-ocr",
            operation: "health-ocr",
            attrs: {
              has_record_id: Boolean(recordId),
            },
          },
        );

        updateJob(jobId, { progress: 50 });

        if (response.status === 409) {
          // Another run owns this record and is still working on it. Marking it failed here
          // would overwrite the state of the worker that is actually processing it.
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          updateJob(jobId, { stage: "completed", progress: 100 });
          return { success: false, error: "already_running" };
        }

        if (!response.ok) {
          const { message: errorMessage, persisted } = await readFailureMessage(response);
          if (!persisted) {
            // Nothing was written, so the record is still this caller's to settle -- but not
            // unconditionally: a gateway can lose the response of a request the function did
            // receive, and failing a run that holds the claim is the lie the user acts on.
            const outcome = await reconcileAfterFailedHandoff(supabase, recordId, errorMessage);
            if (outcome === "claimed" || outcome === "already-finished") {
              updateJob(jobId, { stage: "processing", progress: 50 });
              queryClient.invalidateQueries({ queryKey: ["medical-records"] });
              queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
              return { success: true, accepted: true };
            }
          }
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          updateJob(jobId, { stage: "failed", error: errorMessage });
          addNotification({
            jobId,
            recordId,
            title: t("processing.failed"),
            personName,
            type: "error",
            message: translateOcrFailure(errorMessage, t),
          });
          toast.error(t("processing.failed"), {
            description: translateOcrFailure(errorMessage, t),
          });
          return { success: false, error: errorMessage };
        }

        const data: HealthOcrResponse = await response.json();

        if (!data.success) {
          const errorMessage = data.error || formatClientOcrFailure("service_unreachable");
          if (data.persisted !== true) {
            // Answered without writing: the record is still where this caller left it, unless
            // another run has since taken it.
            const outcome = await reconcileAfterFailedHandoff(supabase, recordId, errorMessage);
            if (outcome === "claimed" || outcome === "already-finished") {
              updateJob(jobId, { stage: "processing", progress: 50 });
              queryClient.invalidateQueries({ queryKey: ["medical-records"] });
              queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
              return { success: true, accepted: true };
            }
          }
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          updateJob(jobId, { stage: "failed", error: errorMessage });
          addNotification({
            jobId,
            recordId,
            title: t("processing.failed"),
            personName,
            type: "error",
            message: translateOcrFailure(errorMessage, t),
          });
          toast.error(t("processing.failed"), {
            description: translateOcrFailure(errorMessage, t),
          });
          return { success: false, error: errorMessage };
        }

        if (data.accepted) {
          // The work was taken, not finished. useProcessingMonitor closes the job out when the
          // record reaches ocr_review, or fails it when the record reaches ocr_failed.
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          return { success: true, accepted: true };
        }

        // Mark job as completed; use LLM-suggested record name when available
        const displayTitle = data.suggested_title?.trim() || t("processing.ocrComplete");
        updateJob(jobId, {
          stage: "completed",
          progress: 100,
          title: displayTitle,
          completedAt: Date.now(),
        });

        // Add notification - use record name so user sees what finished
        addNotification({
          jobId,
          recordId,
          title: displayTitle,
          personName,
          type: "success",
          message: t("processing.ocrReviewNeeded"),
        });

        // Invalidate queries
        queryClient.invalidateQueries({
          queryKey: ["medical-records"],
        });
        queryClient.invalidateQueries({
          queryKey: ["medical-record", recordId],
        });

        return { success: true, ocr_text: data.ocr_text };
      } catch (error) {
        // Upload, session or the acceptance call itself. There is no timeout case left to
        // distinguish: nothing here waits on the transcription.
        // Classified before anything is written: `reconcileAfterFailedHandoff` may persist this,
        // and a raw `Failed to fetch` in the column is a sentence no translation can reach.
        const errorMessage = asDurableClientFailure(error);

        // Ask the record what happened before telling the user anything. A lost response is not
        // a lost request: the server may have claimed the document and started reading it.
        const supabaseClient = createClient();
        const outcome = await reconcileAfterFailedHandoff(supabaseClient, recordId, errorMessage);
        if (outcome === "claimed" || outcome === "already-finished") {
          // The connection died, not the run. The record's own status closes this job, exactly
          // as it does for a response that did arrive.
          updateJob(jobId, { stage: "processing", progress: 50 });
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          return { success: true, accepted: true };
        }

        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: translateOcrFailure(errorMessage, t),
        });
        toast.error(t("processing.failed"), {
          description:
            outcome === "unknown"
              ? t("processing.retryIfStillProcessing")
              : translateOcrFailure(errorMessage, t),
        });

        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });

        return { success: false, error: errorMessage };
      }
    },
    [t, queryClient, addJob, updateJob, addNotification],
  );

  const retryOcr = useCallback(
    async ({ recordId, personId, personName }: RetryOCRInput) => {
      const jobId = recordId;
      addJob({
        id: jobId,
        recordId,
        personId,
        personName,
        stage: "processing",
        progress: 40,
      });

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        const notSignedIn = formatClientOcrFailure("not_authenticated");
        updateJob(jobId, { stage: "failed", error: notSignedIn });
        toast.error(t("processing.failed"), {
          description: translateOcrFailure(notSignedIn, t),
        });
        return { success: false, error: notSignedIn };
      }

      await supabase
        .from("medical_records")
        .update({ status: "ocr_processing", ocr_error: null })
        .eq("id", recordId);

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        const err = formatClientOcrFailure("service_unreachable", "no service URL configured");
        updateJob(jobId, { stage: "failed", error: err });
        await supabase
          .from("medical_records")
          .update({ status: "ocr_failed", ocr_error: err })
          .eq("id", recordId);
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        return { success: false, error: err };
      }

      let response: Response;
      try {
        response = await fetchEdgeFunctionWithTelemetry(
          `${supabaseUrl}/functions/v1/health-ocr`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ record_id: recordId }),
          },
          {
            component: "use-background-ocr",
            operation: "health-ocr-retry",
            attrs: {
              has_record_id: Boolean(recordId),
            },
          },
        );
      } catch (fetchError) {
        const errorMessage = asDurableClientFailure(fetchError);
        // Same ambiguity as the first attempt: the retry may have been accepted before the
        // connection dropped, and failing a live run from here would be a lie the user acts on.
        const outcome = await reconcileAfterFailedHandoff(supabase, recordId, errorMessage);
        if (outcome === "claimed" || outcome === "already-finished") {
          updateJob(jobId, { stage: "processing", progress: 50 });
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          return { success: true, accepted: true };
        }

        updateJob(jobId, { stage: "failed", error: errorMessage });
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: translateOcrFailure(errorMessage, t),
        });
        toast.error(t("processing.failed"), {
          description: translateOcrFailure(errorMessage, t),
        });
        return { success: false, error: errorMessage };
      }

      updateJob(jobId, { progress: 50 });

      if (response.status === 409) {
        // The record already has an owner; the run that holds it decides its status.
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        updateJob(jobId, { stage: "completed", progress: 100 });
        return { success: false, error: "already_running" };
      }

      if (!response.ok) {
        const { message: errorMessage, persisted } = await readFailureMessage(response);
        if (!persisted) {
          // Same ambiguity as the first attempt: a lost response is not a request that never
          // landed, so the record decides whether this caller may fail it.
          const outcome = await reconcileAfterFailedHandoff(supabase, recordId, errorMessage);
          if (outcome === "claimed" || outcome === "already-finished") {
            updateJob(jobId, { stage: "processing", progress: 50 });
            queryClient.invalidateQueries({ queryKey: ["medical-records"] });
            queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
            return { success: true, accepted: true };
          }
        }
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: translateOcrFailure(errorMessage, t),
        });
        toast.error(t("processing.failed"), {
          description: translateOcrFailure(errorMessage, t),
        });
        return { success: false, error: errorMessage };
      }

      const data: HealthOcrResponse = await response.json();
      if (!data.success) {
        const errorMessage = data.error || formatClientOcrFailure("service_unreachable");
        if (data.persisted !== true) {
          const outcome = await reconcileAfterFailedHandoff(supabase, recordId, errorMessage);
          if (outcome === "claimed" || outcome === "already-finished") {
            updateJob(jobId, { stage: "processing", progress: 50 });
            queryClient.invalidateQueries({ queryKey: ["medical-records"] });
            queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
            return { success: true, accepted: true };
          }
        }
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: translateOcrFailure(errorMessage, t),
        });
        toast.error(t("processing.failed"), {
          description: translateOcrFailure(errorMessage, t),
        });
        return { success: false, error: errorMessage };
      }

      if (data.accepted) {
        // Claimed and running; the record's status is what finishes this job.
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        return { success: true, accepted: true };
      }

      const displayTitle = data.suggested_title?.trim() || t("processing.ocrComplete");
      updateJob(jobId, {
        stage: "completed",
        progress: 100,
        title: displayTitle,
        completedAt: Date.now(),
      });
      addNotification({
        jobId,
        recordId,
        title: displayTitle,
        personName,
        type: "success",
        message: t("processing.ocrReviewNeeded"),
      });
      queryClient.invalidateQueries({ queryKey: ["medical-records"] });
      queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
      return { success: true, ocr_text: data.ocr_text };
    },
    [t, queryClient, addJob, updateJob, addNotification],
  );

  return { startBackgroundOCR, retryOcr };
}

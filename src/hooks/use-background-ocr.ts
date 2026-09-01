"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import { fetchEdgeFunctionWithTelemetry } from "@/lib/observability/edge-function-fetch";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
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

export async function updateRecordToOcrFailed(
  supabase: ReturnType<typeof createClient>,
  recordId: string,
  errorMessage: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < OCR_FAILED_UPDATE_RETRIES; attempt++) {
    const { error } = await supabase
      .from("medical_records")
      .update({ status: "ocr_failed", ocr_error: errorMessage })
      .eq("id", recordId);
    if (!error) return true;
    if (attempt < OCR_FAILED_UPDATE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, OCR_FAILED_UPDATE_DELAY_MS));
    }
  }
  return false;
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
          throw new Error("Not authenticated");
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
              throw new Error(`Upload failed: ${uploadErrorMessage}`);
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
              throw new Error(`Failed to create attachment: ${attachError.message}`);
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
          throw new Error("Supabase URL not configured");
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
          const errorText = await response.text();
          let errorMessage = response.statusText;
          try {
            const parsed = JSON.parse(errorText) as { error?: string };
            if (parsed?.error) errorMessage = parsed.error;
          } catch {
            if (errorText) errorMessage = errorText;
          }
          await supabase
            .from("medical_records")
            .update({ status: "ocr_failed", ocr_error: errorMessage })
            .eq("id", recordId);
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          updateJob(jobId, { stage: "failed", error: errorMessage });
          addNotification({
            jobId,
            recordId,
            title: t("processing.failed"),
            personName,
            type: "error",
            message: errorMessage,
          });
          toast.error(t("processing.failed"), { description: errorMessage });
          return { success: false, error: errorMessage };
        }

        const data: HealthOcrResponse = await response.json();

        if (!data.success) {
          const errorMessage = data.error || "OCR processing failed";
          await supabase
            .from("medical_records")
            .update({ status: "ocr_failed", ocr_error: errorMessage })
            .eq("id", recordId);
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
          updateJob(jobId, { stage: "failed", error: errorMessage });
          addNotification({
            jobId,
            recordId,
            title: t("processing.failed"),
            personName,
            type: "error",
            message: errorMessage,
          });
          toast.error(t("processing.failed"), { description: errorMessage });
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
        const errorMessage = error instanceof Error ? error.message : "Processing failed";

        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });
        toast.error(t("processing.failed"), { description: errorMessage });

        // Persist OCR failure so UI can show error and Retry (retry update on transient network failure)
        const supabaseClient = createClient();
        const updated = await updateRecordToOcrFailed(supabaseClient, recordId, errorMessage);
        if (!updated) {
          toast.error(t("processing.failed"), {
            description: "Open the record and use Retry OCR if it still shows processing.",
          });
        }

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
        updateJob(jobId, { stage: "failed", error: "Not authenticated" });
        toast.error(t("processing.failed"), { description: "Not authenticated" });
        return { success: false, error: "Not authenticated" };
      }

      await supabase
        .from("medical_records")
        .update({ status: "ocr_processing", ocr_error: null })
        .eq("id", recordId);

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        const err = "Supabase URL not configured";
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
        const errorMessage = fetchError instanceof Error ? fetchError.message : "Processing failed";
        updateJob(jobId, { stage: "failed", error: errorMessage });
        await supabase
          .from("medical_records")
          .update({ status: "ocr_failed", ocr_error: errorMessage })
          .eq("id", recordId);
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });
        toast.error(t("processing.failed"), { description: errorMessage });
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
        const errorText = await response.text();
        let errorMessage = response.statusText;
        try {
          const parsed = JSON.parse(errorText) as { error?: string };
          if (parsed?.error) errorMessage = parsed.error;
        } catch {
          if (errorText) errorMessage = errorText;
        }
        await supabase
          .from("medical_records")
          .update({ status: "ocr_failed", ocr_error: errorMessage })
          .eq("id", recordId);
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });
        toast.error(t("processing.failed"), { description: errorMessage });
        return { success: false, error: errorMessage };
      }

      const data: HealthOcrResponse = await response.json();
      if (!data.success) {
        const errorMessage = data.error || "OCR processing failed";
        await supabase
          .from("medical_records")
          .update({ status: "ocr_failed", ocr_error: errorMessage })
          .eq("id", recordId);
        queryClient.invalidateQueries({ queryKey: ["medical-records"] });
        queryClient.invalidateQueries({ queryKey: ["medical-record", recordId] });
        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });
        toast.error(t("processing.failed"), { description: errorMessage });
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

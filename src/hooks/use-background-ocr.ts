"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
import type { HealthOcrResponse } from "@/types";

interface BackgroundOCRInput {
  recordId: string;
  personId: string;
  personName: string;
  files: File[];
}

interface RetryOCRInput {
  recordId: string;
  personId: string;
  personName: string;
}

const OCR_FETCH_TIMEOUT_MS = 120_000; // 120s so client does not wait indefinitely
const OCR_FAILED_UPDATE_RETRIES = 3;
const OCR_FAILED_UPDATE_DELAY_MS = 1500;

async function updateRecordToOcrFailed(
  supabase: ReturnType<typeof createClient>,
  recordId: string,
  errorMessage: string
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
    async ({ recordId, personId, personName, files }: BackgroundOCRInput) => {
      const jobId = recordId;

      // Add job to processing queue
      addJob({
        id: jobId,
        recordId,
        personId,
        personName,
        stage: "uploading",
        progress: 0,
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

        // Update status: uploading
        updateJob(jobId, { stage: "uploading", progress: 10 });

        // Upload files
        const uploadPromises = files.map(async (file, index) => {
          const fileExt = file.name.split(".").pop() || "bin";
          const fileName = `${Date.now()}-${index}.${fileExt}`;
          const storagePath = `${personId}/${recordId}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from("medical-attachments")
            .upload(storagePath, file);

          if (uploadError) {
            throw new Error(`Upload failed: ${uploadError.message}`);
          }

          // Create attachment record
          const { error: attachError } = await supabase
            .from("record_attachments")
            .insert({
              record_id: recordId,
              storage_path: storagePath,
              mime_type: file.type,
              original_filename: file.name,
              file_size: file.size,
              sort_order: index,
            });

          if (attachError) {
            throw new Error(`Failed to create attachment: ${attachError.message}`);
          }
        });

        await Promise.all(uploadPromises);
        updateJob(jobId, { stage: "uploading", progress: 30 });

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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OCR_FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(`${supabaseUrl}/functions/v1/health-ocr`, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ record_id: recordId }),
          });
        } finally {
          clearTimeout(timeoutId);
        }

        updateJob(jobId, { progress: 80 });

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
        const errorMessage =
          (error as Error)?.name === "AbortError"
            ? t("processing.timeout")
            : error instanceof Error
              ? error.message
              : "Processing failed";

        updateJob(jobId, { stage: "failed", error: errorMessage });
        addNotification({
          jobId,
          recordId,
          title: (error as Error)?.name === "AbortError" ? t("processing.timeout") : t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });
        toast.error(
          (error as Error)?.name === "AbortError" ? t("processing.timeout") : t("processing.failed"),
          { description: (error as Error)?.name === "AbortError" ? t("processing.timeoutDescription") : errorMessage }
        );

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
    [t, queryClient, addJob, updateJob, addNotification]
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OCR_FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${supabaseUrl}/functions/v1/health-ocr`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ record_id: recordId }),
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        const errorMessage = (fetchError as Error)?.name === "AbortError" ? t("processing.timeout") : (fetchError instanceof Error ? fetchError.message : "Processing failed");
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
          title: (fetchError as Error)?.name === "AbortError" ? t("processing.timeout") : t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });
        toast.error(
          (fetchError as Error)?.name === "AbortError" ? t("processing.timeout") : t("processing.failed"),
          { description: (fetchError as Error)?.name === "AbortError" ? t("processing.timeoutDescription") : errorMessage }
        );
        return { success: false, error: errorMessage };
      }
      clearTimeout(timeoutId);

      updateJob(jobId, { progress: 80 });

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
    [t, queryClient, addJob, updateJob, addNotification]
  );

  return { startBackgroundOCR, retryOcr };
}

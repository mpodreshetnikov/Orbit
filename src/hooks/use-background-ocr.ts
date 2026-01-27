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

        // Call health-ocr edge function
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("Supabase URL not configured");
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/health-ocr`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ record_id: recordId }),
        });

        updateJob(jobId, { progress: 80 });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OCR failed: ${errorText || response.statusText}`);
        }

        const data: HealthOcrResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "OCR processing failed");
        }

        // Mark job as completed (OCR done, waiting for user review)
        updateJob(jobId, {
          stage: "completed",
          progress: 100,
          title: t("processing.ocrComplete"),
          completedAt: Date.now(),
        });

        // Add notification - OCR complete, needs review
        addNotification({
          jobId,
          recordId,
          title: t("processing.ocrComplete"),
          personName,
          type: "success",
          message: t("processing.ocrReviewNeeded"),
        });

        // Show toast
        toast.success(t("processing.ocrComplete"), {
          description: t("processing.ocrReviewNeeded"),
          action: {
            label: t("processing.reviewOcr"),
            onClick: () => {
              window.location.href = `/health/records/${recordId}`;
            },
          },
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
          error instanceof Error ? error.message : "Processing failed";

        // Mark job as failed
        updateJob(jobId, {
          stage: "failed",
          error: errorMessage,
        });

        // Add notification
        addNotification({
          jobId,
          recordId,
          title: t("processing.failed"),
          personName,
          type: "error",
          message: errorMessage,
        });

        // Show error toast
        toast.error(t("processing.failed"), {
          description: errorMessage,
        });

        // Update record status back to draft (failed)
        const supabase = createClient();
        await supabase
          .from("medical_records")
          .update({ status: "draft" })
          .eq("id", recordId);

        // Invalidate queries
        queryClient.invalidateQueries({
          queryKey: ["medical-records"],
        });

        return { success: false, error: errorMessage };
      }
    },
    [t, queryClient, addJob, updateJob, addNotification]
  );

  return { startBackgroundOCR };
}

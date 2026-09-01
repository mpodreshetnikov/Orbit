"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

interface MedicalRecordPayload {
  id: string;
  title: string;
  status: string;
  person_id: string;
  ocr_error: string | null;
  structure_error: string | null;
}

/**
 * A record that stopped moving, and why.
 *
 * The client no longer waits on the pipeline's HTTP call, so this is the only place a failure
 * can reach the user: nothing is holding a response that could report it. `ocr_failed` is the
 * OCR pipeline's terminal failure; a structuring failure returns the record to `ocr_review`,
 * which is why the previous status has to be read to tell it from a normal completion.
 */
function readFailure(
  oldStatus: string | undefined,
  newRecord: MedicalRecordPayload,
): { message: string | null } | null {
  if (newRecord.status === "ocr_failed") {
    return { message: newRecord.ocr_error };
  }
  if (oldStatus === "structuring" && newRecord.status === "ocr_review") {
    return { message: newRecord.structure_error };
  }
  return null;
}

/**
 * This hook monitors for records that were in "processing" status
 * and have now been completed (moved to "draft").
 * Uses Supabase Realtime subscriptions instead of polling for instant updates.
 *
 * Should be mounted at the AppShell level to stay active across all health pages.
 */
/** How often jobs outside the subscribed person's channel are checked against the database. */
const ORPHANED_JOB_RECONCILE_MS = 30_000;

export function useProcessingMonitor(personId: string | null) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const updateJob = useProcessingQueueStore((state) => state.updateJob);
  const addNotification = useProcessingQueueStore((state) => state.addNotification);
  const processingRecordsRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (!personId) return;

    const supabase = createClient();

    // Initialize: fetch current processing records to track them
    const initializeProcessingRecords = async () => {
      try {
        // Fetch all records in any processing state
        const { data: processingRecords } = await supabase
          .from("medical_records")
          .select("id, title, status, person_id")
          .eq("person_id", personId)
          .in("status", ["ocr_processing", "structuring", "processing"]);

        processingRecordsRef.current = new Set((processingRecords || []).map((r) => r.id));
        isInitializedRef.current = true;

        console.log("[Realtime] Initialized processing monitor for person:", personId);
        console.log(
          "[Realtime] Tracking processing records:",
          Array.from(processingRecordsRef.current),
        );
      } catch (error) {
        console.error("[Realtime] Error initializing processing records:", error);
      }
    };

    /**
     * Close out jobs the realtime channel cannot see.
     *
     * The subscription is filtered to the selected person, so switching family members leaves a
     * job running with nothing watching for its completion -- and re-selecting the person does
     * not help, because initialisation only looks at records that are *still* processing. The
     * record has already moved by then.
     *
     * So the queue's own active jobs are reconciled against the database, whoever they belong
     * to. A read of the store costs nothing when there is nothing outstanding, which is the
     * usual case.
     */
    const reconcileActiveJobs = async () => {
      const store = useProcessingQueueStore.getState();
      const orphaned = store
        .getActiveJobs()
        .filter((job) => job.stage === "processing" && job.personId !== personId);
      if (orphaned.length === 0) return;

      const { data, error } = await supabase
        .from("medical_records")
        .select("id, title, status, ocr_error, structure_error")
        .in(
          "id",
          orphaned.map((job) => job.recordId),
        );
      if (error || !data) return;

      for (const record of data) {
        const job = orphaned.find((candidate) => candidate.recordId === record.id);
        if (!job) continue;

        if (record.status === "ocr_failed") {
          store.updateJob(job.id, {
            stage: "failed",
            error: record.ocr_error || t("processing.failed"),
          });
          continue;
        }
        // Past OCR: the transcription finished while nothing was listening. There is no toast
        // for it -- the moment to announce it has passed -- but the queue must stop claiming
        // the document is still being read.
        if (record.status !== "ocr_processing" && record.status !== "structuring") {
          store.updateJob(job.id, {
            stage: "completed",
            progress: 100,
            title: record.title,
            completedAt: Date.now(),
          });
        }
      }
    };

    // Handle realtime updates
    const handleRecordChange = (payload: RealtimePostgresChangesPayload<MedicalRecordPayload>) => {
      const { eventType, new: newRecord, old: oldRecord } = payload;

      // Debug logging - log all fields explicitly
      console.log("[Realtime] Received change:", eventType);
      console.log("[Realtime] Old record:", oldRecord);
      console.log("[Realtime] New record:", newRecord);

      // Only process changes for this person
      if (eventType === "UPDATE" && newRecord && oldRecord) {
        const oldStatus = oldRecord.status;
        const newStatus = newRecord.status;
        // The queue entry is where the person's name lives; a notification without it reads as
        // belonging to nobody on a family account.
        const personName =
          useProcessingQueueStore.getState().getJobByRecordId(newRecord.id)?.personName ?? "";

        // Check if a record completed a processing stage
        // OCR processing: ocr_processing -> ocr_review
        // Structure processing: structuring -> structure_review
        // `ocr_failed` is included because a record can be marked failed by a client whose
        // connection dropped and then be finished by the run that actually owned it. Recovery is
        // a completion, and the job has to be told.
        const isOcrComplete =
          (oldStatus === "ocr_processing" || oldStatus === "ocr_failed") &&
          newStatus === "ocr_review";
        const isStructureComplete = oldStatus === "structuring" && newStatus === "structure_review";

        const failure = readFailure(oldStatus, newRecord);
        if (failure && processingRecordsRef.current.has(newRecord.id)) {
          const message = failure.message || t("processing.failed");
          console.log("[Realtime] Record failed processing:", newRecord.id, newStatus);
          processingRecordsRef.current.delete(newRecord.id);
          updateJob(newRecord.id, { stage: "failed", error: message });
          addNotification({
            jobId: newRecord.id,
            recordId: newRecord.id,
            title: t("processing.failed"),
            personName,
            type: "error",
            message,
          });
          toast.error(t("processing.failed"), { description: message });
          queryClient.invalidateQueries({ queryKey: ["medical-records"] });
          queryClient.invalidateQueries({ queryKey: ["medical-record", newRecord.id] });
        }

        if (isOcrComplete || isStructureComplete) {
          console.log(
            "[Realtime] Record completed processing stage:",
            newRecord.id,
            oldStatus,
            "->",
            newStatus,
          );

          // Remove from tracking
          processingRecordsRef.current.delete(newRecord.id);

          // Update the processing queue store to mark job as completed
          updateJob(newRecord.id, {
            stage: "completed",
            progress: 100,
            title: newRecord.title,
            completedAt: Date.now(),
          });

          // Show notification
          const notificationMessage = isOcrComplete
            ? t("processing.ocrComplete")
            : t("processing.completed");

          addNotification({
            jobId: newRecord.id,
            recordId: newRecord.id,
            title: newRecord.title,
            personName,
            type: "success",
            message: isOcrComplete
              ? t("processing.ocrReviewNeeded")
              : t("processing.reviewStructure"),
          });

          toast.success(notificationMessage, {
            description: newRecord.title,
            action: {
              label: t("processing.viewRecord"),
              onClick: () => {
                window.location.href = `/health/records/${newRecord.id}`;
              },
            },
          });

          // Invalidate queries
          queryClient.invalidateQueries({
            queryKey: ["medical-records"],
          });
          queryClient.invalidateQueries({
            queryKey: ["medical-record", newRecord.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["record-observations", newRecord.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["record-findings", newRecord.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["condition-records", "record", newRecord.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["conditions", "person", personId],
          });
        }

        // Track any record that enters a processing status
        const processingStatuses = ["ocr_processing", "structuring", "processing"];
        if (processingStatuses.includes(newStatus as string)) {
          console.log("[Realtime] Record started processing:", newRecord.id, newStatus);
          processingRecordsRef.current.add(newRecord.id);
        }

        // Update job title when record title changes (e.g. after OCR sets suggested name)
        if (processingRecordsRef.current.has(newRecord.id) && newRecord.title) {
          updateJob(newRecord.id, { title: newRecord.title });
        }
      }

      // Track new records that are created with "processing" status
      if (eventType === "INSERT" && newRecord) {
        console.log("[Realtime] New record inserted:", newRecord.id, newRecord.status);
        if (newRecord.status === "processing") {
          processingRecordsRef.current.add(newRecord.id);
        }
        // Invalidate records list for new records
        queryClient.invalidateQueries({
          queryKey: ["medical-records"],
        });
      }

      // Handle deletions
      if (eventType === "DELETE" && oldRecord && oldRecord.id) {
        console.log("[Realtime] Record deleted:", oldRecord.id);
        processingRecordsRef.current.delete(oldRecord.id);
        queryClient.invalidateQueries({
          queryKey: ["medical-records"],
        });
      }
    };

    // Initialize tracking
    initializeProcessingRecords();
    reconcileActiveJobs();
    // A job for another person is invisible to this channel for as long as that person stays
    // selected, so it is reconciled on a slow tick rather than left until the next navigation.
    const reconcileTimer = setInterval(reconcileActiveJobs, ORPHANED_JOB_RECONCILE_MS);

    // Subscribe to realtime changes for this person's medical records
    console.log("[Realtime] Subscribing to medical_records for person:", personId);
    const channel = supabase
      .channel(`medical-records-${personId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "medical_records",
          filter: `person_id=eq.${personId}`,
        },
        handleRecordChange,
      )
      .subscribe((status, err) => {
        console.log("[Realtime] Subscription status:", status);
        if (err) {
          console.error("[Realtime] Subscription error:", err);
        }
      });

    return () => {
      // Clean up subscription on unmount
      clearInterval(reconcileTimer);
      console.log("[Realtime] Unsubscribing from medical_records for person:", personId);
      supabase.removeChannel(channel);
      isInitializedRef.current = false;
      processingRecordsRef.current.clear();
    };
  }, [personId, queryClient, t, updateJob, addNotification]);
}

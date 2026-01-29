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
}

/**
 * This hook monitors for records that were in "processing" status
 * and have now been completed (moved to "draft").
 * Uses Supabase Realtime subscriptions instead of polling for instant updates.
 * 
 * Should be mounted at the AppShell level to stay active across all health pages.
 */
export function useProcessingMonitor(personId: string | null) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const updateJob = useProcessingQueueStore((state) => state.updateJob);
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

        processingRecordsRef.current = new Set(
          (processingRecords || []).map((r) => r.id)
        );
        isInitializedRef.current = true;
        
        console.log("[Realtime] Initialized processing monitor for person:", personId);
        console.log("[Realtime] Tracking processing records:", Array.from(processingRecordsRef.current));
      } catch (error) {
        console.error("[Realtime] Error initializing processing records:", error);
      }
    };

    // Handle realtime updates
    const handleRecordChange = (
      payload: RealtimePostgresChangesPayload<MedicalRecordPayload>
    ) => {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      
      // Debug logging - log all fields explicitly
      console.log("[Realtime] Received change:", eventType);
      console.log("[Realtime] Old record:", oldRecord);
      console.log("[Realtime] New record:", newRecord);

      // Only process changes for this person
      if (eventType === "UPDATE" && newRecord && oldRecord) {
        const oldStatus = oldRecord.status;
        const newStatus = newRecord.status;
        
        // Check if a record completed a processing stage
        // OCR processing: ocr_processing -> ocr_review
        // Structure processing: structuring -> structure_review
        const isOcrComplete = oldStatus === "ocr_processing" && newStatus === "ocr_review";
        const isStructureComplete = oldStatus === "structuring" && newStatus === "structure_review";
        
        if (isOcrComplete || isStructureComplete) {
          console.log("[Realtime] Record completed processing stage:", newRecord.id, oldStatus, "->", newStatus);
          
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
        handleRecordChange
      )
      .subscribe((status, err) => {
        console.log("[Realtime] Subscription status:", status);
        if (err) {
          console.error("[Realtime] Subscription error:", err);
        }
      });

    return () => {
      // Clean up subscription on unmount
      console.log("[Realtime] Unsubscribing from medical_records for person:", personId);
      supabase.removeChannel(channel);
      isInitializedRef.current = false;
      processingRecordsRef.current.clear();
    };
  }, [personId, queryClient, t, updateJob]);
}

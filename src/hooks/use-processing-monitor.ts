"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase";
import type { RecordStatus } from "@/types";

interface ProcessingRecord {
  id: string;
  title: string;
  status: RecordStatus;
  person_id: string;
}

/**
 * This hook monitors for records that were in "processing" status
 * and have now been completed (moved to "draft").
 * It polls the database and shows notifications when records are ready.
 */
export function useProcessingMonitor(personId: string | null) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const processingRecordsRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (!personId) return;

    const supabase = createClient();

    const checkProcessingRecords = async () => {
      try {
        // Fetch all records with "processing" status for this person
        const { data: processingRecords } = await supabase
          .from("medical_records")
          .select("id, title, status, person_id")
          .eq("person_id", personId)
          .eq("status", "processing");

        // Fetch all draft records to check if any were previously processing
        const { data: draftRecords } = await supabase
          .from("medical_records")
          .select("id, title, status, person_id")
          .eq("person_id", personId)
          .eq("status", "draft");

        const currentProcessingIds = new Set(
          (processingRecords || []).map((r) => r.id)
        );

        // On first run, just initialize the tracking set
        if (!isInitializedRef.current) {
          processingRecordsRef.current = currentProcessingIds;
          isInitializedRef.current = true;
          return;
        }

        // Check if any previously processing records are now in draft
        const completedRecords: ProcessingRecord[] = [];
        
        for (const recordId of processingRecordsRef.current) {
          if (!currentProcessingIds.has(recordId)) {
            // This record is no longer processing
            const draftRecord = (draftRecords || []).find((r) => r.id === recordId);
            if (draftRecord) {
              completedRecords.push(draftRecord as ProcessingRecord);
            }
          }
        }

        // Show notifications for completed records
        for (const record of completedRecords) {
          toast.success(t("processing.completed"), {
            description: record.title,
            action: {
              label: t("processing.viewRecord"),
              onClick: () => {
                window.location.href = `/health/records/${record.id}`;
              },
            },
          });
        }

        // Invalidate queries if any records completed
        if (completedRecords.length > 0) {
          queryClient.invalidateQueries({
            queryKey: ["medical-records"],
          });
          
          // Also invalidate observations, findings, and conditions for each completed record
          for (const record of completedRecords) {
            queryClient.invalidateQueries({
              queryKey: ["record-observations", record.id],
            });
            queryClient.invalidateQueries({
              queryKey: ["record-findings", record.id],
            });
            queryClient.invalidateQueries({
              queryKey: ["condition-records", "record", record.id],
            });
          }
          
          // Invalidate person-level condition queries
          queryClient.invalidateQueries({
            queryKey: ["conditions", "person", personId],
          });
        }

        // Update the tracking set
        processingRecordsRef.current = currentProcessingIds;

        // Also check if there are any processing records we don't know about
        // (e.g., started in another tab) and add them to tracking
        for (const record of processingRecords || []) {
          if (!processingRecordsRef.current.has(record.id)) {
            processingRecordsRef.current.add(record.id);
          }
        }

      } catch (error) {
        console.error("Error checking processing records:", error);
      }
    };

    // Check immediately
    checkProcessingRecords();

    // Then poll every 3 seconds
    const intervalId = setInterval(checkProcessingRecords, 3000);

    return () => {
      clearInterval(intervalId);
    };
  }, [personId, queryClient, t]);
}

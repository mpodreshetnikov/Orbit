"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { HealthStructureResponse, StructuredData } from "@/types";

interface StructureExtractionInput {
  recordId: string;
}

interface StructureExtractionResult {
  success: boolean;
  structured_data?: StructuredData;
  error?: string;
}

export function useStructureExtraction() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [isExtracting, setIsExtracting] = useState(false);

  const extractStructure = useCallback(
    async ({ recordId }: StructureExtractionInput): Promise<StructureExtractionResult> => {
      setIsExtracting(true);

      try {
        const supabase = createClient();

        // Get current session for auth
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          throw new Error("Not authenticated");
        }

        // Update record status to "structuring"
        await supabase
          .from("medical_records")
          .update({ status: "structuring" })
          .eq("id", recordId);

        // Call health-structure edge function
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("Supabase URL not configured");
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/health-structure`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ record_id: recordId }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Structure extraction failed: ${errorText || response.statusText}`);
        }

        const data: HealthStructureResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Structure extraction failed");
        }

        // Show success toast
        toast.success(t("processing.structureComplete"), {
          description: data.structured_data?.title || t("processing.reviewStructure"),
        });

        // Invalidate queries
        queryClient.invalidateQueries({
          queryKey: ["medical-records"],
        });
        queryClient.invalidateQueries({
          queryKey: ["medical-record", recordId],
        });
        queryClient.invalidateQueries({
          queryKey: ["record-observations", recordId],
        });
        queryClient.invalidateQueries({
          queryKey: ["record-findings", recordId],
        });
        // Invalidate finding history queries (includes auto-resolved findings)
        queryClient.invalidateQueries({
          queryKey: ["person-finding-history"],
        });
        queryClient.invalidateQueries({
          queryKey: ["single-finding-history"],
        });
        // Invalidate condition-related queries (includes auto-resolved conditions)
        queryClient.invalidateQueries({
          queryKey: ["condition-records", "record", recordId],
        });
        queryClient.invalidateQueries({
          queryKey: ["conditions"],
        });
        queryClient.invalidateQueries({
          queryKey: ["person-conditions"],
        });

        return { success: true, structured_data: data.structured_data };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Structure extraction failed";

        // Show error toast
        toast.error(t("processing.structureFailed"), {
          description: errorMessage,
        });

        // Update record status back to ocr_review (so user can try again)
        const supabase = createClient();
        await supabase
          .from("medical_records")
          .update({ status: "ocr_review" })
          .eq("id", recordId);

        // Invalidate queries
        queryClient.invalidateQueries({
          queryKey: ["medical-records"],
        });

        return { success: false, error: errorMessage };
      } finally {
        setIsExtracting(false);
      }
    },
    [t, queryClient]
  );

  return { extractStructure, isExtracting };
}

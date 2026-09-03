"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase";
import { useUpdateConditionRecord } from "./use-conditions";
import {
  proposedClosureStillHolds,
  type PersistedObservation,
} from "@/lib/conditions/resolution-proposal";

/** What ruling on a proposed closure needs to know about the mention. */
export interface RulableClosure {
  id: string;
  record_id: string;
  condition_id?: string | null;
  status_in_record: string;
  supporting_obs_code: string | null;
}

export type ClosureRuling = "confirmed" | "dismissed";

/**
 * Confirm or reject a proposed lab-driven closure, from wherever the person is looking at it.
 *
 * Written once and used from every screen that shows such a proposal, because confirming is the
 * moment a suppressed closure becomes authoritative and the re-check below is what stands between
 * that and a condition ended on evidence nobody has any more. A second screen with its own copy of
 * this would be a second chance to omit the check -- which is exactly how the condition page came
 * to have a confirm button without one.
 *
 * Confirming says only that a person verified the mention: `useUpdateConditionRecord` writes
 * `review_decision: "confirmed"` beside it and recomputes the condition, and that recompute is what
 * finally lets the closure reach the chart. Dismissing writes the decision alone -- the row stays,
 * still suppressed, carrying the negative label the promotion rule counts, and deliberately not
 * verified, since rejecting a closure must never verify it.
 */
export function useRuleOnProposedClosure() {
  const t = useTranslations();
  const updateConditionRecordMutation = useUpdateConditionRecord();
  const [rulingOnId, setRulingOnId] = useState<string | null>(null);

  /** Resolves true when the ruling was written, false when it was refused. */
  const ruleOnClosure = async (
    mention: RulableClosure,
    decision: ClosureRuling,
  ): Promise<boolean> => {
    setRulingOnId(mention.id);
    try {
      // The evidence is re-read here rather than trusted from the screen. Showing a measurement is
      // not checking it: the panel names the one cited code, while an entry can rest on two, and a
      // person can correct the value between the page loading and the click. The activation path
      // applies this same guard, with this same function.
      if (decision === "confirmed" && mention.supporting_obs_code) {
        const { data, error } = await createClient()
          .from("record_observations")
          .select(
            "obs_code, is_applied, value_numeric, value_canonical, ref_range_low, ref_range_high, ref_range_low_canonical, ref_range_high_canonical, status",
          )
          .eq("record_id", mention.record_id);

        // A read that failed is not evidence that the closure still holds.
        if (error) {
          toast.error(t("conditions.confirmClosureFailed"), { description: error.message });
          return false;
        }
        if (!proposedClosureStillHolds(mention, (data ?? []) as PersistedObservation[])) {
          toast.error(t("conditions.confirmClosureNoLongerHolds"));
          return false;
        }
      }

      await updateConditionRecordMutation.mutateAsync({
        id: mention.id,
        conditionId: mention.condition_id ?? undefined,
        updates:
          decision === "confirmed"
            ? { is_user_verified: true }
            : { review_decision: "dismissed" as const },
      });
      return true;
    } finally {
      setRulingOnId(null);
    }
  };

  return { ruleOnClosure, rulingOnId };
}

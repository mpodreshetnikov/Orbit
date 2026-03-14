"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { MoneyCategoryRuleRun } from "@/types";
import { asMoneyCategoryRuleRun } from "./use-money-category-rules";

async function fetchMoneyCategoryDebug(
  lineItemId: string,
  limit: number,
): Promise<MoneyCategoryRuleRun[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("money_get_category_rule_debug", {
    p_line_item_id: lineItemId,
    p_limit: limit,
  });

  if (error) throw new Error(error.message);
  const runs = Array.isArray(data) ? data : [];
  return runs.map((run) => asMoneyCategoryRuleRun((run ?? {}) as Record<string, unknown>));
}

export function useMoneyCategoryDebug(lineItemId: string | null, limit = 20) {
  return useQuery({
    queryKey: ["money-category-debug", lineItemId, limit],
    queryFn: () => fetchMoneyCategoryDebug(lineItemId!, limit),
    enabled: !!lineItemId,
  });
}

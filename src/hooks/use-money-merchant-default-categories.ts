"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";

async function fetchMerchantDefaultCategories(
  payerPersonId: string
): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_money_merchant_default_categories", {
    p_payer_person_id: payerPersonId,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { merchant_name: string; category_id: string }[];
  return Object.fromEntries(rows.map((r) => [r.merchant_name, r.category_id]));
}

export function useMoneyMerchantDefaultCategories(payerPersonId: string | null) {
  return useQuery({
    queryKey: ["money-merchant-default-categories", payerPersonId],
    queryFn: () => fetchMerchantDefaultCategories(payerPersonId!),
    enabled: !!payerPersonId,
  });
}

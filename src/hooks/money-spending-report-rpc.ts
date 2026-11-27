/**
 * Optional merchant/brand filters for `money_get_spending_report` (T-261028-yhm).
 * Kept tiny and separate so the large `use-money-reports` module can match main.
 */

export interface SpendingReportMerchantFilters {
  brandId?: string | null;
  merchantName?: string | null;
}

/** RPC args for brand/merchant narrowing; always sends explicit nulls when unset. */
export function spendingReportMerchantRpcArgs(filters: SpendingReportMerchantFilters): {
  p_brand_id: string | null;
  p_merchant_name: string | null;
} {
  return {
    p_brand_id: filters.brandId ?? null,
    p_merchant_name: filters.merchantName ?? null,
  };
}

/** Query-key tail so cache entries differ by merchant filter. */
export function spendingReportMerchantQueryKey(
  filters: SpendingReportMerchantFilters,
): [string | null, string | null] {
  return [filters.brandId ?? null, filters.merchantName ?? null];
}

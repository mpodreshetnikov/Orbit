/**
 * FX sync window for a spending-report period (T-261028-yhm).
 * Pure helper so date-branch mutants stay outside the React Query hook body.
 */

export function spendingReportFxSyncRange(
  period: { start: string; end: string },
  today: string,
): { start: string; end: string } | null {
  const syncEnd = period.end < today ? period.end : today;
  if (period.start > syncEnd) return null;
  return { start: period.start, end: syncEnd };
}

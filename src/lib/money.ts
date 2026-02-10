import type { MoneyCurrency } from "@/types";

export function formatMoney(
  amount: number,
  currency: MoneyCurrency | string,
  locale: string
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCurrency = (currency || "RUB").toString().toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return `${safeAmount.toFixed(2)} ${safeCurrency}`;
  }
}

import type { MoneyAccountKind, MoneyCard, MoneyCurrency } from "./money";

/** The accounts page's logic apart from the screens: the web page and the phone save alike. */

export interface AccountForm {
  label: string;
  accountKind: MoneyAccountKind;
  currency: MoneyCurrency | string;
  source: string;
  externalId: string;
  isActive: boolean;
}

export const EMPTY_ACCOUNT_FORM: AccountForm = {
  label: "",
  accountKind: "card",
  currency: "RUB",
  source: "manual",
  externalId: "",
  isActive: true,
};

/** The columns an account is saved with; null while it has no name. */
export function accountColumns(form: AccountForm) {
  if (!form.label.trim()) return null;
  return {
    account_label: form.label.trim(),
    account_kind: form.accountKind,
    currency: form.currency,
    source: form.source.trim() || "manual",
    external_account_id: form.externalId.trim() || null,
    is_active: form.isActive,
  };
}

/** The last four digits typed, digits only; empty when there are none. */
export function cardLast4(typed: string): string {
  return typed.replace(/\D/g, "").slice(-4);
}

/** Each account's cards. */
export function cardsByAccount(cards: MoneyCard[]): Record<string, MoneyCard[]> {
  const map: Record<string, MoneyCard[]> = {};
  for (const card of cards) (map[card.account_id] ??= []).push(card);
  return map;
}

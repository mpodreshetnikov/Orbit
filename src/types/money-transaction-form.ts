import type {
  CreateMoneyLineItemInput,
  CreateMoneyTransactionInput,
  MoneyLineItem,
  MoneyLineStatus,
} from "./money";

/**
 * The transaction form's logic apart from the screens that draw it: the web form and the phone's
 * open on the same line items, check the same things and write the same rows.
 */

/** A line item as the form edits it: its numbers still text. */
export interface LineItemDraft {
  id?: string;
  key: string;
  title: string;
  amount: string;
  quantity: string;
  unit: string;
  line_status: MoneyLineStatus;
  related_line_item_id: string | null;
  category_id: string | null;
  category_locked_by_user: boolean;
  beneficiary_person_id: string | null;
  assignment_method: CreateMoneyLineItemInput["assignment_method"];
  assignment_rule_id: string | null;
  assignment_confidence: number | null;
  raw_payload: Record<string, unknown> | null;
  last_category_rule_id: string | null;
  last_category_rule_run_id: string | null;
  category_assigned_at: string | null;
}

let draftCount = 0;

/** A blank line item, or one seeded with what is given. */
export function lineItemDraft(seed?: Partial<LineItemDraft>): LineItemDraft {
  draftCount += 1;
  return {
    key: `draft-${Date.now()}-${draftCount}`,
    title: "",
    amount: "",
    quantity: "",
    unit: "",
    line_status: "final",
    related_line_item_id: null,
    category_id: null,
    category_locked_by_user: false,
    beneficiary_person_id: null,
    assignment_method: "manual",
    assignment_rule_id: null,
    assignment_confidence: null,
    raw_payload: null,
    last_category_rule_id: null,
    last_category_rule_run_id: null,
    category_assigned_at: null,
    ...seed,
  };
}

/** The form's line items for saved ones, or a single blank one. */
export function lineItemDrafts(items: MoneyLineItem[] | null | undefined): LineItemDraft[] {
  if (!items?.length) return [lineItemDraft()];
  return items.map((item) =>
    lineItemDraft({
      id: item.id,
      title: item.title,
      amount: String(item.amount),
      quantity: item.quantity != null ? String(item.quantity) : "",
      unit: item.unit ?? "",
      line_status: item.line_status,
      related_line_item_id: item.related_line_item_id,
      category_id: item.category_id,
      category_locked_by_user: item.category_locked_by_user ?? false,
      beneficiary_person_id: item.beneficiary_person_id,
      assignment_method: item.assignment_method,
      assignment_rule_id: item.assignment_rule_id,
      assignment_confidence: item.assignment_confidence,
      raw_payload: item.raw_payload,
      last_category_rule_id: item.last_category_rule_id ?? null,
      last_category_rule_run_id: item.last_category_rule_run_id ?? null,
      category_assigned_at: item.category_assigned_at ?? null,
    }),
  );
}

/** A category picked by hand: locked against the rules, which no longer own it. */
export function manualCategoryChange(
  item: LineItemDraft,
  categoryId: string | null,
  now: Date,
): Partial<LineItemDraft> {
  return {
    category_id: categoryId,
    category_locked_by_user: categoryId !== null,
    assignment_method: "manual",
    assignment_rule_id: null,
    assignment_confidence: null,
    last_category_rule_id: null,
    last_category_rule_run_id: null,
    category_assigned_at: categoryId ? now.toISOString() : null,
    raw_payload: item.raw_payload,
  };
}

/** The merchant's usual category in each line item that has none and is not locked. */
export function withMerchantCategory(
  items: LineItemDraft[],
  categoryId: string | null | undefined,
): LineItemDraft[] {
  if (!categoryId) return items;
  return items.map((item) => ({
    ...item,
    category_id: item.category_id || item.category_locked_by_user ? item.category_id : categoryId,
  }));
}

/**
 * A typed amount as a number: a decimal comma reads as a point, spaces between digit groups are
 * dropped, and anything else in the text makes it NaN rather than cutting the number short.
 */
export function parseAmount(text: string): number {
  const normalized = text.replace(/\s/g, "").replace(",", ".");
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
}

const numberOr = <T>(text: string, fallback: T): number | T => {
  const value = parseAmount(text);
  return Number.isFinite(value) ? value : fallback;
};

/** The line items' sum. */
export function lineItemsTotal(items: LineItemDraft[]): number {
  return items.reduce((sum, item) => sum + numberOr(item.amount, 0), 0);
}

/** Whether the line items do not add up to the amount, compared in cents. */
export function lineItemsMismatch(amount: string, items: LineItemDraft[]): boolean {
  return Math.round(lineItemsTotal(items) * 100) !== Math.round(numberOr(amount, 0) * 100);
}

/** What stops a save, as the web form's message key; null when nothing does. */
export function transactionFormProblem(form: {
  accountId: string;
  postedAt: string;
  amount: string;
}): string | null {
  if (!form.accountId) return "money.validationAccountRequired";
  if (!form.postedAt) return "money.validationPostedAtRequired";
  if (!Number.isFinite(parseAmount(form.amount))) return "money.validationAmountRequired";
  return null;
}

/** The line items to save: blank ones dropped, a missing title taken from the merchant. */
export function lineItemInputs(
  items: LineItemDraft[],
  merchantName: string,
): CreateMoneyLineItemInput[] {
  return items
    .filter((item) => item.title.trim() || item.amount.trim())
    .map((item) => ({
      id: item.id,
      title: item.title.trim() || merchantName.trim() || "Manual item",
      amount: numberOr(item.amount, 0),
      quantity: numberOr(item.quantity, null),
      unit: item.unit.trim() || null,
      line_status: item.line_status,
      related_line_item_id: item.related_line_item_id,
      category_id: item.category_id ?? null,
      beneficiary_person_id: item.beneficiary_person_id ?? null,
      assignment_method: item.assignment_method ?? "manual",
      assignment_rule_id: item.assignment_rule_id,
      assignment_confidence: item.assignment_confidence,
      raw_payload: item.raw_payload,
      category_locked_by_user: item.category_locked_by_user,
      last_category_rule_id: item.last_category_rule_id,
      last_category_rule_run_id: item.last_category_rule_run_id,
      category_assigned_at: item.category_assigned_at,
    }));
}

/** The merchants already used, once each, in order: the form's suggestions. */
export function merchantNames(transactions: { merchant_name: string | null }[]): string[] {
  return [
    ...new Set(
      transactions
        .map((tx) => tx.merchant_name)
        .filter((name): name is string => Boolean(name?.trim())),
    ),
  ].sort();
}

/** The `money_transactions` row a new transaction is inserted as. */
export function transactionInsertRow(transaction: CreateMoneyTransactionInput) {
  return {
    payer_person_id: transaction.payer_person_id,
    account_id: transaction.account_id,
    brand_id: transaction.brand_id ?? null,
    source: transaction.source ?? "manual",
    external_id: transaction.external_id ?? null,
    posted_at: transaction.posted_at,
    amount: transaction.amount,
    currency: transaction.currency,
    transaction_type: transaction.transaction_type,
    status: transaction.status ?? "posted",
    merchant_name: transaction.merchant_name ?? null,
    mcc: transaction.mcc ?? null,
    comment: transaction.comment ?? null,
    source_comment: transaction.source_comment ?? null,
    cashback_amount: transaction.cashback_amount ?? null,
    cashback_currency: transaction.cashback_currency ?? null,
    operation_icon_url: transaction.operation_icon_url ?? null,
    source_category_id: transaction.source_category_id ?? null,
    source_category_name: transaction.source_category_name ?? null,
    is_transfer: transaction.is_transfer ?? false,
    transfer_group_id: transaction.transfer_group_id ?? null,
    raw_payload: transaction.raw_payload ?? null,
    dedupe_hash: transaction.dedupe_hash ?? null,
  };
}

/** The `money_line_items` row a line item is written as. */
export function lineItemRow(item: CreateMoneyLineItemInput, transactionId: string) {
  return {
    transaction_id: transactionId,
    title: item.title,
    amount: item.amount,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    line_status: item.line_status ?? "final",
    related_line_item_id: item.related_line_item_id ?? null,
    category_id: item.category_id ?? null,
    beneficiary_person_id: item.beneficiary_person_id ?? null,
    assignment_method: item.assignment_method ?? "manual",
    assignment_rule_id: item.assignment_rule_id ?? null,
    assignment_confidence: item.assignment_confidence ?? null,
    category_locked_by_user: item.category_locked_by_user ?? false,
    raw_payload: item.raw_payload ?? null,
    last_category_rule_id: item.last_category_rule_id ?? null,
    last_category_rule_run_id: item.last_category_rule_run_id ?? null,
    category_assigned_at: item.category_assigned_at ?? null,
  };
}

/** The line items to write: those given, or one for the whole amount when none are. */
export function lineItemsOrWhole(
  items: CreateMoneyLineItemInput[],
  merchantName: string | null | undefined,
  amount: number,
): CreateMoneyLineItemInput[] {
  if (items.length > 0) return items;
  return [
    {
      title: merchantName?.trim() || "Manual item",
      amount,
      line_status: "final",
      assignment_method: "manual",
    },
  ];
}

/** How an edit reaches the saved line items: which go, which change, which are new. */
export function lineItemChanges(currentIds: string[], items: CreateMoneyLineItemInput[]) {
  const current = new Set(currentIds);
  const kept = new Set(items.map((item) => item.id).filter(Boolean));
  return {
    removed: currentIds.filter((id) => !kept.has(id)),
    changed: items.filter((item) => item.id && current.has(item.id)),
    added: items.filter((item) => !item.id || !current.has(item.id)),
  };
}

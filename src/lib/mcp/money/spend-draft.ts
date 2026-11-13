import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  lineItemRow,
  lineItemsOrWhole,
  lineItemUpdateRows,
  transactionInsertRow,
} from "@/types/money-transaction-form";
import type {
  CreateMoneyLineItemInput,
  CreateMoneyTransactionInput,
  MoneyAssignmentMethod,
  MoneyLineStatus,
  MoneyTransactionType,
  UpdateMoneyTransactionInput,
} from "@/types/money";
import { isValidTimeZone } from "@/lib/mcp/local-day";
import { listMoneyAccounts, listMoneyCategories } from "./transactions";

type MoneyTransactionInsert = Database["public"]["Tables"]["money_transactions"]["Insert"];
type MoneyLineItemInsert = Database["public"]["Tables"]["money_line_items"]["Insert"];

/**
 * Agent spend create/edit as a draft the owner confirms on a card (stream D / T-261109-23p).
 *
 * Propose builds a view and writes nothing. Confirm re-checks the account/person and applies the
 * same insert / `money_update_transaction_with_lines` path the web form uses. Amounts belong on the
 * card; tool text stays free of figures so chat logs do not print personal money amounts.
 */

type Client = SupabaseClient<Database>;

export type SpendDraftMode = "create" | "edit";

export interface SpendLineInput {
  id?: string;
  title: string;
  amount: number;
  quantity?: number | null;
  unit?: string | null;
  line_status?: MoneyLineStatus;
  related_line_item_id?: string | null;
  category_id?: string | null;
  beneficiary_person_id?: string | null;
  assignment_method?: MoneyAssignmentMethod;
  assignment_rule_id?: string | null;
  assignment_confidence?: number | null;
  category_locked_by_user?: boolean;
  last_category_rule_id?: string | null;
  last_category_rule_run_id?: string | null;
  category_assigned_at?: string | null;
}

export interface SpendCreateInput {
  account_id: string;
  posted_at: string;
  amount: number;
  currency: string;
  transaction_type: MoneyTransactionType;
  merchant_name?: string | null;
  comment?: string | null;
  line_items?: SpendLineInput[];
}

export interface SpendEditInput {
  transaction_id: string;
  account_id?: string;
  posted_at?: string;
  amount?: number;
  currency?: string;
  transaction_type?: MoneyTransactionType;
  merchant_name?: string | null;
  comment?: string | null;
  line_items?: SpendLineInput[];
}

export interface SpendDraftLineView {
  title: string;
  amount_label: string;
  category_label: string | null;
}

export interface SpendDraftView {
  mode: SpendDraftMode;
  person_id: string;
  person_name: string;
  transaction_id: string | null;
  account_label: string;
  posted_at_label: string;
  amount_label: string;
  type_label: string;
  merchant_name: string | null;
  comment: string | null;
  lines: SpendDraftLineView[];
  /**
   * Edit-only: human-readable field diffs vs the stored transaction (empty when nothing changed).
   * Create drafts leave this empty — the whole preview is new.
   */
  changes: string[];
  /** Opaque payload the card sends back on Confirm, unchanged. */
  input: SpendCreateInput | SpendEditInput;
}

const TYPE_LABELS: Record<MoneyTransactionType, string> = {
  expense: "трата",
  income: "доход",
  transfer: "перевод",
  refund: "возврат",
  fee: "комиссия",
  adjustment: "корректировка",
};

const EXISTING_LINE_SELECT =
  "id, title, amount, quantity, unit, line_status, related_line_item_id, category_id, beneficiary_person_id, assignment_method, assignment_rule_id, assignment_confidence, category_locked_by_user, last_category_rule_id, last_category_rule_run_id, category_assigned_at";

export function formatMoneyAmount(amount: number, currency: string): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toFixed(2)} ${currency}`;
}

/**
 * Display zone for `posted_at_label`. Same contract as money MCP reads: saved preference
 * when valid, otherwise UTC — never print the word "UTC" in the label itself.
 */
export type SpendDraftBuildOptions = {
  timeZone?: string | null;
};

export function resolveSpendDraftTimeZone(timeZone?: string | null): string {
  const trimmed = timeZone?.trim() || null;
  return trimmed && isValidTimeZone(trimmed) ? trimmed : "UTC";
}

function russianDateTime(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: resolveSpendDraftTimeZone(timeZone),
  });
}

/** Same lock the web form's manualCategoryChange uses: rules must not overwrite a confirmed pick. */
export function effectiveCategoryLock(item: SpendLineInput): boolean {
  if (item.category_locked_by_user !== undefined) return item.category_locked_by_user;
  const method = item.assignment_method ?? "manual";
  return Boolean(item.category_id && method === "manual");
}

function toLineInputs(
  items: SpendLineInput[] | undefined,
  merchantName: string | null | undefined,
  amount: number,
): CreateMoneyLineItemInput[] {
  const mapped = (items ?? []).map((item) => ({
    id: item.id,
    title: item.title.trim(),
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
    category_locked_by_user: effectiveCategoryLock(item),
    last_category_rule_id: item.last_category_rule_id ?? null,
    last_category_rule_run_id: item.last_category_rule_run_id ?? null,
    category_assigned_at: item.category_assigned_at ?? null,
  }));
  return lineItemsOrWhole(mapped, merchantName, amount);
}

function serializeLines(items: SpendLineInput[]): SpendLineInput[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title.trim(),
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
    category_locked_by_user: effectiveCategoryLock(item),
    last_category_rule_id: item.last_category_rule_id ?? null,
    last_category_rule_run_id: item.last_category_rule_run_id ?? null,
    category_assigned_at: item.category_assigned_at ?? null,
  }));
}

async function categoryNameMap(supabase: Client): Promise<Map<string, string>> {
  const categories = await listMoneyCategories(supabase);
  return new Map(categories.map((row) => [row.id, row.name_ru || row.name_en || row.id]));
}

async function unknownCategoryIds(
  supabase: Client,
  items: SpendLineInput[] | undefined,
): Promise<string[]> {
  const ids = [
    ...new Set((items ?? []).map((item) => item.category_id).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return [];
  const names = await categoryNameMap(supabase);
  return ids.filter((id) => !names.has(id));
}

async function resolveAccount(
  supabase: Client,
  personId: string,
  accountId: string,
): Promise<{ id: string; account_label: string; currency: string } | { error: string }> {
  const accounts = await listMoneyAccounts(supabase, personId);
  const account = accounts.find((row) => row.id === accountId);
  if (!account) {
    return {
      error: `No money account ${accountId} for this person. Call list_money_accounts for the ids that exist.`,
    };
  }
  if (!account.is_active) {
    return { error: `Account "${account.account_label}" is inactive.` };
  }
  return account;
}

function buildLinesView(
  lines: CreateMoneyLineItemInput[],
  currency: string,
  names: Map<string, string>,
): SpendDraftLineView[] {
  return lines.map((line) => ({
    title: line.title,
    amount_label: formatMoneyAmount(line.amount, currency),
    category_label: line.category_id ? (names.get(line.category_id) ?? null) : null,
  }));
}

export async function buildCreateSpendDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: SpendCreateInput,
  options?: SpendDraftBuildOptions,
): Promise<{ ok: true; draft: SpendDraftView } | { ok: false; error: string }> {
  if (!Number.isFinite(input.amount)) {
    return { ok: false, error: "amount must be a finite number." };
  }
  const posted = new Date(input.posted_at);
  if (Number.isNaN(posted.getTime())) {
    return { ok: false, error: "posted_at must be an ISO datetime." };
  }
  const account = await resolveAccount(supabase, person.id, input.account_id);
  if ("error" in account) return { ok: false, error: account.error };

  const unknown = await unknownCategoryIds(supabase, input.line_items);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown category id(s): ${unknown.join(", ")}. Call list_money_categories.`,
    };
  }

  const currency = input.currency.trim() || account.currency;
  const lines = toLineInputs(input.line_items, input.merchant_name, input.amount);
  const names = await categoryNameMap(supabase);
  const normalized: SpendCreateInput = {
    account_id: input.account_id,
    posted_at: posted.toISOString(),
    amount: input.amount,
    currency,
    transaction_type: input.transaction_type,
    merchant_name: input.merchant_name?.trim() || null,
    comment: input.comment?.trim() || null,
    line_items: serializeLines(input.line_items ?? []),
  };
  const timeZone = resolveSpendDraftTimeZone(options?.timeZone);

  return {
    ok: true,
    draft: {
      mode: "create",
      person_id: person.id,
      person_name: person.name,
      transaction_id: null,
      account_label: account.account_label,
      posted_at_label: russianDateTime(normalized.posted_at, timeZone),
      amount_label: formatMoneyAmount(normalized.amount, currency),
      type_label: TYPE_LABELS[normalized.transaction_type],
      merchant_name: normalized.merchant_name ?? null,
      comment: normalized.comment ?? null,
      lines: buildLinesView(lines, currency, names),
      changes: [],
      input: normalized,
    },
  };
}

export async function buildEditSpendDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: SpendEditInput,
  options?: SpendDraftBuildOptions,
): Promise<{ ok: true; draft: SpendDraftView } | { ok: false; error: string }> {
  const { data: existing, error } = await supabase
    .from("money_transactions")
    .select(
      "id, payer_person_id, account_id, posted_at, amount, currency, transaction_type, merchant_name, comment",
    )
    .eq("id", input.transaction_id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!existing) return { ok: false, error: `No transaction ${input.transaction_id}.` };
  if (existing.payer_person_id !== person.id) {
    return { ok: false, error: "That transaction belongs to a different person." };
  }

  const accountId = input.account_id ?? existing.account_id;
  const account = await resolveAccount(supabase, person.id, accountId);
  if ("error" in account) return { ok: false, error: account.error };

  const amount = input.amount ?? Number(existing.amount);
  if (!Number.isFinite(amount)) return { ok: false, error: "amount must be a finite number." };
  const postedAt = input.posted_at ? new Date(input.posted_at) : new Date(existing.posted_at);
  if (Number.isNaN(postedAt.getTime())) {
    return { ok: false, error: "posted_at must be an ISO datetime." };
  }
  const currency = (input.currency ?? existing.currency).trim() || account.currency;
  const transactionType = (input.transaction_type ??
    existing.transaction_type) as MoneyTransactionType;
  const merchant =
    input.merchant_name !== undefined
      ? input.merchant_name?.trim() || null
      : existing.merchant_name;
  const comment =
    input.comment !== undefined ? input.comment?.trim() || null : (existing.comment ?? null);

  let lineSource = input.line_items;
  if (!lineSource) {
    const { data: rows, error: lineError } = await supabase
      .from("money_line_items")
      .select(EXISTING_LINE_SELECT)
      .eq("transaction_id", existing.id);
    if (lineError) return { ok: false, error: lineError.message };
    lineSource = (rows ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      amount: Number(row.amount),
      quantity: row.quantity,
      unit: row.unit,
      line_status: row.line_status as MoneyLineStatus,
      related_line_item_id: row.related_line_item_id,
      category_id: row.category_id,
      beneficiary_person_id: row.beneficiary_person_id,
      assignment_method: row.assignment_method as MoneyAssignmentMethod,
      assignment_rule_id: row.assignment_rule_id,
      assignment_confidence: row.assignment_confidence,
      category_locked_by_user: row.category_locked_by_user ?? false,
      last_category_rule_id: row.last_category_rule_id,
      last_category_rule_run_id: row.last_category_rule_run_id,
      category_assigned_at: row.category_assigned_at,
    }));
  }

  const unknown = await unknownCategoryIds(supabase, lineSource);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown category id(s): ${unknown.join(", ")}. Call list_money_categories.`,
    };
  }

  const lines = toLineInputs(lineSource, merchant, amount);
  const names = await categoryNameMap(supabase);
  const normalized: SpendEditInput = {
    transaction_id: existing.id,
    account_id: accountId,
    posted_at: postedAt.toISOString(),
    amount,
    currency,
    transaction_type: transactionType,
    merchant_name: merchant,
    comment,
    line_items: serializeLines(lineSource),
  };

  const timeZone = resolveSpendDraftTimeZone(options?.timeZone);
  const changes: string[] = [];
  if (accountId !== existing.account_id) {
    changes.push(`счёт → ${account.account_label}`);
  }
  if (postedAt.toISOString() !== new Date(existing.posted_at).toISOString()) {
    changes.push(`дата → ${russianDateTime(normalized.posted_at!, timeZone)}`);
  }
  if (amount !== Number(existing.amount) || currency !== existing.currency) {
    changes.push(`сумма → ${formatMoneyAmount(amount, currency)}`);
  }
  if (transactionType !== existing.transaction_type) {
    changes.push(`тип → ${TYPE_LABELS[transactionType]}`);
  }
  if ((merchant ?? null) !== (existing.merchant_name ?? null)) {
    changes.push(`мерчант → ${merchant ?? "(нет)"}`);
  }
  if ((comment ?? null) !== (existing.comment ?? null)) {
    changes.push(`комментарий → ${comment ?? "(нет)"}`);
  }
  if (input.line_items) {
    changes.push(`строки: ${lines.length} (заданы в предложении)`);
  }

  return {
    ok: true,
    draft: {
      mode: "edit",
      person_id: person.id,
      person_name: person.name,
      transaction_id: existing.id,
      account_label: account.account_label,
      posted_at_label: russianDateTime(normalized.posted_at!, timeZone),
      amount_label: formatMoneyAmount(amount, currency),
      type_label: TYPE_LABELS[transactionType],
      merchant_name: merchant,
      comment,
      lines: buildLinesView(lines, currency, names),
      changes,
      input: normalized,
    },
  };
}

export async function applySpendDraft(
  supabase: Client,
  person: { id: string; name: string },
  mode: SpendDraftMode,
  input: SpendCreateInput | SpendEditInput,
): Promise<{ ok: true; transaction_id: string; label: string } | { ok: false; error: string }> {
  if (mode === "create") {
    const built = await buildCreateSpendDraft(supabase, person, input as SpendCreateInput);
    if (!built.ok) return built;
    const create = built.draft.input as SpendCreateInput;
    const payload: CreateMoneyTransactionInput = {
      payer_person_id: person.id,
      account_id: create.account_id,
      posted_at: create.posted_at,
      amount: create.amount,
      currency: create.currency,
      transaction_type: create.transaction_type,
      merchant_name: create.merchant_name,
      comment: create.comment,
      source: "manual",
      status: "posted",
    };
    const { data: tx, error } = await supabase
      .from("money_transactions")
      .insert(transactionInsertRow(payload) as MoneyTransactionInsert)
      .select("id, merchant_name")
      .single();
    if (error) return { ok: false, error: error.message };

    const items = toLineInputs(create.line_items, create.merchant_name, create.amount).map(
      (item) => lineItemRow(item, tx.id) as MoneyLineItemInsert,
    );
    const { error: lineError } = await supabase.from("money_line_items").insert(items);
    if (lineError) {
      // Compensating delete: PostgREST has no multi-statement write here; roll back the header so
      // a failed confirm cannot leave a partial spend (or duplicate it on retry).
      await supabase.from("money_transactions").delete().eq("id", tx.id);
      return { ok: false, error: lineError.message };
    }

    return {
      ok: true,
      transaction_id: tx.id,
      label: tx.merchant_name?.trim() || "manual spend",
    };
  }

  const built = await buildEditSpendDraft(supabase, person, input as SpendEditInput);
  if (!built.ok) return built;
  const edit = built.draft.input as SpendEditInput;
  const updates: UpdateMoneyTransactionInput = {
    account_id: edit.account_id,
    posted_at: edit.posted_at,
    amount: edit.amount,
    currency: edit.currency,
    transaction_type: edit.transaction_type,
    merchant_name: edit.merchant_name,
    comment: edit.comment,
  };
  const lines = toLineInputs(edit.line_items, edit.merchant_name, edit.amount ?? 0);
  const { data, error } = await supabase.rpc("money_update_transaction_with_lines", {
    p_transaction_id: edit.transaction_id,
    p_updates: updates as Json,
    p_line_items: lineItemUpdateRows(lines, edit.transaction_id) as Json,
  });
  if (error) return { ok: false, error: error.message };
  const saved = data as unknown as {
    transaction: { id: string; merchant_name: string | null };
  };
  return {
    ok: true,
    transaction_id: saved.transaction.id,
    label: saved.transaction.merchant_name?.trim() || "manual spend",
  };
}

/**
 * Short model-facing lead-in. Figures live in the Markdown preview (and on the card when shown) —
 * this line stays free of amount numbers so ordinary chat prose does not dump them.
 */
export function spendDraftSummaryText(draft: SpendDraftView): string {
  const what = draft.merchant_name ? `"${draft.merchant_name}"` : "a manual spend";
  const action = draft.mode === "create" ? "a create" : "an edit";
  return (
    `Showing ${action} spend draft for ${draft.person_name}: ${what}` +
    ` · ${draft.type_label} · ${draft.posted_at_label} · ${draft.account_label}` +
    (draft.transaction_id ? ` (transaction_id ${draft.transaction_id})` : "") +
    `. Amount and line items are in the Markdown preview below (and on the card when the host shows it).` +
    ` Nothing is saved until the owner confirms. If the interactive card shows, end your turn and wait;` +
    ` if it does not, use the text fallback below.`
  );
}

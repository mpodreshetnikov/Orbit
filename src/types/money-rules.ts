import type {
  MoneyCategory,
  MoneyCategoryRule,
  MoneyCategoryRuleFilter,
  MoneyCategoryRuleFilterOperator,
} from "./money";

/** The category rules as the web pages and the phone read and describe them. */

function normalizeFilters(value: unknown): MoneyCategoryRuleFilter[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MoneyCategoryRuleFilter =>
    Boolean(item && typeof item === "object"),
  );
}

export function rowToMoneyCategoryRule(row: Record<string, unknown>): MoneyCategoryRule {
  return {
    id: String(row.id),
    person_id: String(row.person_id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order ?? 0),
    rule_kind: row.rule_kind as MoneyCategoryRule["rule_kind"],
    target_category_id: (row.target_category_id as string | null) ?? null,
    match_mode: (row.match_mode as MoneyCategoryRule["match_mode"]) ?? "all",
    scope_filter: (row.scope_filter as MoneyCategoryRule["scope_filter"]) ?? "all_line_items",
    filters: normalizeFilters(row.filters),
    config: (row.config as Record<string, unknown> | null) ?? {},
    stop_processing: Boolean(row.stop_processing),
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export const RULE_FILTER_FIELDS: { value: string; labelKey: string; fallbackLabel: string }[] = [
  {
    value: "line_item_title",
    labelKey: "money.ruleFieldLineItemTitle",
    fallbackLabel: "Line-item title",
  },
  {
    value: "merchant_name",
    labelKey: "money.ruleFieldMerchantName",
    fallbackLabel: "Merchant name",
  },
  {
    value: "transaction_comment",
    labelKey: "money.ruleFieldTransactionComment",
    fallbackLabel: "Transaction comment",
  },
  {
    value: "source_comment",
    labelKey: "money.ruleFieldSourceComment",
    fallbackLabel: "Source comment",
  },
  { value: "source", labelKey: "money.ruleFieldSource", fallbackLabel: "Source" },
  {
    value: "source_category_id",
    labelKey: "money.ruleFieldSourceCategoryId",
    fallbackLabel: "Source category id",
  },
  {
    value: "source_category_name",
    labelKey: "money.ruleFieldSourceCategoryName",
    fallbackLabel: "Source category name",
  },
  { value: "mcc", labelKey: "money.ruleFieldMcc", fallbackLabel: "MCC" },
  {
    value: "transaction_type",
    labelKey: "money.ruleFieldTransactionType",
    fallbackLabel: "Transaction type",
  },
  {
    value: "account_source",
    labelKey: "money.ruleFieldAccountSource",
    fallbackLabel: "Account source",
  },
  { value: "account_kind", labelKey: "money.ruleFieldAccountKind", fallbackLabel: "Account kind" },
  {
    value: "payer_person_id",
    labelKey: "money.ruleFieldPayerPerson",
    fallbackLabel: "Payer person",
  },
  {
    value: "line_item_amount",
    labelKey: "money.ruleFieldLineItemAmount",
    fallbackLabel: "Line-item amount",
  },
  {
    value: "transaction_amount",
    labelKey: "money.ruleFieldTransactionAmount",
    fallbackLabel: "Transaction amount",
  },
  {
    value: "current_category_id",
    labelKey: "money.ruleFieldCurrentCategory",
    fallbackLabel: "Current category",
  },
  {
    value: "canonical_branch_system_key",
    labelKey: "money.ruleFieldCanonicalBranch",
    fallbackLabel: "Canonical branch",
  },
  { value: "is_transfer", labelKey: "money.ruleFieldTransferFlag", fallbackLabel: "Transfer flag" },
];

/** The operators a filter is written with; `in_set` is an old name for `equals_any_in_set`. */
export const RULE_FILTER_OPERATORS: {
  value: MoneyCategoryRuleFilterOperator;
  labelKey: string;
  fallbackLabel: string;
}[] = [
  { value: "contains", labelKey: "money.ruleOperatorContains", fallbackLabel: "contains" },
  {
    value: "not_contains",
    labelKey: "money.ruleOperatorNotContains",
    fallbackLabel: "does not contain",
  },
  { value: "equals", labelKey: "money.ruleOperatorEquals", fallbackLabel: "equals" },
  { value: "starts_with", labelKey: "money.ruleOperatorStartsWith", fallbackLabel: "starts with" },
  { value: "regex", labelKey: "money.ruleOperatorRegex", fallbackLabel: "matches regex" },
  {
    value: "contains_any_in_set",
    labelKey: "money.ruleOperatorContainsAnyOfSet",
    fallbackLabel: "contains any of set",
  },
  {
    value: "equals_any_in_set",
    labelKey: "money.ruleOperatorEqualsAnyOfSet",
    fallbackLabel: "equals any of set",
  },
  { value: "range", labelKey: "money.ruleOperatorRange", fallbackLabel: "is between" },
  { value: "is_empty", labelKey: "money.ruleOperatorIsEmpty", fallbackLabel: "is empty" },
  {
    value: "is_not_empty",
    labelKey: "money.ruleOperatorIsNotEmpty",
    fallbackLabel: "is not empty",
  },
];

const SET_OPERATORS = new Set(["contains_any_in_set", "equals_any_in_set", "in_set"]);

/** "Food / Еда (food)": a category as the rules name it. */
export function ruleCategoryLabel(category: MoneyCategory): string {
  const systemKey = category.system_key ? ` (${category.system_key})` : "";
  return `${category.name_en} / ${category.name_ru}${systemKey}`;
}

/** A rule's filters in one line, joined by "and" or "or" as it matches. */
export function ruleSummary(
  rule: MoneyCategoryRule,
  t: (key: string) => string,
  categoryNameById: Map<string, string>,
): string {
  if (!rule.filters.length) return t("money.ruleSummaryNoFilters");
  const label = (option: { labelKey: string; fallbackLabel: string }) => {
    const translated = t(option.labelKey);
    return translated === option.labelKey ? option.fallbackLabel : translated;
  };
  const fields = new Map(RULE_FILTER_FIELDS.map((option) => [option.value, label(option)]));
  const operators = new Map(RULE_FILTER_OPERATORS.map((option) => [option.value, label(option)]));
  operators.set("in_set", operators.get("equals_any_in_set")!);

  const parts = rule.filters.map((filter) => {
    const field = fields.get(filter.field) ?? filter.field;
    const operator = operators.get(filter.operator) ?? filter.operator;
    if (filter.operator === "range") {
      return `${field} ${operator} ${filter.min ?? "..."} - ${filter.max ?? "..."}`;
    }
    if (SET_OPERATORS.has(filter.operator)) {
      return `${field} ${operator} ${(filter.values ?? []).map((value) => `'${value}'`).join(", ")}`;
    }
    if (filter.operator === "is_empty" || filter.operator === "is_not_empty") {
      return `${field} ${operator}`;
    }
    if (filter.field === "current_category_id" && typeof filter.value === "string") {
      return `${field} ${operator} '${categoryNameById.get(filter.value) ?? filter.value}'`;
    }
    return `${field} ${operator} '${String(filter.value ?? "")}'`;
  });
  const joiner = rule.match_mode === "all" ? t("money.ruleSummaryAnd") : t("money.ruleSummaryOr");
  return parts.join(` ${joiner} `);
}

/** The rules' ids with `id` moved one place up or down, or null when it cannot move that way. */
export function movedRuleIds(
  rules: { id: string }[],
  id: string,
  direction: "up" | "down",
): string[] | null {
  const from = rules.findIndex((rule) => rule.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= rules.length) return null;
  const ids = rules.map((rule) => rule.id);
  ids.splice(to, 0, ...ids.splice(from, 1));
  return ids;
}

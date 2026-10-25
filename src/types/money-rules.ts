import type {
  CreateMoneyCategoryRuleInput,
  MoneyCategory,
  MoneyCategoryRule,
  MoneyCategoryRuleFilter,
  MoneyCategoryRuleFilterOperator,
  MoneyCategoryRuleKind,
  MoneyCategoryRuleMatchMode,
  MoneyCategoryRuleScopeFilter,
  UpdateMoneyCategoryRuleInput,
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

/** The rule editor's form, as typed: what the web editor and the phone's both hold. */

export interface RuleFilterDraft {
  id: string;
  field: string;
  operator: MoneyCategoryRuleFilterOperator;
  value: string;
  values: string;
  min: string;
  max: string;
}

export interface RuleForm {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  ruleKind: MoneyCategoryRuleKind;
  targetCategoryId: string;
  matchMode: MoneyCategoryRuleMatchMode;
  scopeFilter: MoneyCategoryRuleScopeFilter;
  stopProcessing: boolean;
  prompt: string;
  fallbackSystemKey: string;
  filters: RuleFilterDraft[];
}

function normalizeDraftOperator(
  operator: MoneyCategoryRuleFilterOperator | undefined,
): MoneyCategoryRuleFilterOperator {
  if (operator === "in_set") return "equals_any_in_set";
  return operator ?? "contains";
}

function buildDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ruleFilterDraft(seed: Partial<RuleFilterDraft> = {}): RuleFilterDraft {
  return {
    id: seed.id ?? buildDraftId(),
    field: seed.field ?? "merchant_name",
    operator: normalizeDraftOperator(seed.operator),
    value: seed.value ?? "",
    values: seed.values ?? "",
    min: seed.min ?? "",
    max: seed.max ?? "",
  };
}

export function ruleFilterDrafts(filters: MoneyCategoryRuleFilter[]): RuleFilterDraft[] {
  return filters.map((filter) =>
    ruleFilterDraft({
      field: filter.field,
      operator: filter.operator,
      value: filter.value == null ? "" : String(filter.value),
      values: Array.isArray(filter.values) ? filter.values.join(", ") : "",
      min: filter.min == null ? "" : String(filter.min),
      max: filter.max == null ? "" : String(filter.max),
    }),
  );
}

export function ruleFiltersOf(filters: RuleFilterDraft[]): MoneyCategoryRuleFilter[] {
  return filters.reduce<MoneyCategoryRuleFilter[]>((accumulator, filter) => {
    const normalizedField = filter.field.trim();
    if (!normalizedField) return accumulator;

    const normalized: MoneyCategoryRuleFilter = {
      field: normalizedField,
      operator: filter.operator,
    };

    if (filter.operator === "contains_any_in_set" || filter.operator === "equals_any_in_set") {
      const values = filter.values
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length > 0) normalized.values = values;
    } else if (filter.operator === "range") {
      normalized.min = filter.min.trim() ? Number(filter.min) : null;
      normalized.max = filter.max.trim() ? Number(filter.max) : null;
    } else if (filter.operator !== "is_empty" && filter.operator !== "is_not_empty") {
      normalized.value = filter.value.trim();
    }

    accumulator.push(normalized);
    return accumulator;
  }, []);
}

export function emptyRuleForm(): RuleForm {
  return {
    id: null,
    name: "",
    description: "",
    enabled: true,
    ruleKind: "direct",
    targetCategoryId: "",
    matchMode: "all",
    scopeFilter: "all_line_items",
    stopProcessing: false,
    prompt: "",
    fallbackSystemKey: "uncategorized",
    filters: [],
  };
}

export function ruleFormOf(rule: MoneyCategoryRule): RuleForm {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    enabled: rule.enabled,
    ruleKind: rule.rule_kind,
    targetCategoryId: rule.target_category_id ?? "",
    matchMode: rule.match_mode,
    scopeFilter: rule.scope_filter,
    stopProcessing: rule.stop_processing,
    prompt: typeof rule.config.prompt === "string" ? rule.config.prompt : "",
    fallbackSystemKey:
      typeof rule.config.target_system_key === "string"
        ? rule.config.target_system_key
        : "uncategorized",
    filters: ruleFilterDrafts(rule.filters),
  };
}

export function rulePayload(
  selectedPersonId: string,
  form: RuleForm,
  rules: MoneyCategoryRule[],
): CreateMoneyCategoryRuleInput | UpdateMoneyCategoryRuleInput {
  const config: Record<string, unknown> = {};

  if (form.ruleKind === "llm_categorization" && form.prompt.trim()) {
    config.prompt = form.prompt.trim();
  }

  if (form.ruleKind === "fallback_uncategorized") {
    config.target_system_key = form.fallbackSystemKey.trim() || "uncategorized";
  }

  const sharedFields = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    enabled: form.enabled,
    rule_kind: form.ruleKind,
    target_category_id: form.ruleKind === "direct" ? form.targetCategoryId || null : null,
    match_mode: form.matchMode,
    scope_filter: form.scopeFilter,
    filters: ruleFiltersOf(form.filters),
    config,
    stop_processing: form.stopProcessing,
  };

  if (form.id) {
    return sharedFields;
  }

  return {
    person_id: selectedPersonId,
    sort_order: rules.length + 1,
    ...sharedFields,
  };
}

export function ruleNumberInput(value: string): string {
  let normalized = value.replace(/[^\d.-]/g, "");
  normalized = normalized.replace(/(?!^)-/g, "");

  const dotIndex = normalized.indexOf(".");
  if (dotIndex !== -1) {
    normalized =
      normalized.slice(0, dotIndex + 1) + normalized.slice(dotIndex + 1).replace(/[.]/g, "");
  }

  return normalized;
}

export function isSmartRuleKind(kind: MoneyCategoryRuleKind) {
  return kind !== "direct" && kind !== "fallback_uncategorized";
}

/** Why the rule cannot be saved as it is: no name, a direct rule with no category, or a broken regex. */
export function ruleFormProblem(form: RuleForm): "name" | "target" | "regex" | null {
  if (!form.name.trim()) return "name";
  if (form.ruleKind === "direct" && !form.targetCategoryId) return "target";
  for (const filter of form.filters) {
    if (filter.operator !== "regex" || !filter.value.trim()) continue;
    try {
      void new RegExp(filter.value);
    } catch {
      return "regex";
    }
  }
  return null;
}

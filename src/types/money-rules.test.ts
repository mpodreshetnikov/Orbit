import { describe, expect, it } from "vitest";
import type { MoneyCategory, MoneyCategoryRule } from "./money";
import {
  emptyRuleForm,
  isSmartRuleKind,
  movedRuleIds,
  rowToMoneyCategoryRule,
  ruleCategoryLabel,
  ruleFilterDraft,
  ruleFormOf,
  ruleFormProblem,
  ruleNumberInput,
  rulePayload,
  ruleSummary,
} from "./money-rules";

const t = (key: string) =>
  ({
    "money.ruleSummaryAnd": "и",
    "money.ruleSummaryOr": "или",
    "money.ruleOperatorEquals": "равно",
  })[key] ?? key;

const rule = (changes: Partial<MoneyCategoryRule>) =>
  ({ filters: [], match_mode: "all", ...changes }) as MoneyCategoryRule;

describe("rowToMoneyCategoryRule", () => {
  it("fills what a row leaves out", () => {
    expect(
      rowToMoneyCategoryRule({ id: 1, person_id: "p", filters: [null, { field: "mcc" }] }),
    ).toMatchObject({
      id: "1",
      name: "",
      description: null,
      enabled: false,
      sort_order: 0,
      match_mode: "all",
      scope_filter: "all_line_items",
      filters: [{ field: "mcc" }],
      config: {},
      created_at: "",
    });
    expect(rowToMoneyCategoryRule({ id: 1, filters: "x" }).filters).toEqual([]);
  });
});

describe("ruleSummary", () => {
  const names = new Map([["cat", "Food / Еда"]]);

  it("says when there are no filters", () => {
    expect(ruleSummary(rule({}), t, names)).toBe("money.ruleSummaryNoFilters");
  });

  it("reads each kind of filter, joined as the rule matches", () => {
    const filters: MoneyCategoryRule["filters"] = [
      { field: "line_item_amount", operator: "range", min: 1, max: null },
      { field: "merchant_name", operator: "in_set", values: ["a", "b"] },
      { field: "mcc", operator: "is_empty" },
      { field: "current_category_id", operator: "equals", value: "cat" },
      { field: "custom", operator: "equals", value: null },
    ];
    expect(ruleSummary(rule({ filters }), t, names)).toBe(
      "Line-item amount is between 1 - ... и Merchant name equals any of set 'a', 'b' и MCC is empty и Current category равно 'Food / Еда' и custom равно ''",
    );
    expect(
      ruleSummary(
        rule({
          match_mode: "any",
          filters: [filters[2], { field: "mcc", operator: "contains", value: 5 }],
        }),
        t,
        names,
      ),
    ).toBe("MCC is empty или MCC contains '5'");
  });
});

describe("ruleCategoryLabel", () => {
  it("names both languages and the system key", () => {
    const category = { name_en: "Food", name_ru: "Еда", system_key: "food" } as MoneyCategory;
    expect(ruleCategoryLabel(category)).toBe("Food / Еда (food)");
    expect(ruleCategoryLabel({ ...category, system_key: null })).toBe("Food / Еда");
  });
});

describe("movedRuleIds", () => {
  const rules = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("moves a rule one place, but not past either end", () => {
    expect(movedRuleIds(rules, "b", "up")).toEqual(["b", "a", "c"]);
    expect(movedRuleIds(rules, "b", "down")).toEqual(["a", "c", "b"]);
    expect(movedRuleIds(rules, "a", "up")).toBeNull();
    expect(movedRuleIds(rules, "c", "down")).toBeNull();
    expect(movedRuleIds(rules, "x", "down")).toBeNull();
  });
});

describe("the rule form", () => {
  const saved = rule({
    id: "r1",
    person_id: "p",
    name: "Кофе",
    description: null,
    enabled: true,
    rule_kind: "direct",
    target_category_id: "cat",
    scope_filter: "all_line_items",
    stop_processing: false,
    config: {},
    filters: [
      { field: "merchant_name", operator: "in_set", values: ["a", "b"] },
      { field: "line_item_amount", operator: "range", min: 1, max: null },
      { field: "mcc", operator: "equals", value: 5411 },
    ],
  });

  it("reads a rule back, with old set operators renamed", () => {
    const form = ruleFormOf(saved);
    expect(form).toMatchObject({ id: "r1", name: "Кофе", targetCategoryId: "cat", prompt: "" });
    expect(form.fallbackSystemKey).toBe("uncategorized");
    expect(form.filters.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        field: "merchant_name",
        operator: "equals_any_in_set",
        value: "",
        values: "a, b",
        min: "",
        max: "",
      },
      { field: "line_item_amount", operator: "range", value: "", values: "", min: "1", max: "" },
      { field: "mcc", operator: "equals", value: "5411", values: "", min: "", max: "" },
    ]);
    expect(
      ruleFormOf({ ...saved, config: { prompt: "Еда?", target_system_key: "other" } }),
    ).toMatchObject({ prompt: "Еда?", fallbackSystemKey: "other" });
  });

  it("writes a new rule at the end of the order, with only what its kind uses", () => {
    const form = {
      ...emptyRuleForm(),
      name: " Кофе ",
      description: " ",
      ruleKind: "llm_categorization" as const,
      targetCategoryId: "cat",
      prompt: " Еда? ",
      filters: [
        ruleFilterDraft({ field: " ", value: "x" }),
        ruleFilterDraft({ operator: "contains_any_in_set", values: "a, ,b" }),
        ruleFilterDraft({ operator: "contains_any_in_set", values: " " }),
        ruleFilterDraft({ field: "line_item_amount", operator: "range", min: "1", max: "" }),
        ruleFilterDraft({ operator: "is_empty", value: "x" }),
        ruleFilterDraft({ value: " Coffee " }),
      ],
    };
    expect(rulePayload("p", form, [saved])).toEqual({
      person_id: "p",
      sort_order: 2,
      name: "Кофе",
      description: null,
      enabled: true,
      rule_kind: "llm_categorization",
      target_category_id: null,
      match_mode: "all",
      scope_filter: "all_line_items",
      filters: [
        { field: "merchant_name", operator: "contains_any_in_set", values: ["a", "b"] },
        { field: "merchant_name", operator: "contains_any_in_set" },
        { field: "line_item_amount", operator: "range", min: 1, max: null },
        { field: "merchant_name", operator: "is_empty" },
        { field: "merchant_name", operator: "contains", value: "Coffee" },
      ],
      config: { prompt: "Еда?" },
      stop_processing: false,
    });
    expect(
      rulePayload(
        "p",
        { ...form, id: "r1", ruleKind: "fallback_uncategorized", fallbackSystemKey: " " },
        [],
      ),
    ).not.toHaveProperty("person_id");
    expect(
      rulePayload("p", { ...form, ruleKind: "fallback_uncategorized", fallbackSystemKey: " " }, [])
        .config,
    ).toEqual({ target_system_key: "uncategorized" });
    expect(
      rulePayload("p", { ...form, ruleKind: "direct", targetCategoryId: "cat" }, [])
        .target_category_id,
    ).toBe("cat");
  });

  it("names what stops a save", () => {
    const form = { ...emptyRuleForm(), name: "Кофе", targetCategoryId: "cat" };
    expect(ruleFormProblem(form)).toBeNull();
    expect(ruleFormProblem({ ...form, name: " " })).toBe("name");
    expect(ruleFormProblem({ ...form, targetCategoryId: "" })).toBe("target");
    expect(
      ruleFormProblem({ ...form, filters: [ruleFilterDraft({ operator: "regex", value: "(" })] }),
    ).toBe("regex");
    expect(
      ruleFormProblem({ ...form, filters: [ruleFilterDraft({ operator: "regex", value: "a+" })] }),
    ).toBeNull();
  });

  it("keeps a number field to one sign and one point, and tells smart kinds apart", () => {
    expect(ruleNumberInput("1-2.3.4 ₽")).toBe("12.34");
    expect(ruleNumberInput("-5")).toBe("-5");
    expect(isSmartRuleKind("mcc_map")).toBe(true);
    expect(isSmartRuleKind("direct")).toBe(false);
  });
});

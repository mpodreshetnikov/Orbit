import { describe, expect, it } from "vitest";
import type { MoneyCategory, MoneyCategoryRule } from "./money";
import {
  movedRuleIds,
  ruleCategoryLabel,
  rowToMoneyCategoryRule,
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

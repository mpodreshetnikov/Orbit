import { describe, expect, it } from "vitest";
import type { MoneyCategory } from "./money";
import {
  canonicalCategoryOptions,
  categoryColumns,
  categoryFormOf,
  categoryHasChildren,
  childCategoryForm,
  EMPTY_CATEGORY_FORM,
  parentCategoryOptions,
} from "./money-categories";

const category = (id: string, changes: Partial<MoneyCategory> = {}): MoneyCategory =>
  ({
    id,
    parent_id: null,
    canonical_category_id: "food",
    category_kind: "custom",
    sort_order: 0,
    depth: 1,
    name_en: id,
    name_ru: id,
    slug: id,
    ...changes,
  }) as MoneyCategory;

const FOOD = category("food", { category_kind: "canonical", sort_order: 2, depth: 0 });
const HOME = category("home", { category_kind: "canonical", sort_order: 1, depth: 0 });
const CAFE = category("cafe");
const COFFEE = category("coffee", { parent_id: "cafe", depth: 2 });
const DEEP = category("deep", { parent_id: "coffee", depth: 4 });
const ALL = [FOOD, HOME, CAFE, COFFEE, DEEP];

describe("childCategoryForm", () => {
  it("starts a child under a canonical branch or a custom parent, but not past the depth limit", () => {
    expect(childCategoryForm(FOOD)).toEqual({ ...EMPTY_CATEGORY_FORM, canonicalId: "food" });
    expect(childCategoryForm(CAFE)).toEqual({
      ...EMPTY_CATEGORY_FORM,
      canonicalId: "food",
      parentId: "cafe",
    });
    expect(childCategoryForm(DEEP)).toBeNull();
  });
});

describe("the dialog's options", () => {
  it("lists canonical branches in order, and the parents a category can take", () => {
    expect(canonicalCategoryOptions(ALL).map((one) => one.id)).toEqual(["home", "food"]);
    expect(parentCategoryOptions(ALL, "food").map((one) => one.id)).toEqual(["cafe", "coffee"]);
    expect(parentCategoryOptions(ALL, "food", "cafe").map((one) => one.id)).toEqual(["coffee"]);
    expect(parentCategoryOptions(ALL, null)).toEqual([]);
  });

  it("knows a category with children", () => {
    expect(categoryHasChildren(ALL, "cafe")).toBe(true);
    expect(categoryHasChildren(ALL, "deep")).toBe(false);
  });
});

describe("categoryColumns", () => {
  const form = { nameEn: " Bakery ", nameRu: " Пекарня ", slug: " bakery ", canonicalId: "food" };

  it("trims the names and works out the depth under the parent", () => {
    expect(categoryColumns(ALL, { ...form, parentId: "coffee" })).toEqual({
      columns: {
        parent_id: "coffee",
        canonical_category_id: "food",
        depth: 3,
        name_en: "Bakery",
        name_ru: "Пекарня",
        slug: "bakery",
      },
    });
    expect(categoryColumns(ALL, { ...form, parentId: null })).toMatchObject({
      columns: { parent_id: null, depth: 1 },
    });
  });

  it("drops a parent from another branch, and refuses an empty field or too deep a branch", () => {
    expect(categoryColumns(ALL, { ...form, canonicalId: "home", parentId: "cafe" })).toMatchObject({
      columns: { parent_id: null, canonical_category_id: "home" },
    });
    expect(categoryColumns(ALL, { ...form, parentId: null, slug: " " })).toEqual({
      problem: "required",
    });
    expect(categoryColumns(ALL, { ...form, canonicalId: "cafe", parentId: null })).toEqual({
      problem: "required",
    });
    expect(categoryColumns(ALL, { ...form, parentId: "deep" })).toEqual({ problem: "depth" });
  });

  it("reads an existing category back into the dialog", () => {
    expect(categoryFormOf(COFFEE)).toEqual({
      nameEn: "coffee",
      nameRu: "coffee",
      slug: "coffee",
      canonicalId: "food",
      parentId: "cafe",
    });
  });
});

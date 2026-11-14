import { describe, expect, it } from "vitest";
import { matchTextFilter, normalizeComparableText } from "./rule-filter-text";

describe("normalizeComparableText", () => {
  it("returns null for nullish, blank, and whitespace-only values", () => {
    expect(normalizeComparableText(null)).toBeNull();
    expect(normalizeComparableText(undefined)).toBeNull();
    expect(normalizeComparableText("")).toBeNull();
    expect(normalizeComparableText("   \n\t  ")).toBeNull();
  });

  it("lowercases, collapses whitespace, and trims", () => {
    expect(normalizeComparableText("  Café  MILK ")).toBe("café milk");
    expect(normalizeComparableText("A\t\tB")).toBe("a b");
  });
});

describe("matchTextFilter operators", () => {
  it("contains requires both sides and substring membership", () => {
    expect(matchTextFilter("contains", "Hello World", "WORLD")).toBe(true);
    expect(matchTextFilter("contains", "Hello", "xyz")).toBe(false);
    expect(matchTextFilter("contains", null, "x")).toBe(false);
    expect(matchTextFilter("contains", "x", null)).toBe(false);
    expect(matchTextFilter("contains", "  ", "x")).toBe(false);
  });

  it("not_contains is true when either side is empty or the needle is absent", () => {
    expect(matchTextFilter("not_contains", "Hello", "xyz")).toBe(true);
    expect(matchTextFilter("not_contains", "Hello World", "WORLD")).toBe(false);
    expect(matchTextFilter("not_contains", null, "x")).toBe(true);
    expect(matchTextFilter("not_contains", "x", null)).toBe(true);
    expect(matchTextFilter("not_contains", "", "")).toBe(true);
  });

  it("equals requires both sides and exact normalized equality", () => {
    expect(matchTextFilter("equals", "  Foo ", "foo")).toBe(true);
    expect(matchTextFilter("equals", "foo", "bar")).toBe(false);
    expect(matchTextFilter("equals", null, "foo")).toBe(false);
    expect(matchTextFilter("equals", "foo", null)).toBe(false);
    expect(matchTextFilter("equals", null, null)).toBe(false);
    expect(matchTextFilter("equals", "  ", "  ")).toBe(false);
    // Must not fall through to starts_with (prefix match ≠ equality).
    expect(matchTextFilter("equals", "hello world", "hello")).toBe(false);
  });

  it("starts_with requires both sides and a true prefix", () => {
    expect(matchTextFilter("starts_with", "Hello World", "hello")).toBe(true);
    expect(matchTextFilter("starts_with", "Hello World", "world")).toBe(false);
    expect(matchTextFilter("starts_with", "Hello", "hello world")).toBe(false);
    expect(matchTextFilter("starts_with", null, "h")).toBe(false);
    expect(matchTextFilter("starts_with", "h", null)).toBe(false);
  });

  it("contains_any_in_set matches any normalized set member as a substring", () => {
    expect(matchTextFilter("contains_any_in_set", "buy milk now", null, ["EGGS", "MILK"])).toBe(
      true,
    );
    expect(matchTextFilter("contains_any_in_set", "buy milk now", null, ["EGGS"])).toBe(false);
    expect(matchTextFilter("contains_any_in_set", null, null, ["milk"])).toBe(false);
    expect(matchTextFilter("contains_any_in_set", "milk", null, ["  ", ""])).toBe(false);
    expect(matchTextFilter("contains_any_in_set", "milk", null, undefined)).toBe(false);
  });

  it("equals_any_in_set requires exact membership in the normalized set", () => {
    expect(matchTextFilter("equals_any_in_set", " Milk ", null, ["milk", "eggs"])).toBe(true);
    expect(matchTextFilter("equals_any_in_set", "buy milk", null, ["milk"])).toBe(false);
    expect(matchTextFilter("equals_any_in_set", null, null, ["milk"])).toBe(false);
    expect(matchTextFilter("equals_any_in_set", "milk", null, [])).toBe(false);
    expect(matchTextFilter("equals_any_in_set", "stryker was here", null, undefined)).toBe(false);
    expect(matchTextFilter("equals_any_in_set", "stryker was here", null, [])).toBe(false);
    expect(matchTextFilter("equals_any_in_set", null, null, undefined)).toBe(false);
    // Blank set entries must be dropped, not kept as null members.
    expect(matchTextFilter("equals_any_in_set", "milk", null, ["", "  ", "milk"])).toBe(true);
    expect(matchTextFilter("equals_any_in_set", null, null, ["", "x"])).toBe(false);
    expect(matchTextFilter("contains_any_in_set", "ab", null, ["", "  "])).toBe(false);
  });

  it("is_empty / is_not_empty track normalized null", () => {
    expect(matchTextFilter("is_empty", null, null)).toBe(true);
    expect(matchTextFilter("is_empty", "  ", null)).toBe(true);
    expect(matchTextFilter("is_empty", "x", null)).toBe(false);
    expect(matchTextFilter("is_not_empty", "x", null)).toBe(true);
    expect(matchTextFilter("is_not_empty", null, null)).toBe(false);
    expect(matchTextFilter("is_not_empty", "\t", null)).toBe(false);
  });
});

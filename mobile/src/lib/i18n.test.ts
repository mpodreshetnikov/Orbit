import { describe, expect, it } from "vitest";
import { formatMessage, pluralCategory, t } from "@/lib/i18n";

describe("pluralCategory", () => {
  it("follows Russian's one / few / many", () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111].map(pluralCategory)).toEqual([
      "one",
      "few",
      "many",
      "many",
      "one",
      "few",
      "many",
      "many",
    ]);
  });

  it("puts a fraction in other, as CLDR does", () => {
    expect(pluralCategory(1.5)).toBe("other");
  });
});

describe("formatMessage", () => {
  it("fills placeholders and leaves unknown ones as written", () => {
    expect(formatMessage("Приёмы на {date} {who}", { date: "21 октября" })).toBe(
      "Приёмы на 21 октября {who}",
    );
  });

  it("picks the plural branch for the count and substitutes #", () => {
    const message = "{count, plural, one {# таблетка} few {# таблетки} other {# таблеток}}";
    expect(formatMessage(message, { count: 1 })).toBe("1 таблетка");
    expect(formatMessage(message, { count: 3 })).toBe("3 таблетки");
    expect(formatMessage(message, { count: 7 })).toBe("7 таблеток");
  });

  it("prefers an exact =N branch", () => {
    expect(formatMessage("{n, plural, =0 {ничего} other {#}}", { n: 0 })).toBe("ничего");
  });
});

describe("t", () => {
  it("reads the web app's Russian catalogue", () => {
    expect(t("medications.taken")).toBe("Принято");
    expect(t("medications.unitPill", { count: 2 })).toBe("таблетки");
  });

  it("prints a missing key as itself", () => {
    expect(t("medications.noSuchKey")).toBe("medications.noSuchKey");
  });
});

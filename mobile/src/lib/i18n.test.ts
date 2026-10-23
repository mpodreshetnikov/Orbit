import { describe, expect, it } from "@jest/globals";
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

describe("without Intl.PluralRules", () => {
  it("falls back to Russian's own rule", () => {
    const original = Intl.PluralRules;
    // Hermes builds without Intl exist; the fallback is what they get.
    (Intl as unknown as { PluralRules: unknown }).PluralRules = undefined;
    try {
      expect([1, 3, 11, 12, 22, 25, 101, 1.5].map(pluralCategory)).toEqual([
        "one",
        "few",
        "many",
        "many",
        "few",
        "many",
        "one",
        "other",
      ]);
    } finally {
      (Intl as unknown as { PluralRules: unknown }).PluralRules = original;
    }
  });
});

describe("formatMessage, the edges", () => {
  it("leaves a plural as written when its value is not a number or no branch fits", () => {
    const message = "{n, plural, one {#}}";
    expect(formatMessage(message, { n: "x" })).toBe(message);
    expect(formatMessage(message, { n: 5 })).toBe(message);
  });

  it("does not descend into a key that ends at a string", () => {
    expect(t("medications.taken.deeper")).toBe("medications.taken.deeper");
  });
});

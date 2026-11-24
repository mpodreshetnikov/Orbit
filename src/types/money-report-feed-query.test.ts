import { describe, expect, it } from "vitest";
import { transactionsFeedQuery } from "@/types/money-report-feed-query";

describe("transactionsFeedQuery", () => {
  it("builds a shareable transactions feed query from report filters", () => {
    expect(
      transactionsFeedQuery({
        start: "2026-11-01",
        end: "2026-11-16",
        accountIds: ["acc-1", "acc-2"],
        categoryId: "cat-food",
        merchantName: "Pyaterochka",
        mode: "expense",
      }),
    ).toBe(
      "preset=custom&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-16T23%3A59%3A59.999Z&accounts=acc-1%2Cacc-2&categories=cat-food&q=Pyaterochka&sign=expense",
    );
  });

  it("omits optional filters, empty accounts, and non expense/income modes", () => {
    expect(
      transactionsFeedQuery({
        start: "2026-11-01",
        end: "2026-11-02",
        accountIds: [],
        mode: "income",
      }),
    ).toBe(
      "preset=custom&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T23%3A59%3A59.999Z&sign=income",
    );
    expect(
      transactionsFeedQuery({
        start: "2026-11-01",
        end: "2026-11-02",
      }),
    ).toBe("preset=custom&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T23%3A59%3A59.999Z");
    expect(
      transactionsFeedQuery({
        start: "2026-01-01",
        end: "2026-01-02",
        accountIds: [],
        categoryId: null,
        merchantName: null,
        mode: "net" as never,
      }),
    ).toBe("preset=custom&from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-02T23%3A59%3A59.999Z");
  });

  it("keeps a single account id and category-only / merchant-only filters", () => {
    expect(
      transactionsFeedQuery({
        start: "2026-02-01",
        end: "2026-02-02",
        accountIds: ["only"],
      }),
    ).toContain("accounts=only");
    expect(
      transactionsFeedQuery({
        start: "2026-02-01",
        end: "2026-02-02",
        categoryId: "c1",
      }),
    ).toContain("categories=c1");
    expect(
      transactionsFeedQuery({
        start: "2026-02-01",
        end: "2026-02-02",
        merchantName: "Shop",
      }),
    ).toContain("q=Shop");
  });
});

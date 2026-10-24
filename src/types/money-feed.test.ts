import { describe, expect, it } from "vitest";
import {
  feedSummaryOf,
  formatMoney,
  moneyFeedArgs,
  normalizeFeedItem,
  preferredComment,
} from "./money-feed";

describe("moneyFeedArgs", () => {
  it("sends nulls for filters left empty and the defaults for the rest", () => {
    expect(moneyFeedArgs("p", { query: "  ", accountIds: [] })).toEqual({
      p_payer_person_id: "p",
      p_search: null,
      p_account_ids: null,
      p_transaction_types: null,
      p_statuses: null,
      p_category_ids: null,
      p_transfer_filter: "all",
      p_amount_sign: "all",
      p_from: null,
      p_to: null,
    });
    expect(
      moneyFeedArgs("p", { query: " кофе ", categoryIds: ["c"], amountSign: "expense" }),
    ).toMatchObject({ p_search: "кофе", p_category_ids: ["c"], p_amount_sign: "expense" });
  });
});

describe("normalizeFeedItem", () => {
  it("takes the titles from the line items and builds the card from flat columns", () => {
    const item = normalizeFeedItem({
      id: "t",
      line_items: [{ title: "Хлеб" }, { title: 5 }],
      card_last4: "1234",
    });
    expect(item.line_item_titles).toEqual(["Хлеб"]);
    expect(item.money_cards).toEqual({ id: "", last4: "1234", card_label: null });
    expect(item.category_ids).toEqual([]);
  });

  it("keeps given titles and cards, and leaves the card out when there is none", () => {
    const item = normalizeFeedItem({
      line_item_titles: ["A"],
      money_cards: null,
      category_ids: ["c"],
    });
    expect(item).toMatchObject({ line_item_titles: ["A"], money_cards: null, category_ids: ["c"] });
    expect("money_cards" in normalizeFeedItem({})).toBe(false);
  });
});

describe("feedSummaryOf", () => {
  it("reads each currency's row as numbers and counts them all", () => {
    expect(
      feedSummaryOf([
        { currency: "RUB", total_count: "2", total_positive_amount: 5, total_negative_amount: -1 },
        {
          currency: "USD",
          total_count: 1,
          total_positive_amount: "0",
          total_negative_amount: "-12.5",
        },
      ]),
    ).toEqual({
      totalCount: 3,
      byCurrency: [
        { currency: "RUB", count: 2, positiveAmount: 5, negativeAmount: -1 },
        { currency: "USD", count: 1, positiveAmount: 0, negativeAmount: -12.5 },
      ],
    });
  });

  it("reads nothing as no currencies", () => {
    expect(feedSummaryOf(null)).toEqual({ totalCount: 0, byCurrency: [] });
    expect(feedSummaryOf([])).toEqual({ totalCount: 0, byCurrency: [] });
  });
});

describe("preferredComment", () => {
  it("prefers the person's comment, then the bank's", () => {
    expect(preferredComment(" Мой ", "Банк")).toBe("Мой");
    expect(preferredComment(" ", " Банк ")).toBe("Банк");
    expect(preferredComment(null, undefined)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats in the currency, and falls back for one Intl does not know", () => {
    expect(formatMoney(12.5, "usd", "en-US")).toBe("$12.50");
    expect(formatMoney(Number.NaN, "", "en-US")).toMatch(/^RUB\s0\.00$/);
    expect(formatMoney(1, "NOT-A-CODE", "en-US")).toBe("1.00 NOT-A-CODE");
  });
});

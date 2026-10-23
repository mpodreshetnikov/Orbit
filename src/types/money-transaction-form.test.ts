import { describe, expect, it } from "vitest";
import type { MoneyLineItem } from "./money";
import {
  parseAmount,
  lineItemChanges,
  lineItemDraft,
  lineItemDrafts,
  lineItemInputs,
  lineItemRow,
  lineItemsMismatch,
  lineItemsOrWhole,
  lineItemsTotal,
  manualCategoryChange,
  merchantNames,
  transactionFormProblem,
  transactionInsertRow,
  withMerchantCategory,
} from "./money-transaction-form";

const SAVED = {
  id: "li-1",
  transaction_id: "tx",
  title: "Хлеб",
  amount: -50,
  quantity: 2,
  unit: "шт",
  line_status: "final",
  related_line_item_id: null,
  category_id: "food",
  beneficiary_person_id: "p",
  assignment_method: "rule",
  assignment_rule_id: "r",
  assignment_confidence: 0.9,
  raw_payload: null,
  created_at: "",
  updated_at: "",
} as MoneyLineItem;

describe("line item drafts", () => {
  it("open on the saved items, or on one blank item, each with its own key", () => {
    const [draft] = lineItemDrafts([SAVED]);
    expect(draft).toMatchObject({ id: "li-1", amount: "-50", quantity: "2", unit: "шт" });
    expect(draft.category_locked_by_user).toBe(false);
    expect(lineItemDrafts([{ ...SAVED, quantity: null, unit: null }])[0]).toMatchObject({
      quantity: "",
      unit: "",
    });
    const [blank] = lineItemDrafts(null);
    expect(blank.title).toBe("");
    expect(lineItemDraft().key).not.toBe(blank.key);
  });

  it("lock a category picked by hand, and free one cleared", () => {
    const draft = lineItemDraft({ assignment_method: "rule", assignment_rule_id: "r" });
    const now = new Date("2026-10-22T10:00:00Z");
    expect(manualCategoryChange(draft, "food", now)).toMatchObject({
      category_id: "food",
      category_locked_by_user: true,
      assignment_method: "manual",
      assignment_rule_id: null,
      category_assigned_at: "2026-10-22T10:00:00.000Z",
    });
    expect(manualCategoryChange(draft, null, now)).toMatchObject({
      category_locked_by_user: false,
      category_assigned_at: null,
    });
  });

  it("take the merchant's category only where none is set or locked", () => {
    const items = [
      lineItemDraft(),
      lineItemDraft({ category_id: "x" }),
      lineItemDraft({ category_locked_by_user: true }),
    ];
    expect(withMerchantCategory(items, "food").map((item) => item.category_id)).toEqual([
      "food",
      "x",
      null,
    ]);
    expect(withMerchantCategory(items, null)).toBe(items);
  });

  it("sum, and say when the sum is not the amount to the cent", () => {
    const items = [
      lineItemDraft({ amount: "0.1" }),
      lineItemDraft({ amount: "0.2" }),
      lineItemDraft(),
    ];
    expect(lineItemsTotal(items)).toBeCloseTo(0.3);
    expect(lineItemsMismatch("0.3", items)).toBe(false);
    expect(lineItemsMismatch("x", items)).toBe(true);
  });

  it("are saved without the blank ones, titled after the merchant when untitled", () => {
    const inputs = lineItemInputs(
      [
        lineItemDraft(),
        lineItemDraft({ amount: "-5", quantity: "x", unit: " " }),
        lineItemDraft({ title: " Хлеб " }),
      ],
      " Пятёрочка ",
    );
    expect(inputs.map((item) => [item.title, item.amount, item.quantity, item.unit])).toEqual([
      ["Пятёрочка", -5, null, null],
      ["Хлеб", 0, null, null],
    ]);
    expect(lineItemInputs([lineItemDraft({ amount: "1" })], "")[0].title).toBe("Manual item");
  });
});

describe("transactionFormProblem", () => {
  it("asks for an account, a time and an amount, in that order", () => {
    expect(transactionFormProblem({ accountId: "", postedAt: "", amount: "" })).toBe(
      "money.validationAccountRequired",
    );
    expect(transactionFormProblem({ accountId: "a", postedAt: "", amount: "" })).toBe(
      "money.validationPostedAtRequired",
    );
    expect(transactionFormProblem({ accountId: "a", postedAt: "t", amount: "-" })).toBe(
      "money.validationAmountRequired",
    );
    expect(transactionFormProblem({ accountId: "a", postedAt: "t", amount: "-1" })).toBeNull();
  });
});

describe("the rows written", () => {
  it("fill a new transaction's defaults", () => {
    expect(
      transactionInsertRow({
        payer_person_id: "p",
        account_id: "a",
        posted_at: "t",
        amount: -1,
        currency: "RUB",
        transaction_type: "expense",
      }),
    ).toMatchObject({
      source: "manual",
      status: "posted",
      merchant_name: null,
      is_transfer: false,
    });
  });

  it("fill a line item's defaults", () => {
    expect(lineItemRow({ title: "A", amount: 1 }, "tx")).toMatchObject({
      transaction_id: "tx",
      line_status: "final",
      assignment_method: "manual",
      category_locked_by_user: false,
      quantity: null,
    });
  });

  it("write one line item for the whole amount when there are none", () => {
    expect(lineItemsOrWhole([], " Кафе ", -300)).toEqual([
      { title: "Кафе", amount: -300, line_status: "final", assignment_method: "manual" },
    ]);
    expect(lineItemsOrWhole([], null, 1)[0].title).toBe("Manual item");
    const items = [{ title: "A", amount: 1 }];
    expect(lineItemsOrWhole(items, "x", 1)).toBe(items);
  });

  it("tell removed, changed and added line items apart", () => {
    const changes = lineItemChanges(
      ["a", "b"],
      [
        { id: "a", title: "A", amount: 1 },
        { id: "z", title: "Z", amount: 1 },
        { title: "N", amount: 1 },
      ],
    );
    expect(changes.removed).toEqual(["b"]);
    expect(changes.changed.map((item) => item.id)).toEqual(["a"]);
    expect(changes.added.map((item) => item.title)).toEqual(["Z", "N"]);
  });
});

describe("merchantNames", () => {
  it("lists each named merchant once, sorted", () => {
    expect(
      merchantNames([
        { merchant_name: "Б" },
        { merchant_name: " " },
        { merchant_name: null },
        { merchant_name: "А" },
        { merchant_name: "Б" },
      ]),
    ).toEqual(["А", "Б"]);
  });
});

describe("parseAmount", () => {
  it("reads a decimal comma or point, signs and grouped digits", () => {
    expect(parseAmount("-420,50")).toBe(-420.5);
    expect(parseAmount("1 234.5")).toBe(1234.5);
    expect(parseAmount("+7")).toBe(7);
    expect(parseAmount(".5")).toBe(0.5);
  });

  it("refuses text that is not a whole number, instead of cutting it short", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("12abc")).toBeNaN();
    expect(parseAmount("1,2,3")).toBeNaN();
  });
});

import { describe, expect, it } from "vitest";
import type { MoneyCard } from "./money";
import { accountColumns, cardLast4, cardsByAccount, EMPTY_ACCOUNT_FORM } from "./money-accounts";

describe("accountColumns", () => {
  it("needs a name, and trims what is typed", () => {
    expect(accountColumns(EMPTY_ACCOUNT_FORM)).toBeNull();
    expect(
      accountColumns({
        ...EMPTY_ACCOUNT_FORM,
        label: " Тинькофф ",
        source: " ",
        externalId: " 42 ",
      }),
    ).toEqual({
      account_label: "Тинькофф",
      account_kind: "card",
      currency: "RUB",
      source: "manual",
      external_account_id: "42",
      is_active: true,
    });
    expect(accountColumns({ ...EMPTY_ACCOUNT_FORM, label: "A" })?.external_account_id).toBeNull();
  });
});

describe("cardLast4", () => {
  it("keeps the last four digits", () => {
    expect(cardLast4("**** 1234 5678")).toBe("5678");
    expect(cardLast4("абв")).toBe("");
  });
});

describe("cardsByAccount", () => {
  it("groups the cards by account", () => {
    const card = (id: string, account_id: string) => ({ id, account_id }) as MoneyCard;
    expect(cardsByAccount([card("1", "a"), card("2", "b"), card("3", "a")])).toEqual({
      a: [card("1", "a"), card("3", "a")],
      b: [card("2", "b")],
    });
  });
});

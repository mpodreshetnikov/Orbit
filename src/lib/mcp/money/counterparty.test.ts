import { describe, expect, it } from "vitest";
import { describeCounterparty, sanitizeBankOperation } from "./counterparty";

/** An incoming phone transfer as the T-Bank connector stores it (see tbank-web.test.ts). */
const incomingTransfer = {
  connector_source: "tbank_web",
  operation: {
    id: "incoming-transfer",
    type: "Credit",
    amount: { value: 10000, currency: { strCode: "RUB" } },
    description: "Максим П.",
    cardNumber: "220070******1778",
    subgroup: { name: "Пополнение по номеру телефона" },
    categoryInfo: { bankCategory: { name: "Переводы" } },
    payment: {
      fieldsValues: {
        bankMemberName: "Сбербанк",
        pointer: "+79991234567",
        // An internal transfer names its destination contract here (T-Bank snapshot shape).
        bankContract: "5140123456",
      },
    },
  },
};

describe("describeCounterparty", () => {
  it("names the sender, channel and bank of an incoming transfer", () => {
    expect(
      describeCounterparty({
        amount: 10000,
        is_transfer: true,
        merchant_name: "Максим П.",
        raw_payload: incomingTransfer,
      }),
    ).toEqual({
      direction: "from",
      name: "Максим П.",
      channel: "Пополнение по номеру телефона",
      bank: "Сбербанк",
    });
  });

  it("prefers the bank's senderDetails over the description for money in", () => {
    const payload = {
      operation: { ...incomingTransfer.operation, senderDetails: "Иванов Иван Иванович" },
    };
    expect(
      describeCounterparty({
        amount: 500,
        is_transfer: true,
        merchant_name: null,
        raw_payload: payload,
      }).name,
    ).toBe("Иванов Иван Иванович");
  });

  it("names the merchant of a card purchase and reads no bank out of its category", () => {
    const payload = {
      operation: {
        description: "PYATEROCHKA 2041",
        merchant: { name: "Пятёрочка" },
        categoryInfo: { bankCategory: { name: "Супермаркеты" } },
      },
    };
    expect(
      describeCounterparty({
        amount: -845.3,
        is_transfer: false,
        merchant_name: "PYATEROCHKA 2041",
        raw_payload: payload,
      }),
    ).toEqual({ direction: "to", name: "Пятёрочка", channel: null, bank: null });
  });

  it("falls back to the merchant name for a manual row with no payload", () => {
    expect(
      describeCounterparty({
        amount: -100,
        is_transfer: false,
        merchant_name: "Рынок",
        raw_payload: null,
      }),
    ).toEqual({ direction: "to", name: "Рынок", channel: null, bank: null });
  });
});

describe("sanitizeBankOperation", () => {
  it("drops card numbers, phones and presentation, keeps the rest", () => {
    const cleaned = sanitizeBankOperation({
      operation: { ...incomingTransfer.operation, icon: "https://x/icon.png" },
    });

    expect(JSON.stringify(cleaned)).not.toContain("220070");
    expect(JSON.stringify(cleaned)).not.toContain("+7999");
    expect(JSON.stringify(cleaned)).not.toContain("5140123456");
    expect(cleaned).not.toHaveProperty("icon");
    expect(cleaned).toMatchObject({
      description: "Максим П.",
      subgroup: { name: "Пополнение по номеру телефона" },
      payment: { fieldsValues: { bankMemberName: "Сбербанк" } },
    });
  });

  it("returns null when the row has no bank operation", () => {
    expect(sanitizeBankOperation(null)).toBeNull();
    expect(sanitizeBankOperation({ connector_source: "manual" })).toBeNull();
  });
});

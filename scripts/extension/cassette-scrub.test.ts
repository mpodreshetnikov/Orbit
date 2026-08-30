import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  findCassetteLeaks,
  REDACTED,
  scrubCassette,
  scrubCassetteValue,
  scrubFreeText,
  scrubUrl,
  type CassetteEntry,
} from "./cassette-scrub";

/**
 * A cassette is recorded against a real signed-in account, so this suite is the gate between
 * "it worked on my machine" and "it is in the repository". Every shape below is one the raw
 * recording actually contains.
 */
const RAW_ENTRIES: CassetteEntry[] = [
  {
    url: "https://www.tbank.ru/api/common/v1/operations?sessionid=abc123SECRET&start=1&end=2",
    status: 200,
    headers: {
      Authorization: "Bearer live-token-value",
      "Set-Cookie": "psid=live-cookie-value; Path=/",
      "Content-Type": "application/json",
    },
    body: {
      payload: [
        {
          id: "op-1",
          description: "Пятёрочка",
          accountAmount: { value: 1234.5, currency: { strCode: "RUB" } },
          cardNumber: "5536913812345678",
          panMasked: "553691******5678",
          account: { accountId: "20817810000000012345", number: "40817810099910004312" },
          clientName: "Иванов Иван Иванович",
          cardHolder: "IVAN IVANOV",
          receiptUrl:
            "https://www.tbank.ru/api/common/v1/shopping_receipt?operationId=op-1&sessionid=abc123SECRET",
          comment: "Перевод на счёт 40817810099910004312",
        },
      ],
    },
  },
];

describe("cassette scrubbing", () => {
  it("removes the session id from a url", () => {
    expect(scrubUrl(RAW_ENTRIES[0].url)).toBe(
      `https://www.tbank.ru/api/common/v1/operations?sessionid=${REDACTED}&start=1&end=2`,
    );
  });

  it("removes a session id embedded in free text", () => {
    expect(scrubFreeText("see ?sessionid=abc123SECRET now")).toBe(`see ?sessionid=${REDACTED} now`);
  });

  it("removes every identifying shape from a recorded payload", () => {
    const [scrubbed] = scrubCassette(RAW_ENTRIES);
    const serialized = JSON.stringify(scrubbed);

    for (const secret of [
      "abc123SECRET",
      "live-token-value",
      "live-cookie-value",
      "5536913812345678",
      "20817810000000012345",
      "40817810099910004312",
      "Иванов Иван Иванович",
      "IVAN IVANOV",
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("keeps what the replay and contract tests assert on", () => {
    const [scrubbed] = scrubCassette(RAW_ENTRIES);
    const operation = (scrubbed.body as { payload: Array<Record<string, unknown>> }).payload[0];

    expect(operation.id).toBe("op-1");
    expect(operation.description).toBe("Пятёрочка");
    expect(operation.accountAmount).toEqual({ value: 1234.5, currency: { strCode: "RUB" } });
  });

  it("leaves an ordinary value alone", () => {
    expect(scrubCassetteValue({ amount: 320, title: "Latte" })).toEqual({
      amount: 320,
      title: "Latte",
    });
  });

  it("reports what a scrubbed cassette still leaks", () => {
    expect(findCassetteLeaks(JSON.stringify(scrubCassette(RAW_ENTRIES)))).toEqual([]);
    expect(findCassetteLeaks('{"url":"?sessionid=live"}')).toHaveLength(1);
    expect(findCassetteLeaks('{"pan":"5536913812345678"}')).toHaveLength(1);
  });

  it("keeps the URL parts the replay matches on", () => {
    // Blanking these does not protect anyone and does break the cassette: `operationId` is what
    // the player keys a receipt by, so a numeric one redacted merges every receipt into one
    // entry and the replay answers each request with the first receipt.
    const scrubbed = scrubUrl(
      "https://www.tbank.ru/api/common/v1/shopping_receipt" +
        "?operationId=1787227199000123&sessionid=live&start=1787227199000&end=1787313599000",
    );

    expect(scrubbed).toContain("operationId=1787227199000123");
    expect(scrubbed).toContain("start=1787227199000");
    expect(scrubbed).toContain("end=1787313599000");
    expect(scrubbed).toContain(`sessionid=${REDACTED}`);
    expect(findCassetteLeaks(JSON.stringify({ url: scrubbed }))).toEqual([]);
  });

  it("still scrubs a long digit run in any other query parameter", () => {
    const scrubbed = scrubUrl("https://www.tbank.ru/api/common/v1/operations?pan=5536913812345678");

    expect(scrubbed).toContain(`pan=${REDACTED}`);
    expect(scrubbed).not.toContain("5536913812345678");
  });

  it("redacts the identifying fields a live recording proved it was missing", () => {
    // Each of these survived the scrubber when it was run over a real recording: `bankAccountId`
    // carries the same value as `account` under a name no rule covered, and the sender fields
    // identify the other party to a transfer. All are far too short for the long-digit rule.
    const scrubbed = scrubCassetteValue({
      bankAccountId: "5351691778",
      senderAgreement: "5695232671",
      senderDetails: "Иван И.",
      // A transfer's own nested fields: the counterparty's contract and the recipient's phone.
      fieldsValues: { bankContract: "5351691778", pointer: "79001234567" },
      // The seller's own details stay: a receipt carries the shop, not the buyer, and the tests
      // assert on merchant identity. Twelve distinct values across fifty receipts said as much.
      user: 'ООО "ПЯТЁРОЧКА"',
      userInn: "7825706086",
    });

    expect(scrubbed).toEqual({
      bankAccountId: REDACTED,
      senderAgreement: REDACTED,
      senderDetails: REDACTED,
      fieldsValues: { bankContract: REDACTED, pointer: REDACTED },
      user: 'ООО "ПЯТЁРОЧКА"',
      userInn: "7825706086",
    });
  });

  it("keeps only what the connector reads out of a receipt", () => {
    // Default-deny, like the form-field bag and for the same reason: four rounds each added the
    // field that round's leak was in, and the next round found the next field. `items` is the one
    // field the connector reads; `user` and `userInn` stay by decision, being the seller — a legal
    // entity whose name and tax number are public. `somethingTheBankAddsNext` stands for the field
    // nobody has thought of, which is the one that has leaked every time.
    const scrubbed = scrubCassetteValue({
      payload: {
        receipt: {
          items: [
            { name: "АТАРАКС 25МГ. №25 ТАБ.", price: 45000, sum: 45000, quantity: 1, good_id: 12 },
            { name: "Молоко", price: 9900, sum: 9900, quantity: 1, good_id: 34 },
          ],
          user: 'ООО "ПЯТЁРОЧКА"',
          userInn: "7825706086",
          retailPlaceAddress: "109316, Москва, Волгоградский проспект, 42, к 9",
          retailPlace: "Аптека №1",
          region: "77",
          totalSum: 54900,
          somethingTheBankAddsNext: "whatever it turns out to be",
        },
      },
    });

    expect(scrubbed).toEqual({
      payload: {
        receipt: {
          items: [
            { name: "Позиция 1", price: 45000, sum: 45000, quantity: 1, good_id: REDACTED },
            { name: "Позиция 2", price: 9900, sum: 9900, quantity: 1, good_id: REDACTED },
          ],
          user: 'ООО "ПЯТЁРОЧКА"',
          userInn: "7825706086",
          retailPlaceAddress: REDACTED,
          retailPlace: REDACTED,
          region: REDACTED,
          totalSum: REDACTED,
          somethingTheBankAddsNext: REDACTED,
        },
      },
    });
  });

  it("redacts a scalar inside a default-denied array", () => {
    // Carrying the context into the array was not enough: a scalar element never reaches the
    // object walk where default-deny is enforced — it returns from the string branch. So the key
    // was denied, the array inherited the denial, and every string in it quietly ignored both.
    const scrubbed = scrubCassetteValue({
      fieldsValues: {
        aliases: ["Тестовая П.", "short-id"],
        pointerType: "PHONE",
        nested: [{ message: "тоже нет" }],
      },
      payload: { receipt: { items: [{ name: "Молоко", sum: 1 }], tags: ["Аптека №1"] } },
    });

    expect(scrubbed).toEqual({
      fieldsValues: {
        aliases: [REDACTED, REDACTED],
        // A kept key is still kept — the denial applies to what the bag does not name.
        pointerType: "PHONE",
        nested: [{ message: REDACTED }],
      },
      payload: {
        receipt: { items: [{ name: "Позиция 1", sum: 1 }], tags: [REDACTED] },
      },
    });
  });

  it("redacts the till and the shop the bank numbers", () => {
    // Eight digits each, so no pattern rule sees them, and nothing in the connector reads either.
    // Against the timestamps and amounts already in the file they are a stable key for "which
    // terminal in which branch" — the location trail that redacting the address removed.
    expect(scrubCassetteValue({ posId: "41952009", pointOfSaleId: "41405565" })).toEqual({
      posId: REDACTED,
      pointOfSaleId: REDACTED,
    });
  });

  it("reports a postal address the field rules did not catch", () => {
    // The structural rule above removes these from a receipt. This is for the address that turns
    // up somewhere the walk does not cover, which is how every previous round went. The report
    // deliberately does not quote the match: printing the address would put it in the log.
    expect(
      findCassetteLeaks('{"somewhereElse":"109316, Москва, Волгоградский проспект, 42"}'),
    ).toEqual(['postal address under "somewhereElse"']);
    // An ordinary number next to the serializer's indentation is not an address.
    expect(findCassetteLeaks('{\n  "pointOfSaleId": 123456,\n  "amount": 12\n}')).toEqual([]);
  });

  it("names the field a suspect run came from", () => {
    // "long digit run: 7384440901188332" cannot be acted on. The first real recording produced
    // twenty-five of those and nothing to say where they were.
    expect(findCassetteLeaks('{"mystery":"7384440901188332"}')).toEqual([
      'long digit run under "mystery": 7384440901188332',
    ]);
  });

  it("reports one identifier once, however often it repeats", () => {
    const repeated = JSON.stringify({
      a: { mystery: "7384440901188332" },
      b: { mystery: "7384440901188332" },
    });

    expect(findCassetteLeaks(repeated)).toHaveLength(1);
  });

  it("clears the bank's own operation references", () => {
    // T-Bank operation ids are fifteen and sixteen digits, so treating every long run as an
    // account number blocks every real recording. These keys are references the bank generated;
    // the fields that actually carry money are redacted by name long before this scan.
    expect(findCassetteLeaks('{"authorizationId":"7384440901188332"}')).toEqual([]);
    expect(findCassetteLeaks('{"operationId":{"value":"7384440901188332"}}')).toEqual([]);
    // `id` was withheld until a live recording showed what it holds: ten values of the form
    // 200000000416948, matching the captured snapshot. It is also the field the replay keys an
    // operation by, so blanking it merges operations.
    expect(findCassetteLeaks('{"id":"200000000416948"}')).toEqual([]);
    // Anything else long is still reported, with its field named.
    expect(findCassetteLeaks('{"mystery":"5536913812345678"}')).toEqual([
      'long digit run under "mystery": 5536913812345678',
    ]);
  });

  it("does not mistake an operation timestamp for an account number", () => {
    // Every real recording carries `operationTime.milliseconds`, so a scan that called thirteen
    // digits a leak on sight would fail on the first genuine cassette and stay failing.
    expect(findCassetteLeaks('{"operationTime":{"milliseconds":1787227199000}}')).toEqual([]);
    // The exemption is the field, not the value. An account number that happens to read as a
    // date before 2100 is still reported, wherever it turns up.
    expect(findCassetteLeaks('{"unknownField":4000000000006}')).toHaveLength(1);
    expect(findCassetteLeaks('{"milliseconds":"4000000000006"}')).toHaveLength(1);
    expect(findCassetteLeaks('{"pan":"4276123456789"}')).toHaveLength(1);
    expect(findCassetteLeaks('{"pan":"17872271990000"}')).toHaveLength(1);
    // A longer run beginning where a timestamp would is not one.
    expect(findCassetteLeaks('{"milliseconds":17872271990001}')).toHaveLength(1);
  });

  it("reports a phone number the field rules did not catch", () => {
    // The delivered recording that prompted this carried thirteen counterparty numbers under
    // `pointer`, a transfer field added to the scrubber minutes after that snippet was built —
    // and the scan called the file clean, because eleven digits is two short of a long run. The
    // field list will always lag some field; this is what stops the lag reaching the repository.
    expect(findCassetteLeaks('{"mystery":"+79535912902"}')).toEqual([
      'phone number under "mystery": +79535912902',
    ]);
    expect(findCassetteLeaks('{"mystery":"79535912902"}')).toEqual([
      'phone number under "mystery": 79535912902',
    ]);
    // A reference the cassette keeps deliberately is exempt, exactly as it is for a long run:
    // eleven digits starting with a 7 is not a phone number when the bank generated it, and a
    // leak the recorder cannot clear blocks a download nobody can unblock.
    expect(findCassetteLeaks('{"id":"79535912902"}')).toEqual([]);
    // Eleven digits inside something longer belong to that something.
    expect(findCassetteLeaks('{"operationTime":{"milliseconds":1787227199000}}')).toEqual([]);
  });

  it("keeps the merchant but not the counterparty on the same field", () => {
    // The bank puts the same text in `description`, `subcategory` and `merchantKey`, and what
    // it means depends entirely on the group: under PAY it is a shop, under TRANSFER it is a
    // person. Redacting the field outright would take the merchant names the mapper and the
    // contract test are built on; redacting nothing left fourteen people's names in a file
    // that was about to be committed.
    expect(
      scrubCassetteValue({
        group: "PAY",
        description: "Ave Bistro & Gelato",
        subcategory: "kannam",
        merchantKey: "Ave Bistro & Gelato",
      }),
    ).toEqual({
      group: "PAY",
      description: "Ave Bistro & Gelato",
      subcategory: "kannam",
      merchantKey: "Ave Bistro & Gelato",
    });

    expect(
      scrubCassetteValue({
        group: "TRANSFER",
        description: "Тестовая П.",
        subcategory: "Тестовая П.",
        merchantKey: "Тестовая П.",
        maskedFIO: "Тестовая П.",
      }),
    ).toEqual({
      group: "TRANSFER",
      description: REDACTED,
      subcategory: REDACTED,
      merchantKey: REDACTED,
      maskedFIO: REDACTED,
    });

    // INCOME too: where it is not a person's name outright it is the employer and the salary
    // line, which is no less identifying.
    expect(
      scrubCassetteValue({ group: "INCOME", description: 'Пополнение. Аванс. ООО "ТЦР"' }),
    ).toEqual({ group: "INCOME", description: REDACTED });
  });

  it("removes a masked name from a field nobody named", () => {
    // The group rule covers the operations list. The same name comes back in the detail
    // response under `merchantKey` and inside `{ type: "Description", value: … }`, where no
    // group is in sight — and the next response shape will put it somewhere else again.
    expect(scrubCassetteValue({ type: "Description", value: "Тестовая П." })).toEqual({
      type: "Description",
      value: REDACTED,
    });
    expect(scrubCassetteValue({ mystery: "Testcase L." })).toEqual({ mystery: REDACTED });
    // A merchant is not a masked name, whatever field it is in.
    expect(scrubCassetteValue({ mystery: "Ave Bistro & Gelato" })).toEqual({
      mystery: "Ave Bistro & Gelato",
    });
  });

  it("reports a masked name the field rules did not catch", () => {
    expect(findCassetteLeaks('{"mystery":"Тестовая П."}')).toEqual([
      "masked person name: Тестовая П.",
    ]);
    expect(findCassetteLeaks('{"description":"Ave Bistro & Gelato"}')).toEqual([]);
  });

  it("removes an order reference but keeps what the purchase was for", () => {
    // The committed recording carried two UUIDs and four numeric order references, none of them
    // long enough for the digit rule — and each one ties the public cassette to a customer's
    // order in the merchant's own records. The words around the reference are merchant text the
    // mapper and the contract tests are built on, so only the reference goes.
    expect(scrubFreeText("Оплата заказа №a71787b8-5aaf-4cbc-9f47-68f162763215")).toBe(
      `Оплата заказа №${REDACTED}`,
    );
    expect(scrubFreeText("Билет в кино. Заказ №1225713")).toBe(`Билет в кино. Заказ №${REDACTED}`);
    expect(scrubFreeText("Пятёрочка")).toBe("Пятёрочка");
  });

  it("reports a uuid a field rule did not catch", () => {
    expect(findCassetteLeaks('{"mystery":"a71787b8-5aaf-4cbc-9f47-68f162763215"}')).toEqual([
      "uuid: a71787b8-5aaf-4cbc-9f47-68f162763215",
    ]);
  });

  it("keeps redacting inside an array in the payment form-field bag", () => {
    // The bag's default-deny has to survive the array. Dropping the context one level down
    // returns objects inside an array-valued field to allow-by-default, which is the hole the
    // rule was added to close.
    expect(
      scrubCassetteValue({
        payment: {
          fieldsValues: {
            workflowType: "SBPTransfer",
            recipients: [{ pointer: "+79535912902", unknownFutureField: "5351691778" }],
          },
        },
      }),
    ).toEqual({
      payment: {
        fieldsValues: {
          workflowType: "SBPTransfer",
          recipients: [{ pointer: REDACTED, unknownFutureField: REDACTED }],
        },
      },
    });
  });

  it("removes a phone number from free text", () => {
    expect(scrubFreeText("перевод на +79535912902")).toBe(`перевод на ${REDACTED}`);
    // Not a bite out of the middle of a card number: that whole run goes as one.
    expect(scrubFreeText("4276123456789012")).toBe(REDACTED);
  });

  it("finds no secrets in any committed cassette", () => {
    // Second line of defence: the scrubber knowing about a field is not the same as the
    // field being gone from the files that are actually in the repository.
    const cassettesRoot = path.resolve(__dirname, "..", "..", "test/fixtures/tbank/cassettes");
    if (!fs.existsSync(cassettesRoot)) return;

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(cassettesRoot);

    // Cassettes only. The README beside them documents what the scan catches, and any honest
    // example of a masked name is itself a masked name — scanning the prose makes documenting
    // the rule impossible. Nothing the recorder writes is ever anything but `.json`.
    for (const file of files.filter((candidate) => candidate.endsWith(".json"))) {
      const leaks = findCassetteLeaks(fs.readFileSync(file, "utf8"));
      expect(leaks, `${file}: ${leaks.join(", ")}`).toEqual([]);
    }
  });
});

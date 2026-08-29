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
        description: "Марина М.",
        subcategory: "Марина М.",
        merchantKey: "Марина М.",
        maskedFIO: "Марина М.",
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
    expect(scrubCassetteValue({ type: "Description", value: "Марина М." })).toEqual({
      type: "Description",
      value: REDACTED,
    });
    expect(scrubCassetteValue({ mystery: "Maksim P." })).toEqual({ mystery: REDACTED });
    // A merchant is not a masked name, whatever field it is in.
    expect(scrubCassetteValue({ mystery: "Ave Bistro & Gelato" })).toEqual({
      mystery: "Ave Bistro & Gelato",
    });
  });

  it("reports a masked name the field rules did not catch", () => {
    expect(findCassetteLeaks('{"mystery":"Марина М."}')).toEqual(["masked person name: Марина М."]);
    expect(findCassetteLeaks('{"description":"Ave Bistro & Gelato"}')).toEqual([]);
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

    for (const file of files) {
      const leaks = findCassetteLeaks(fs.readFileSync(file, "utf8"));
      expect(leaks, `${file}: ${leaks.join(", ")}`).toEqual([]);
    }
  });
});

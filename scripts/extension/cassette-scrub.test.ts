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

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  findCassetteLeaks,
  REDACTED,
  scrubCassette,
  scrubCassetteEntry,
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

  it("redacts wuid wherever a URL carries it, not only where the recorder built one", () => {
    // The browser session the recording was made from. Short and alphanumeric, so no pattern rule
    // sees it — and it was being replaced by hand at the single call site that builds a tranche
    // URL, which made the boundary a property of that call site. A cassette handed straight to
    // `scrubCassette`, or any other URL carrying it, kept it.
    expect(
      scrubUrl("https://www.tbank.ru/api/common/v1/tranche_offers?wuid=a1b2c3d4&sessionid=live"),
    ).toBe(
      `https://www.tbank.ru/api/common/v1/tranche_offers?wuid=${REDACTED}&sessionid=${REDACTED}`,
    );
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

  it("denies an operation subtree all the way down, and keeps its structural arrays", () => {
    // Two failures with one cause: the operation list has to allow generic nested names, because
    // a currency's `name` is "RUB" and the reconciliation is built on it. Recursing a *denied*
    // key through that same list therefore allowed it back — `locations: { name: "Home" }` was
    // denied at the top and permitted one level down. Denied now means denied all the way.
    //
    // The other half is the opposite mistake: redacting every scalar in every array under a
    // default-deny context also hit `documents: ["ShoppingReceipt"]`, which is a kept key and the
    // only way replay's `operationHasShoppingReceipt` knows to ask for the receipt at all.
    const scrubbed = scrubCassetteEntry({
      url: "https://www.tbank.ru/api/common/v1/operations?sessionid=live&start=1&end=2",
      status: 200,
      headers: {},
      body: {
        payload: [
          {
            id: "1",
            accountAmount: { value: 1, currency: { name: "RUB" } },
            documents: ["ShoppingReceipt"],
            locations: { name: "Home", city: "Moscow" },
          },
        ],
      },
    });

    const operation = (scrubbed.body as { payload: Record<string, unknown>[] }).payload[0];
    expect(operation.documents).toEqual(["ShoppingReceipt"]);
    expect(operation.locations).toEqual({ name: REDACTED, city: REDACTED });
    expect(operation.accountAmount).toEqual({ value: 1, currency: { name: "RUB" } });
  });

  it("keeps only what the mapper reads out of a merchant", () => {
    // Eleven cities across two months is where the account holder lives and where they travelled.
    // `name`, `mcc` and `id` are read — the merchant text, the classification, and the fallback
    // for the receipt request key — so they stay; the region and anything nested there next do not.
    expect(
      scrubCassetteValue({
        merchant: {
          name: "HELLO COFFEE",
          id: "871000338074",
          mcc: { value: "5812" },
          region: { country: "RUS", city: "KRASNOYARSK" },
          somethingNestedLater: { street: "пр. Мира, 1" },
        },
        additionalInfo: [{ fieldName: "Номер банкомата", fieldValue: "007103" }],
      }),
    ).toEqual({
      merchant: {
        name: "HELLO COFFEE",
        id: "871000338074",
        mcc: { value: "5812" },
        region: { country: REDACTED, city: REDACTED },
        somethingNestedLater: { street: REDACTED },
      },
      // The label is a caption the bank chose; the value is whatever it put there.
      additionalInfo: [{ fieldName: "Номер банкомата", fieldValue: REDACTED }],
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

  it("strips the bank's correlation token but keeps the message", () => {
    // "B86939CMC - Неизвестный тип запроса operation": nine mixed characters that tie the file to
    // a line in the bank's own logs, inside a sentence rather than in a field of its own. The
    // message has to survive — the connector reads `errorMessage` both for the wording that tells
    // it a session is blocked and for the `receipt_message` it stores.
    expect(
      scrubCassetteValue({
        errorMessage: "B86939CMC - Неизвестный тип запроса operation",
        // Letters only. The first version of this rule required a digit everywhere and left 22 of
        // these behind — and the scan shared the test, so it called that clean.
        alsoAnError: { errorMessage: "YJRXLUCNT - Неизвестный тип запроса operation" },
      }),
    ).toEqual({
      errorMessage: `${REDACTED} - Неизвестный тип запроса operation`,
      alsoAnError: { errorMessage: `${REDACTED} - Неизвестный тип запроса operation` },
    });

    // Outside that field the same shape is also a merchant, so only a mixed run goes.
    expect(scrubCassetteValue({ description: "PYATEROCHKA - Москва" })).toEqual({
      description: "PYATEROCHKA - Москва",
    });
    expect(scrubCassetteValue({ description: "B86939CMC - Москва" })).toEqual({
      description: `${REDACTED} - Москва`,
    });
  });

  it("exempts a reference only where it is the replay key", () => {
    // The exemption exists so `buildOperationKey` can still tell two operations apart, and it was
    // granted on the key name alone and then carried into the whole subtree. So a generic nested
    // `id` in any response the open walk reaches turned every string rule off underneath it —
    // and the leak scan, which skips long digit runs under the same key name, agreed.
    expect(scrubCassetteValue({ customer: { id: "123456789012345" } })).toEqual({
      customer: { id: REDACTED },
    });
    expect(scrubCassetteValue({ offers: [{ id: "5536913812345678" }] })).toEqual({
      offers: [{ id: REDACTED }],
    });
    // And it is granted for a string: an object under a key called `id` is an object like any
    // other, not a reference.
    expect(scrubCassetteValue({ id: { phone: "+79535912902" } })).toEqual({
      id: { phone: REDACTED },
    });
  });

  it("keeps a nested name and denies one sitting on the operation", () => {
    // `name` has to be allowed inside an operation — a currency's is "RUB" and the whole
    // reconciliation rests on it — and a flat list could not tell that from a `name` on the
    // operation itself, which nothing reads. An ordinary full name written there passed the
    // walk, the string rules (which only recognise the bank's abbreviated `Given I.` form) and
    // the reviewed-key manifest, which already knows the generic key `name`.
    const scrubbed = scrubCassetteEntry({
      url: "https://www.tbank.ru/api/common/v1/operations",
      status: 200,
      body: {
        payload: [
          {
            id: "1",
            name: "Ivan Ivanov",
            description: "Пятёрочка",
            accountAmount: { value: -100, currency: { name: "RUB", code: 643, strCode: "643" } },
            brand: { name: "Пятёрочка", link: "https://5ka.ru", baseColor: "#fff" },
            categoryInfo: { bankCategory: { id: "7", name: "Супермаркеты" } },
          },
        ],
      },
    });
    const operation = (scrubbed.body as { payload: Array<Record<string, unknown>> }).payload[0];

    expect(operation.name, "a name on the operation itself").toBe(REDACTED);
    expect(operation.accountAmount).toEqual({
      value: -100,
      currency: { name: "RUB", code: 643, strCode: "643" },
    });
    expect(operation.brand).toEqual({
      name: "Пятёрочка",
      link: "https://5ka.ru",
      baseColor: "#fff",
    });
    expect(operation.categoryInfo).toEqual({ bankCategory: { id: "7", name: "Супермаркеты" } });
  });

  it("scrubs a URL whatever the field is called, and rewrites nothing else", () => {
    // The check was `key === "url"`, so a field spelled `URL` fell through to the free-text
    // rules — which strip only the query parameters they name, and `wuid` is not among them. A
    // browser-session `wuid` is short and alphanumeric, so no pattern rule sees it either.
    for (const key of ["url", "URL", "Url", "href", "link"]) {
      expect(scrubCassetteValue({ [key]: "https://www.tbank.ru/x?wuid=abc123&keep=1" })).toEqual({
        [key]: `https://www.tbank.ru/x?wuid=${REDACTED}&keep=1`,
      });
    }
    // And a URL with nothing to redact comes back exactly as it went in. Reparsing normalises —
    // `https://5ka.ru` becomes `https://5ka.ru/` — and a scrubber that rewrites what it did not
    // redact turns every cassette diff into noise.
    expect(scrubUrl("https://5ka.ru")).toBe("https://5ka.ru");
  });

  it("keeps a card hint as a masked last four, and nothing else in the container", () => {
    // `extractCardLast4FromOperation` reads `card.panMasked` and `card.number`. Both were being
    // denied — `card` is allowlisted, so the container survived, and then the flat operation list
    // denied the two names inside it — leaving two of the mapper's four hint candidates dead on
    // replay. Masked rather than preserved: the last four is the whole of what the mapper
    // extracts, and a raw PAN in a public file is not a trade worth making for a fixture.
    const scrubbed = scrubCassetteEntry({
      url: "https://www.tbank.ru/api/common/v1/operations",
      status: 200,
      body: {
        payload: [
          {
            id: "1",
            card: {
              panMasked: "4377 72** **** 7379",
              number: "5536913812345678",
              holder: "IVAN PETROV",
              expiry: "12/28",
            },
          },
          // The same name carrying the account holder's internal reference instead of a
          // container. It is not a hint and nothing reads it.
          { id: "2", card: "151542334" },
        ],
      },
    });
    const [withContainer, withScalar] = (
      scrubbed.body as { payload: Array<Record<string, unknown>> }
    ).payload;

    expect(withContainer.card).toEqual({
      panMasked: "****7379",
      number: "****5678",
      holder: REDACTED,
      expiry: REDACTED,
    });
    expect(withScalar.card).toBe(REDACTED);
  });

  it("keeps an operation's own reference, bare and wrapped", () => {
    const scrubbed = scrubCassetteEntry({
      url: "https://www.tbank.ru/api/common/v1/operations?sessionid=X",
      status: 200,
      body: {
        payload: [
          {
            id: "159872659877000",
            // The wrapped form the bank also uses. It was never actually exempt — the comment
            // said the exemption reached one level down and it did not — so a fifteen-digit
            // value was blanked and every operation carrying no bare `id` would have collapsed
            // to one identity on replay.
            // `merchant` is here on purpose: a default-deny context has to be the *first* thing
            // the walk checks, or a key that diverts into another context on its name alone —
            // `merchant`, `receipt`, `fieldsValues` — escapes the denial it is sitting inside.
            operationId: {
              value: "440372029230111",
              holder: "Иван Петров",
              merchant: { name: "Пятёрочка" },
            },
            authorizationId: "440372029230",
            merchant: { id: "200000000416948", name: "Пятёрочка" },
          },
        ],
      },
    });
    const operation = (scrubbed.body as { payload: Array<Record<string, unknown>> }).payload[0];

    expect(operation.id).toBe("159872659877000");
    expect(operation.operationId).toEqual({
      value: "440372029230111",
      holder: REDACTED,
      merchant: { name: REDACTED },
    });
    expect(operation.authorizationId).toBe("440372029230");
    // The merchant's catalogue key, which `extractSourceBrand` reads as the brand's source key.
    // It identifies Пятёрочка, not a person, so it is exempt by name in the merchant context
    // rather than by having been swept up in a grant that also covered a customer id.
    expect(operation.merchant).toEqual({ id: "200000000416948", name: "Пятёрочка" });
  });

  it("removes a phone or a card written the way a person writes it", () => {
    // Contiguous-digit rules match none of these, and both the scrub and the scan were built on
    // those rules — so a formatted number survived the whole pipeline. A comma, a quote or a dot
    // ends the match, which is what keeps the pattern from running across serialized JSON.
    expect(scrubFreeText("позвонил +7 (953) 591-29-02")).toBe(`позвонил ${REDACTED}`);
    expect(scrubFreeText("7-953-591-29-02")).toBe(REDACTED);
    expect(scrubFreeText("5536 9138 1234 5678")).toBe(REDACTED);
    // Merchant text, a date and an amount are not identifiers.
    expect(scrubFreeText("Пятёрочка 42")).toBe("Пятёрочка 42");
    expect(scrubFreeText("2026-08-30")).toBe("2026-08-30");
    expect(scrubFreeText("1 234.56")).toBe("1 234.56");
  });

  it("reports a formatted number the field rules did not catch", () => {
    expect(findCassetteLeaks('{"note":"+7 (953) 591-29-02"}')).toEqual([
      'separated phone number under "note": +7 (953) 591-29-02',
    ]);
    // The contiguous rules already report an unseparated run; this pair does not repeat them.
    expect(findCassetteLeaks('{"mystery":"7384440901188332"}')).toEqual([
      'long digit run under "mystery": 7384440901188332',
    ]);
  });

  it("reports a correlation token the field rules did not catch", () => {
    expect(findCassetteLeaks('{"somewhereElse":"B86939CMC - Неизвестный тип"}')).toEqual([
      'correlation token under "somewhereElse": B86939CMC',
    ]);
    // A word is not a token outside `errorMessage`; the replacement is not one anywhere.
    expect(findCassetteLeaks('{"description":"PYATEROCHKA - Москва"}')).toEqual([]);
    expect(findCassetteLeaks(`{"errorMessage":"${REDACTED} - Неизвестный тип"}`)).toEqual([]);
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

  it("finds no key in a committed cassette that nobody has reviewed", () => {
    // The mechanism, as distinct from the rules.
    //
    // Every rule in this file was added after a review round found the field it covers, and the
    // next round found the next field — seven times. The rules are shape- and allowlist-based now,
    // so an unknown field is redacted rather than shipped, but nothing yet made an unknown field
    // *visible*. This does: the set of keys that may appear in a committed cassette is written
    // down, and a key outside it fails here.
    //
    // What that buys is a person looking. When the bank adds a field, or a recording covers an
    // endpoint the last one did not, this goes red and someone has to decide what the field is
    // before adding it to the list. That is the step that was missing every one of those seven
    // times. Adding a key is a one-line diff in `known-keys.json` and it shows up in review.
    const cassettesRoot = path.resolve(__dirname, "..", "..", "test/fixtures/tbank/cassettes");
    const manifestPath = path.join(cassettesRoot, "known-keys.json");
    // No fixtures at all is a state the suite reports elsewhere, and there is genuinely nothing
    // to review. A *missing manifest* beside cassettes that do exist is the opposite: the gate
    // this test advertises would pass having checked nothing, and the next cassette could carry
    // a short identifier or a private note — the exact class the manifest exists to put in front
    // of a person — with CI green. So one is a skip and the other is a failure.
    if (!fs.existsSync(cassettesRoot)) return;
    expect(
      fs.existsSync(manifestPath),
      `${manifestPath} is missing, so the unknown-key gate has nothing to compare against. ` +
        `Restore it rather than letting this check pass by doing nothing.`,
    ).toBe(true);

    const known = new Set<string>(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    const seen = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        seen.add(key);
        collect(nested);
      }
    };

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith(".json") && full !== manifestPath) {
          collect(JSON.parse(fs.readFileSync(full, "utf8")));
        }
      }
    };
    walk(cassettesRoot);

    const unknown = [...seen].filter((key) => !known.has(key)).sort();
    expect(
      unknown,
      `keys no one has reviewed: ${unknown.join(", ")}. Look at what the bank puts in each, ` +
        `then add it to known-keys.json — and to the scrubber's allowlists if it should survive.`,
    ).toEqual([]);
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

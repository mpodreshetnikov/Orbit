import { describe, expect, it } from "vitest";
import { tbankConnector } from "./tbank-csv";

describe("tbank-csv connector", () => {
  it("returns error for missing data rows", async () => {
    const file = new File(["only one line"], "empty.csv", { type: "text/csv" });
    const result = await tbankConnector.parse(file);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual(["CSV has no header or data rows"]);
  });

  it("reports invalid date rows", async () => {
    const header = [
      "Р”Р°С‚Р° РѕРїРµСЂР°С†РёРё",
      "Р”Р°С‚Р° РїР»Р°С‚РµР¶Р°",
      "РќРѕРјРµСЂ РєР°СЂС‚С‹",
      "РЎС‚Р°С‚СѓСЃ",
      "РЎСѓРјРјР° РѕРїРµСЂР°С†РёРё",
      "Р’Р°Р»СЋС‚Р° РѕРїРµСЂР°С†РёРё",
      "РљР°С‚РµРіРѕСЂРёСЏ",
      "MCC",
      "РћРїРёСЃР°РЅРёРµ",
    ].join(";");

    const row = [
      "01.02.2026 12:30:00",
      "01.02.2026",
      "**** 1234",
      "OK",
      "-120,50",
      "RUB",
      "Food",
      "5812",
      "Coffee",
    ].join(";");

    const file = new File([`${header}\n${row}\n`], "sample.csv", { type: "text/csv" });
    const result = await tbankConnector.parse(file);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual(["Row 2: invalid date"]);
  });
});

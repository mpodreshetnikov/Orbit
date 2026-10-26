import { describe, expect, it } from "vitest";
import {
  canRunImportExtension,
  importBankOfSource,
  importBankOptions,
} from "./money-import-sources";

const connectors = [
  { sourceId: "tbank", kind: "file" as const },
  { sourceId: "tbank_web", kind: "extension" as const },
  { sourceId: "alfa_web", kind: "extension" as const },
];

describe("importBankOfSource", () => {
  it("names the bank behind a source", () => {
    expect(importBankOfSource("tbank")).toBe("tbank");
    expect(importBankOfSource("tbank_web")).toBe("tbank");
    expect(importBankOfSource("alfa_web")).toBe("alfa");
    expect(importBankOfSource("sber_csv")).toBe("other");
  });
});

describe("importBankOptions", () => {
  it("offers the personal account first on a computer, recommended for T-Bank", () => {
    const banks = importBankOptions(connectors, { extension: true });
    expect(banks.map((bank) => [bank.id, bank.available])).toEqual([
      ["tbank", true],
      ["alfa", true],
      ["other", false],
    ]);
    expect(banks[0]!.methods).toEqual([
      { kind: "extension", sourceId: "tbank_web", recommended: true, available: true },
      { kind: "file", sourceId: "tbank", recommended: false, available: true },
    ]);
    expect(banks[1]!.methods).toEqual([
      { kind: "extension", sourceId: "alfa_web", recommended: false, available: true },
    ]);
    expect(banks[2]!.methods).toEqual([]);
  });

  it("puts what a phone cannot do last, greyed, and the file first", () => {
    const banks = importBankOptions(connectors, { extension: false });
    expect(banks.map((bank) => [bank.id, bank.available])).toEqual([
      ["tbank", true],
      ["alfa", false],
      ["other", false],
    ]);
    expect(banks[0]!.methods.map((one) => [one.kind, one.available])).toEqual([
      ["file", true],
      ["extension", false],
    ]);
  });
});

describe("canRunImportExtension", () => {
  it("is false on phones and tablets", () => {
    expect(
      canRunImportExtension(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
      ),
    ).toBe(true);
    expect(
      canRunImportExtension(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe(false);
    expect(canRunImportExtension("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari")).toBe(
      false,
    );
  });
});

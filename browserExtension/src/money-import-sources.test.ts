import { describe, expect, it } from "vitest";
import {
  getAllMoneyImportSourcePagePatterns,
  getMoneyImportSourceDefinition,
  getMoneyImportSourcePreset,
  matchesKnownMoneyImportSourcePageUrl,
  matchesMoneyImportSourcePageUrl,
  sanitizeMoneyImportSourceKey,
  shouldShowMoneyImportSourcePageWidget,
} from "./money-import-sources.js";

describe("money-import-sources", () => {
  it("returns known presets for T-Bank and Alfa", () => {
    expect(getMoneyImportSourcePreset("tbank_web")).toMatchObject({
      sourceKey: "tbank",
      targetUrl: "https://www.tbank.ru/mybank/operations/",
    });
    expect(getMoneyImportSourcePreset("alfa_web")).toMatchObject({
      sourceKey: "alfa",
      targetUrl: "https://web.alfabank.ru/",
      tabUrlContains: "web.alfabank.ru",
    });
  });

  it("falls back to sanitized keys for unknown sources", () => {
    expect(getMoneyImportSourcePreset("Demo Bank Web")).toEqual({
      sourceKey: "demo-bank-web",
      targetUrl: "",
      tabUrlPatterns: [],
      tabUrlContains: "",
      apiUrlRegex: "",
    });
    expect(sanitizeMoneyImportSourceKey("Demo Bank Web")).toBe("demo-bank-web");
  });

  it("matches known source page hosts for T-Bank and Alfa", () => {
    expect(matchesMoneyImportSourcePageUrl("tbank_web", "https://www.tbank.ru/mybank/")).toBe(true);
    expect(matchesMoneyImportSourcePageUrl("alfa_web", "https://web.alfabank.ru/operations")).toBe(
      true,
    );
    expect(
      matchesMoneyImportSourcePageUrl(
        "alfa_web",
        "https://private.auth.alfabank.ru/passport/phone_auth",
      ),
    ).toBe(true);
    expect(matchesKnownMoneyImportSourcePageUrl("https://example.com")).toBe(false);
  });

  it("shows the source-page widget only for known sources with the session flag", () => {
    expect(
      shouldShowMoneyImportSourcePageWidget({
        source: "alfa_web",
        show_source_page_widget: true,
      }),
    ).toBe(true);
    expect(
      shouldShowMoneyImportSourcePageWidget({
        source: "unknown",
        show_source_page_widget: true,
      }),
    ).toBe(false);
    expect(
      shouldShowMoneyImportSourcePageWidget({
        source: "tbank_web",
        show_source_page_widget: false,
      }),
    ).toBe(false);
  });

  it("exposes known source metadata and the merged host patterns", () => {
    expect(getMoneyImportSourceDefinition("alfa_web")?.accountSource).toBe("alfa");
    expect(getAllMoneyImportSourcePagePatterns()).toEqual(
      expect.arrayContaining(["https://www.tbank.ru/*", "https://web.alfabank.ru/*"]),
    );
  });
});

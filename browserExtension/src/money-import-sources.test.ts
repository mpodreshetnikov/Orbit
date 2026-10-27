import { describe, expect, it } from "vitest";
import {
  findMoneyImportSourceBySiteUrl,
  findMoneyImportSourceSiteOrigin,
  getAllMoneyImportSourcePagePatterns,
  moveMoneyImportSourceUrl,
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

  it("treats the T-Bank mirror as the same bank", () => {
    const mirror = "https://www.tbank-online.com/mybank/operations/?a=1";
    expect(matchesMoneyImportSourcePageUrl("tbank_web", mirror)).toBe(true);
    expect(matchesMoneyImportSourcePageUrl("tbank_web", "https://id.tbank-online.com/auth")).toBe(
      true,
    );
    expect(matchesMoneyImportSourcePageUrl("tbank_web", "https://tbank-online.com.evil/")).toBe(
      false,
    );
    expect(getAllMoneyImportSourcePagePatterns()).toContain("https://*.tbank-online.com/*");
    expect(
      new RegExp(getMoneyImportSourcePreset("tbank_web").apiUrlRegex).test(
        "https://www.tbank-online.com/api/common/v1/operations",
      ),
    ).toBe(true);
    expect(findMoneyImportSourceBySiteUrl(mirror)?.sourceId).toBe("tbank_web");
    expect(findMoneyImportSourceBySiteUrl("https://id.tbank-online.com/")).toBeNull();
    expect(findMoneyImportSourceSiteOrigin("tbank_web", mirror)).toBe(
      "https://www.tbank-online.com",
    );
    expect(findMoneyImportSourceSiteOrigin("tbank_web", "not a url")).toBeNull();
  });

  it("moves a page between the bank's sites and keeps its path", () => {
    expect(
      moveMoneyImportSourceUrl("tbank_web", "https://www.tbank.ru/mybank/operations/?x=1#h"),
    ).toBe("https://www.tbank-online.com/mybank/operations/?x=1#h");
    expect(moveMoneyImportSourceUrl("tbank_web", "https://www.tbank-online.com/mybank/")).toBe(
      "https://www.tbank.ru/mybank/",
    );
    expect(
      moveMoneyImportSourceUrl("tbank_web", "https://www.tbank.ru/mybank/", "https://www.tbank.ru"),
    ).toBeNull();
    expect(moveMoneyImportSourceUrl("alfa_web", "https://web.alfabank.ru/")).toBeNull();
    expect(moveMoneyImportSourceUrl("tbank_web", "https://id.tbank.ru/")).toBeNull();
  });
});

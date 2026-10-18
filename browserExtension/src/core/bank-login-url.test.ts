import { describe, expect, it } from "vitest";
import { looksLikeBankLoginUrl } from "./bank-login-url";

describe("looksLikeBankLoginUrl", () => {
  it("knows both banks' sign-in screens", () => {
    expect(looksLikeBankLoginUrl("https://www.tbank.ru/auth/login/?redirectTo=%2Fevents%2F")).toBe(
      true,
    );
    expect(looksLikeBankLoginUrl("https://id.tbank.ru/login?x=1")).toBe(true);
    expect(looksLikeBankLoginUrl("https://private.auth.alfabank.ru/passport/phone_auth")).toBe(
      true,
    );
    expect(looksLikeBankLoginUrl("https://web.alfabank.ru/cerberus")).toBe(true);
  });

  it("leaves the account pages, and nothing, alone", () => {
    expect(looksLikeBankLoginUrl("https://www.tbank.ru/events/feed/")).toBe(false);
    expect(looksLikeBankLoginUrl("https://web.alfabank.ru/dashboard/history")).toBe(false);
    expect(looksLikeBankLoginUrl("https://www.tbank.ru/loginless-page/")).toBe(false);
    expect(looksLikeBankLoginUrl(null)).toBe(false);
    expect(looksLikeBankLoginUrl("")).toBe(false);
  });
});

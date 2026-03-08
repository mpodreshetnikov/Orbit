import { describe, expect, it } from "vitest";
import { resolveManualAuthAssessment } from "./playwright-cli-run-connector-parser.auth";

describe("resolveManualAuthAssessment", () => {
  it("requires manual auth when redirected to the login page even without DOM auth markers", () => {
    const result = resolveManualAuthAssessment(
      "https://www.tbank.ru/auth/login/?redirectTo=%2Fmybank%2Foperations%2F",
      "https://www.tbank.ru/mybank/operations/",
      "/mybank/operations",
      {
        hasOperationsFeed: false,
        hasPasswordInput: false,
        looksLikeAuthGate: false,
      },
    );

    expect(result.requiresManualAuth).toBe(true);
    expect(result.reason).toContain("login");
  });
});

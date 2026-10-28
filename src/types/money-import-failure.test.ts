import { describe, expect, it } from "vitest";
import { readableImportFailure } from "./money-import-failure";

describe("readableImportFailure", () => {
  it("keeps the reason and drops the connector's diagnostics", () => {
    expect(
      readableImportFailure(
        'T-Bank session is not authorized. Sign in and retry import. diagnostics={"tab_url":"https://www.tbank-online.com/auth/login/","tab_status":"complete"}',
      ),
    ).toBe("T-Bank session is not authorized. Sign in and retry import.");
  });

  it("drops a separator left hanging before the diagnostics", () => {
    expect(readableImportFailure('Alfa did not answer; diagnostics={"step":1}')).toBe(
      "Alfa did not answer",
    );
  });

  it("returns a message without diagnostics as it is", () => {
    expect(readableImportFailure("  T-Bank did not stay on the operations page ")).toBe(
      "T-Bank did not stay on the operations page",
    );
  });

  it("returns null when nothing readable is left", () => {
    expect(readableImportFailure('diagnostics={"a":1}')).toBeNull();
    expect(readableImportFailure("")).toBeNull();
    expect(readableImportFailure(null)).toBeNull();
    expect(readableImportFailure(undefined)).toBeNull();
  });
});

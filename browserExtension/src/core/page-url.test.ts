import { describe, expect, it } from "vitest";
import { isPathUnder } from "./page-url";

describe("isPathUnder", () => {
  it("accepts the page itself, with or without the trailing slash", () => {
    expect(isPathUnder("/mybank/operations", "/mybank/operations")).toBe(true);
    expect(isPathUnder("/mybank/operations/", "/mybank/operations")).toBe(true);
    expect(isPathUnder("/mybank/operations/", "/mybank/operations/")).toBe(true);
  });

  it("accepts the versioned page the bank redirects to", () => {
    // The address T-Bank served on 2026-09-03; the query is stripped by URL.pathname upstream.
    expect(isPathUnder("/mybank/operations/v8/", "/mybank/operations/")).toBe(true);
    expect(isPathUnder("/history/details/1", "/history")).toBe(true);
  });

  it("rejects siblings that merely share the prefix", () => {
    expect(isPathUnder("/mybank/operations-settings", "/mybank/operations")).toBe(false);
    expect(isPathUnder("/mybank/operationsv8", "/mybank/operations")).toBe(false);
    expect(isPathUnder("/historyx", "/history")).toBe(false);
    expect(isPathUnder("/mybank/", "/mybank/operations")).toBe(false);
  });
});

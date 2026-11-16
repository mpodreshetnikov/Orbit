import { describe, expect, it } from "vitest";
import { formatAgentSourceNote } from "./agent-source-note";

describe("formatAgentSourceNote", () => {
  it("returns the neutral agent stamp without evidence", () => {
    expect(formatAgentSourceNote()).toBe("Добавлено агентом.");
    expect(formatAgentSourceNote(null)).toBe("Добавлено агентом.");
    expect(formatAgentSourceNote(undefined)).toBe("Добавлено агентом.");
  });

  it("names the evidence record and its date when both are present", () => {
    expect(formatAgentSourceNote({ title: "УЗИ", record_date: "2026-03-06" })).toBe(
      "Добавлено агентом по записи «УЗИ» от 2026-03-06.",
    );
  });

  it("omits the date clause when the evidence has no record_date", () => {
    expect(formatAgentSourceNote({ title: "ОАК", record_date: null })).toBe(
      "Добавлено агентом по записи «ОАК».",
    );
  });

  it("treats an empty record_date string as missing", () => {
    // Empty string is falsy → same as null for the date clause.
    expect(formatAgentSourceNote({ title: "МРТ", record_date: "" })).toBe(
      "Добавлено агентом по записи «МРТ».",
    );
  });
});

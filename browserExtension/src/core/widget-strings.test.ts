import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WIDGET_LOCALES,
  knownWidgetPhases,
  resolveWidgetLocale,
  widgetPhaseLabel,
  widgetText,
} from "./widget-strings";

describe("widget strings", () => {
  it("names every phase in every language", () => {
    // The tables of plain strings are typed against one key list, so a missing entry there is a
    // compile error. Phase labels are keyed by the connector's phase names and are not, so this
    // is the check that a phase added in one language is added in the other.
    const [first, ...rest] = WIDGET_LOCALES;
    const reference = knownWidgetPhases(first).sort();
    for (const locale of rest) {
      expect(knownWidgetPhases(locale).sort()).toEqual(reference);
    }
  });

  it("names every phase the connectors and the runner can emit", () => {
    // Read from the source rather than from a list kept here: the finding that prompted this
    // was a phase Alfa-Bank emits on every import, missing from a table that had been written
    // against T-Bank. A list here would have been written the same way.
    const sources = [
      "../connectors/tbank-web.ts",
      "../connectors/alfa-web.ts",
      "./import-runner.ts",
    ].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
    // Literals that share the phase prefix but are not phases.
    const notPhases = new Set(["parse_strategy", "parse_output", "parse_only"]);

    const emitted = new Set<string>();
    for (const file of sources) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/"(parse_[a-z_]+)"/g)) {
        if (!notPhases.has(match[1])) emitted.add(match[1]);
      }
    }
    expect(emitted.size).toBeGreaterThan(5);

    for (const locale of WIDGET_LOCALES) {
      const known = new Set(knownWidgetPhases(locale));
      const missing = [...emitted].filter((phase) => !known.has(phase)).sort();
      expect(missing, `${locale} has no label for: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("has no empty strings in any language", () => {
    for (const locale of WIDGET_LOCALES) {
      for (const phase of knownWidgetPhases(locale)) {
        expect(widgetPhaseLabel(locale, phase).trim()).not.toBe("");
      }
      expect(widgetText(locale, "run").trim()).not.toBe("");
    }
  });

  it("follows the session's locale before the browser's", () => {
    expect(resolveWidgetLocale({ locale: "ru" }, "en-US")).toBe("ru");
    expect(resolveWidgetLocale({ locale: "en" }, "ru-RU")).toBe("en");
  });

  it("falls back to the browser language for a session without one", () => {
    expect(resolveWidgetLocale({}, "ru-RU")).toBe("ru");
    expect(resolveWidgetLocale(null, "ru")).toBe("ru");
    expect(resolveWidgetLocale({ locale: "de" }, "en-GB")).toBe("en");
    expect(resolveWidgetLocale(null, undefined)).toBe("en");
  });

  it("shows an unknown phase by name rather than hiding it", () => {
    expect(widgetPhaseLabel("ru", "some_new_phase")).toBe("some new phase");
    expect(widgetPhaseLabel("en", null)).toBe("Idle");
    expect(widgetPhaseLabel("ru", null)).toBe("Ожидание");
  });
});

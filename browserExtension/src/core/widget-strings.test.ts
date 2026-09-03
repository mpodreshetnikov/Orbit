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

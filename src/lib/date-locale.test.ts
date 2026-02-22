import { describe, expect, it } from "vitest";
import { enUS, ru } from "date-fns/locale";
import { getDateFnsLocale, getDateHeaderFormat, getIntlLocale } from "./date-locale";

describe("date-locale helpers", () => {
  it("returns date-fns locale by language", () => {
    expect(getDateFnsLocale("ru")).toBe(ru);
    expect(getDateFnsLocale("en")).toBe(enUS);
  });

  it("returns Intl locale by language", () => {
    expect(getIntlLocale("ru")).toBe("ru-RU");
    expect(getIntlLocale("en")).toBe("en-US");
  });

  it("returns header date format by language", () => {
    expect(getDateHeaderFormat("ru")).toBe("EEEEEE, d MMM");
    expect(getDateHeaderFormat("en")).toBe("EEE, MMM d");
  });
});

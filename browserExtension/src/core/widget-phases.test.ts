/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { WIDGET_LOCALES, knownWidgetPhases } from "./widget-strings";

/**
 * Every phase the extension can show in its widget must be named in every language.
 *
 * Read from the source rather than from a list kept here: the finding that prompted this was a
 * phase Alfa-Bank emits on every import, missing from a table that had been written against
 * T-Bank. A list in the test would have been written the same way. The sources come in through
 * the bundler as raw text, because extension code may not import node:fs and build scripts may
 * not import extension code -- this is the one place that can see both.
 */
const SOURCES = import.meta.glob(["../connectors/*-web.ts", "./import-runner.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Share the prefix, are not phases: session fields and connector options. */
const NOT_PHASES = new Set(["parse_strategy", "parse_output", "parse_only"]);

/**
 * Phase-shaped literals that reach the widget. A literal that appears only as the first argument
 * of the runner's debug `emit(...)` is a telemetry event name, not a phase -- `parse_started` is
 * one -- and the widget never sees it.
 */
export function emittedWidgetPhases(): string[] {
  const seen = new Map<string, { total: number; debugOnly: number }>();
  for (const source of Object.values(SOURCES)) {
    for (const match of source.matchAll(/"(parse_[a-z_]+)"/g)) {
      const name = match[1];
      if (NOT_PHASES.has(name)) continue;
      const entry = seen.get(name) ?? { total: 0, debugOnly: 0 };
      entry.total += 1;
      const before = source.slice(Math.max(0, match.index - 8), match.index);
      if (before.endsWith("emit(")) entry.debugOnly += 1;
      seen.set(name, entry);
    }
  }
  return [...seen]
    .filter(([, entry]) => entry.total > entry.debugOnly)
    .map(([name]) => name)
    .sort();
}

describe("widget phases", () => {
  it("reads the sources and finds the phases the connectors emit", () => {
    expect(Object.keys(SOURCES).length).toBe(3);
    const phases = emittedWidgetPhases();
    expect(phases).toContain("parse_loading_operations_page");
    expect(phases).toContain("parse_loading_history_page");
    expect(phases).not.toContain("parse_started");
  });

  it("names every emitted phase in every language", () => {
    const emitted = emittedWidgetPhases();
    for (const locale of WIDGET_LOCALES) {
      const known = new Set(knownWidgetPhases(locale));
      const missing = emitted.filter((phase) => !known.has(phase));
      expect(missing, `${locale} has no label for: ${missing.join(", ")}`).toEqual([]);
    }
  });
});

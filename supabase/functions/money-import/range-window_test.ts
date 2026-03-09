import { assertEquals } from "std/assert/assert-equals";
import {
  buildImportContext,
  classifyRowForWindow,
  IMPORT_HISTORY_STALE_THRESHOLD_DAYS,
  mergeRangeMeta,
  readRangeSelectionMeta,
  resolveEffectiveImportWindow,
} from "./range-window.ts";

Deno.test("buildImportContext returns automatic range for recent imports", () => {
  const context = buildImportContext(
    "2026-03-01T09:30:00.000Z",
    new Date("2026-03-08T00:00:00.000Z"),
  );

  assertEquals(context.last_imported_at, "2026-03-01T09:30:00.000Z");
  assertEquals(context.requires_history_prompt, false);
  assertEquals(context.recommended_mode, "auto");
  assertEquals(context.window_from, "2026-03-01T09:30:00.000Z");
  assertEquals(context.window_to, "2026-03-08T00:00:00.000Z");
});

Deno.test("buildImportContext prompts for history when imports are stale or absent", () => {
  const now = new Date("2026-03-08T00:00:00.000Z");

  const staleContext = buildImportContext("2024-01-15T09:00:00.000Z", now);
  const missingContext = buildImportContext(null, now);

  assertEquals(staleContext.requires_history_prompt, true);
  assertEquals(staleContext.recommended_mode, "preset");
  assertEquals(staleContext.window_from, "2025-03-08T00:00:00.000Z");
  assertEquals(staleContext.stale_threshold_days, IMPORT_HISTORY_STALE_THRESHOLD_DAYS);

  assertEquals(missingContext.requires_history_prompt, true);
  assertEquals(missingContext.last_imported_at, null);
  assertEquals(missingContext.window_from, "2025-03-08T00:00:00.000Z");
  assertEquals(missingContext.window_to, "2026-03-08T00:00:00.000Z");
});

Deno.test("resolveEffectiveImportWindow prefers normalized preferred values and falls back", () => {
  assertEquals(
    resolveEffectiveImportWindow(
      "2026-03-01T09:30:00.000Z",
      "invalid",
      "2026-01-01T00:00:00.000Z",
      "2026-03-08T00:00:00.000Z",
    ),
    {
      windowFrom: "2026-03-01T09:30:00.000Z",
      windowTo: "2026-03-08T00:00:00.000Z",
    },
  );

  assertEquals(resolveEffectiveImportWindow(null, null, null, null), {
    windowFrom: null,
    windowTo: null,
  });
});

Deno.test("classifyRowForWindow handles invalid, in-range, and out-of-range dates", () => {
  assertEquals(
    classifyRowForWindow("bad-date", "2026-03-01T00:00:00.000Z", "2026-03-31T23:59:59.000Z"),
    {
      kind: "invalid_date",
      message: "Invalid posted_at for selected import range",
    },
  );

  assertEquals(
    classifyRowForWindow(
      "2026-02-28T23:59:59.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-03-31T23:59:59.000Z",
    ),
    {
      kind: "out_of_range",
      postedAt: "2026-02-28T23:59:59.000Z",
      message: "Outside selected import range",
    },
  );

  assertEquals(
    classifyRowForWindow(
      "2026-04-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-03-31T23:59:59.000Z",
    ),
    {
      kind: "out_of_range",
      postedAt: "2026-04-01T00:00:00.000Z",
      message: "Outside selected import range",
    },
  );

  assertEquals(
    classifyRowForWindow(
      "2026-03-15T12:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-03-31T23:59:59.000Z",
    ),
    {
      kind: "in_range",
      postedAt: "2026-03-15T12:00:00.000Z",
    },
  );
});

Deno.test("mergeRangeMeta accumulates counters and keeps the latest range metadata", () => {
  const merged = mergeRangeMeta(
    {
      parsed_row_count: 2,
      in_range_row_count: 1,
      filtered_out_of_range_count: 1,
      filtered_invalid_date_count: 0,
      range_selection_meta: {
        selection_mode: "auto",
        preset_key: null,
      },
    },
    {
      range_selection_meta: {
        selection_mode: "preset",
        preset_key: "1y",
      },
    },
    {
      parsedRowCount: 3,
      inRangeRowCount: 2,
      filteredOutOfRangeCount: 1,
      filteredInvalidDateCount: 1,
    },
  );

  assertEquals(merged.parsed_row_count, 5);
  assertEquals(merged.in_range_row_count, 3);
  assertEquals(merged.filtered_out_of_range_count, 2);
  assertEquals(merged.filtered_invalid_date_count, 1);
  assertEquals(merged.range_selection_meta, {
    selection_mode: "preset",
    preset_key: "1y",
  });
});

Deno.test("readRangeSelectionMeta normalizes supported values and rejects invalid payloads", () => {
  assertEquals(readRangeSelectionMeta(null), null);
  assertEquals(readRangeSelectionMeta({ selection_mode: "unexpected" }), null);

  assertEquals(
    readRangeSelectionMeta({
      selection_mode: "custom",
      preset_key: "unexpected",
      prompted_for_history: 1,
      last_imported_at_at_decision_time: "2026-03-01T00:00:00.000Z",
      stale_threshold_days: "400",
    }),
    {
      selection_mode: "custom",
      preset_key: null,
      prompted_for_history: true,
      last_imported_at_at_decision_time: "2026-03-01T00:00:00.000Z",
      stale_threshold_days: 400,
    },
  );
});

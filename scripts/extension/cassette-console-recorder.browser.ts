/**
 * Browser entry point for the console cassette recorder.
 *
 * `build-cassette-recorder.ts` bundles this into one paste-ready file. Pasting it into the
 * console of a signed-in bank page records a cassette and downloads it; the page's own session
 * is the only credential involved, and it never leaves the browser.
 */

import { recordCassette, type RecorderOptions } from "./cassette-console-recorder";

declare global {
  interface Window {
    orbitRecordCassette?: (options?: Partial<RecorderOptions>) => Promise<void>;
  }
}

function download(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function run(options: Partial<RecorderOptions> = {}): Promise<void> {
  const name = options.name ?? "dense-month";
  const result = await recordCassette(
    {
      ...options,
      name,
      // Without this the console shows the banner, then `undefined`, then nothing at all for a
      // minute or more while twenty-five paced receipt requests run. That reads as a script
      // that did nothing.
      onProgress: (message) => console.info(`[cassette] ${message}`),
    },
    {
      fetch: (input, init) => window.fetch(input, init),
      resourceUrls: () =>
        performance
          .getEntriesByType("resource")
          .map((entry) => (entry as PerformanceResourceTiming).name)
          .filter((entryName): entryName is string => typeof entryName === "string"),
      origin: window.location.origin,
      now: () => Date.now(),
    },
  );

  for (const warning of result.warnings) {
    console.warn(`[cassette] ${warning}`);
  }

  if (result.leaks.length > 0) {
    // Downloading anyway would put the scrubber's misses on disk and, from there, one careless
    // upload away from the repository. Report and stop.
    console.error(
      `[cassette] NOT downloaded — the scrubber left ${result.leaks.length} value(s) that still ` +
        "look like secrets. Please report this rather than sharing the recording:",
    );
    for (const leak of result.leaks) console.error(`[cassette]   ${leak}`);
    return;
  }

  download(`cassette.json`, JSON.stringify(result.cassette, null, 2));
  console.info(
    `[cassette] recorded ${result.counts.operations} operation(s) over ${result.counts.ranges} ` +
      `range request(s) with ${result.counts.receipts} receipt(s), scrubbed and downloaded as ` +
      "cassette.json",
  );

  // The recording can look complete and be short — a truncated range loses its remainder in
  // silence. Nothing inside the file reveals that; the bank's own monthly totals do. So they
  // are printed here, in the bank's own terms, for the one person who can compare them.
  const summary = result.cassette.summary;
  if (summary && summary.months.length > 0) {
    const complete = summary.months.filter((month) => month.complete);
    console.info(
      complete.length > 0
        ? "[cassette] Compare the rows marked complete against the bank's own totals for those " +
            "months before sharing the file. If one is short, the recording missed operations. " +
            "Rows that are not complete are partial by design — the window does not cover the " +
            "whole month — so they cannot be compared."
        : "[cassette] No month in this recording is covered end to end, so none of these totals " +
            "can be compared against the bank. Re-run with orbitRecordCassette({ wholeMonths: 2 }).",
    );
    console.table(summary.months);
    if (summary.truncationSuspected > 0) {
      console.info(
        `[cassette] ${summary.truncationSuspected} range(s) came back looking capped and were ` +
          "split and re-requested, exactly as the connector does.",
      );
    }
  }
}

window.orbitRecordCassette = run;

console.info(
  "[cassette] recording with defaults (this month and the whole of last month, up to 50 " +
    "receipts — the connector's own per-run budget). For a different window, run e.g. " +
    "orbitRecordCassette({ wholeMonths: 3 }) or orbitRecordCassette({ windowDays: 45 })",
);

void run().catch((error: unknown) => {
  console.error("[cassette] recording failed:", error);
});

import { describe, expect, it } from "vitest";
import {
  createInitialBackfillState,
  planBackfillSlice,
  planIncrementalWindow,
  shouldAdvanceBackfillCursor,
} from "./backfill-scheduler";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

describe("planIncrementalWindow", () => {
  it("covers the last few days up to now", () => {
    expect(planIncrementalWindow(null, NOW)).toEqual({
      windowFromIso: "2026-08-20T12:00:00.000Z",
      windowToIso: "2026-08-23T12:00:00.000Z",
    });
  });

  it("honours a custom lookback", () => {
    expect(planIncrementalWindow(null, NOW, 1).windowFromIso).toBe("2026-08-22T12:00:00.000Z");
  });
});

describe("planBackfillSlice", () => {
  it("starts one month behind the incremental window", () => {
    const planned = planBackfillSlice(createInitialBackfillState(), NOW);
    expect(planned?.slice).toEqual({
      windowFromIso: "2026-07-20T12:00:00.000Z",
      windowToIso: "2026-08-20T12:00:00.000Z",
    });
    expect(planned?.nextState.cursorMs).toBe(Date.parse("2026-07-20T12:00:00.000Z"));
    expect(planned?.nextState.completedAtMs).toBeNull();
  });

  it("walks a month deeper on each run", () => {
    let state = createInitialBackfillState();
    const starts: string[] = [];
    for (let run = 0; run < 3; run++) {
      const planned = planBackfillSlice(state, NOW);
      if (!planned) break;
      starts.push(planned.slice.windowFromIso);
      state = planned.nextState;
    }

    expect(starts).toEqual([
      "2026-07-20T12:00:00.000Z",
      "2026-06-20T12:00:00.000Z",
      "2026-05-20T12:00:00.000Z",
    ]);
  });

  it("stops at the horizon and records that it finished", () => {
    let state = createInitialBackfillState(2);
    const slices: string[] = [];
    for (let run = 0; run < 10; run++) {
      const planned = planBackfillSlice(state, NOW);
      if (!planned) break;
      slices.push(planned.slice.windowFromIso);
      state = planned.nextState;
    }

    expect(slices).toEqual(["2026-07-20T12:00:00.000Z", "2026-06-23T12:00:00.000Z"]);
    expect(state.completedAtMs).toBe(NOW);
    expect(planBackfillSlice(state, NOW)).toBeNull();
  });

  it("never plans a slice past the horizon", () => {
    const state = {
      ...createInitialBackfillState(6),
      cursorMs: Date.parse("2026-01-01T00:00:00.000Z"),
    };
    expect(planBackfillSlice(state, NOW)).toBeNull();
  });
});

describe("shouldAdvanceBackfillCursor", () => {
  it("advances only on a slice that is genuinely finished", () => {
    expect(shouldAdvanceBackfillCursor({ ok: true, unreadReceiptCount: 0, partial: false })).toBe(
      true,
    );
  });

  it("holds the cursor when receipts were left for next time", () => {
    expect(shouldAdvanceBackfillCursor({ ok: true, unreadReceiptCount: 4, partial: false })).toBe(
      false,
    );
  });

  it("holds the cursor when the connector could not read the whole slice", () => {
    // The walk passes each slice once. Moving past a slice it could not read in full would
    // leave that gap unfilled by anything, forever.
    expect(shouldAdvanceBackfillCursor({ ok: true, unreadReceiptCount: 0, partial: true })).toBe(
      false,
    );
  });

  it("holds the cursor when the run failed", () => {
    expect(shouldAdvanceBackfillCursor({ ok: false, unreadReceiptCount: 0, partial: false })).toBe(
      false,
    );
  });
});

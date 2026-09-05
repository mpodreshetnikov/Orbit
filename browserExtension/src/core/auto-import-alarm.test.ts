import { describe, expect, it } from "vitest";
import {
  AUTO_IMPORT_ALARM_PERIOD_MINUTES,
  FIRST_SWEEP_DELAY_MINUTES,
  needsRearmAtStart,
  REARM_IF_FURTHER_THAN_MS,
  sweepAlarmSchedule,
} from "./auto-import-alarm.js";

describe("auto-import alarm", () => {
  it("asks minutes after it is armed, then every period", () => {
    expect(sweepAlarmSchedule()).toEqual({
      delayInMinutes: FIRST_SWEEP_DELAY_MINUTES,
      periodInMinutes: AUTO_IMPORT_ALARM_PERIOD_MINUTES,
    });
    expect(FIRST_SWEEP_DELAY_MINUTES).toBeLessThan(10);
  });

  it("re-arms at the browser's start an alarm that is missing or hours away, not one about to fire", () => {
    const now = Date.parse("2026-09-05T13:00:00.000Z");
    expect(needsRearmAtStart(null, now)).toBe(true);
    expect(needsRearmAtStart(undefined, now)).toBe(true);
    expect(needsRearmAtStart({ scheduledTime: now + 2 * 60 * 60 * 1000 }, now)).toBe(true);
    expect(needsRearmAtStart({ scheduledTime: now + REARM_IF_FURTHER_THAN_MS + 1 }, now)).toBe(
      true,
    );
    expect(needsRearmAtStart({ scheduledTime: now + 5 * 60 * 1000 }, now)).toBe(false);
    // Overdue while the browser was closed: Chrome fires it on its own; nothing to move.
    expect(needsRearmAtStart({ scheduledTime: now - 60 * 1000 }, now)).toBe(false);
  });
});

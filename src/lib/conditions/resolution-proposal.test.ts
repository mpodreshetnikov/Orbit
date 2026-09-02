import { describe, it, expect } from "vitest";
import { proposedClosureStillHolds } from "./resolution-proposal";
import type { RecordObservation } from "@/types/medical-record";

type ObservationInput = Parameters<typeof proposedClosureStillHolds>[1][number];

function observation(overrides: Partial<RecordObservation> = {}): ObservationInput {
  return {
    obs_code: "vitamin_b12",
    is_applied: true,
    value_numeric: 704,
    value_canonical: null,
    ref_range_low: 187,
    ref_range_high: 883,
    ref_range_low_canonical: null,
    ref_range_high_canonical: null,
    status: "normal",
    ...overrides,
  } as ObservationInput;
}

const closure = { status_in_record: "resolved", supporting_obs_code: "vitamin_b12" };

describe("proposedClosureStillHolds", () => {
  it("holds when the cited measurement is still on the record and in range", () => {
    expect(proposedClosureStillHolds(closure, [observation()])).toBe(true);
  });

  it("does not hold when the person corrected the value out of range", () => {
    expect(proposedClosureStillHolds(closure, [observation({ value_numeric: 120 })])).toBe(false);
  });

  it("does not hold when the cited observation was left unapplied", () => {
    // Activation deletes unapplied observations before conditions are verified, so this is also
    // what a deleted one looks like from here.
    expect(proposedClosureStillHolds(closure, [observation({ is_applied: false })])).toBe(false);
  });

  it("does not hold when the observation was recoded to another analyte", () => {
    expect(proposedClosureStillHolds(closure, [observation({ obs_code: "ferritin" })])).toBe(false);
  });

  it("does not hold when nothing on the record carries the cited code", () => {
    expect(proposedClosureStillHolds(closure, [])).toBe(false);
  });

  it("compares against canonical bounds when the record has them", () => {
    // The raw value would pass the raw range; the canonical pair is the one that agrees on a unit.
    const converted = observation({
      value_numeric: 704,
      value_canonical: 0.52,
      ref_range_low_canonical: 1.38,
      ref_range_high_canonical: 6.52,
    });
    expect(proposedClosureStillHolds(closure, [converted])).toBe(false);
  });

  it("falls back to the recorded status only when no range was recorded", () => {
    const noRange = {
      ref_range_low: null,
      ref_range_high: null,
      value_numeric: null,
    };
    expect(
      proposedClosureStillHolds(closure, [observation({ ...noRange, status: "normal" })]),
    ).toBe(true);
    expect(proposedClosureStillHolds(closure, [observation({ ...noRange, status: "low" })])).toBe(
      false,
    );
    expect(proposedClosureStillHolds(closure, [observation({ ...noRange, status: null })])).toBe(
      false,
    );
  });

  it("treats an unreadable value as out of range when a range was recorded", () => {
    expect(
      proposedClosureStillHolds(closure, [observation({ value_numeric: null, status: "normal" })]),
    ).toBe(false);
  });

  it("requires every row carrying the cited code to be in range", () => {
    expect(
      proposedClosureStillHolds(closure, [observation(), observation({ value_numeric: 120 })]),
    ).toBe(false);
  });

  it("leaves mentions that never rested on a measurement alone", () => {
    // No citation, and a non-closing status: neither is a lab-driven closure, and re-checking
    // observations would refuse to confirm ordinary mentions on a document with no labs at all.
    expect(
      proposedClosureStillHolds({ status_in_record: "resolved", supporting_obs_code: null }, []),
    ).toBe(true);
    expect(proposedClosureStillHolds({ ...closure, status_in_record: "active" }, [])).toBe(true);
  });

  it("covers history as well as resolved, because both take a condition off the chart", () => {
    expect(proposedClosureStillHolds({ ...closure, status_in_record: "history" }, [])).toBe(false);
  });
});

describe("multi-analyte entries", () => {
  const ironDeficiency = { status_in_record: "resolved", supporting_obs_code: "ferritin" };

  function iron(overrides: Partial<RecordObservation> = {}): ObservationInput {
    return observation({
      obs_code: "ferritin",
      value_numeric: 60,
      ref_range_low: 10,
      ref_range_high: 120,
      ...overrides,
    });
  }

  it("holds only when every observation the entry requires still stands", () => {
    // Iron-deficiency anaemia rests on two measurements. The citation names one of them, so
    // re-checking only that one would confirm the closure after the reviewer corrected the other.
    const haemoglobin = iron({
      obs_code: "hemoglobin",
      value_numeric: 140,
      ref_range_low: 120,
      ref_range_high: 160,
    });

    expect(proposedClosureStillHolds(ironDeficiency, [iron(), haemoglobin])).toBe(true);
    expect(
      proposedClosureStillHolds(ironDeficiency, [
        iron(),
        iron({
          obs_code: "hemoglobin",
          value_numeric: 95,
          ref_range_low: 120,
          ref_range_high: 160,
        }),
      ]),
    ).toBe(false);
    // Deleted or left unapplied, which activation turns into deleted.
    expect(proposedClosureStillHolds(ironDeficiency, [iron()])).toBe(false);
    expect(
      proposedClosureStillHolds(ironDeficiency, [
        iron(),
        iron({ obs_code: "hemoglobin", is_applied: false }),
      ]),
    ).toBe(false);
  });

  it("refuses an analyte this copy does not know", () => {
    // The two copies of the table have drifted, or the edge side gained an entry. Either way the
    // claim cannot be re-checked here, and an unverifiable closure is not confirmed.
    expect(
      proposedClosureStillHolds({ ...ironDeficiency, supporting_obs_code: "tsh" }, [
        observation({ obs_code: "tsh", value_numeric: 2 }),
      ]),
    ).toBe(false);
  });
});

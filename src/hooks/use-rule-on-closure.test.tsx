import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const observationRows = vi.hoisted(() => ({ data: [] as unknown[], error: null as unknown }));
const toastError = vi.hoisted(() => vi.fn());
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: observationRows.data, error: observationRows.error }),
      }),
    }),
  }),
}));

vi.mock("./use-conditions", () => ({
  useUpdateConditionRecord: () => ({ mutateAsync, isPending: false }),
}));

import { useRuleOnProposedClosure } from "./use-rule-on-closure";

const closure = {
  id: "cr-1",
  record_id: "rec-1",
  condition_id: "cond-1",
  status_in_record: "resolved",
  supporting_obs_code: "vitamin_b12",
};

function inRange(overrides: Record<string, unknown> = {}) {
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
  };
}

describe("useRuleOnProposedClosure", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
    toastError.mockReset();
    observationRows.data = [inRange()];
    observationRows.error = null;
  });

  it("confirms by verifying the mention, once the evidence still holds", async () => {
    const { result } = renderHook(() => useRuleOnProposedClosure());

    let written: boolean | undefined;
    await act(async () => {
      written = await result.current.ruleOnClosure(closure, "confirmed");
    });

    expect(written).toBe(true);
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "cr-1",
      conditionId: "cond-1",
      updates: { is_user_verified: true },
    });
  });

  it("refuses when the cited measurement no longer supports the closure", async () => {
    // Corrected out of range between the screen loading and the click.
    observationRows.data = [inRange({ value_numeric: 120, status: "low" })];
    const { result } = renderHook(() => useRuleOnProposedClosure());

    let written: boolean | undefined;
    await act(async () => {
      written = await result.current.ruleOnClosure(closure, "confirmed");
    });

    expect(written).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("refuses when the measurement is gone from the record", async () => {
    observationRows.data = [];
    const { result } = renderHook(() => useRuleOnProposedClosure());

    await act(async () => {
      await result.current.ruleOnClosure(closure, "confirmed");
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("refuses when the evidence cannot be read at all", async () => {
    // A read that failed is not evidence that the closure still holds.
    observationRows.error = { message: "network" };
    const { result } = renderHook(() => useRuleOnProposedClosure());

    let written: boolean | undefined;
    await act(async () => {
      written = await result.current.ruleOnClosure(closure, "confirmed");
    });

    expect(written).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("dismisses without reading the evidence, because rejecting needs none", async () => {
    observationRows.error = { message: "network" };
    const { result } = renderHook(() => useRuleOnProposedClosure());

    await act(async () => {
      await result.current.ruleOnClosure(closure, "dismissed");
    });

    // Neither verified nor deleted: the row stays, carrying the decision.
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "cr-1",
      conditionId: "cond-1",
      updates: { review_decision: "dismissed" },
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("skips the re-check for a mention that never cited a measurement", async () => {
    const { result } = renderHook(() => useRuleOnProposedClosure());

    await act(async () => {
      await result.current.ruleOnClosure({ ...closure, supporting_obs_code: null }, "confirmed");
    });

    expect(mutateAsync).toHaveBeenCalled();
  });

  it("reports which mention is being ruled on while the write is in flight", async () => {
    let release: (() => void) | undefined;
    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    const { result } = renderHook(() => useRuleOnProposedClosure());

    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.ruleOnClosure(closure, "dismissed");
    });

    await waitFor(() => expect(result.current.rulingOnId).toBe("cr-1"));
    await act(async () => {
      release?.();
      await pending;
    });
    expect(result.current.rulingOnId).toBeNull();
  });
});

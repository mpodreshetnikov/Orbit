import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConditionRecordRow } from "./condition-record-row";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, number>): string =>
      values?.count != null ? `${key}:${values.count}` : key,
}));

vi.mock("@/hooks", () => ({
  getConditionIcdName: (name: string | null) => (name ? `ICD:${name}` : null),
}));

vi.mock("./condition-status-badge", () => ({
  ConditionStatusBadge: ({ status }: { status: string }) => <span>{`status:${status}`}</span>,
}));

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "cr-1",
    record_id: "record-1",
    condition_id: "cond-1",
    condition_name: "Original condition",
    condition_code: "I10",
    condition_icd_name_en: "Hypertension",
    status_in_record: "active",
    condition_current_status: "resolved",
    source_anchor: "anchored text",
    confidence: 0.7,
    ...overrides,
  } as unknown as import("@/types").ConditionRecordWithDetails;
}

describe("ConditionRecordRow", () => {
  it("renders status change, source toggle, comparison badges, and action callbacks", async () => {
    const onEdit = vi.fn();
    const onAddHistory = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <ConditionRecordRow
        conditionRecord={makeRecord()}
        comparison={{ isNew: true, previousOccurrences: 0 }}
        onEdit={onEdit}
        onAddHistory={onAddHistory}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("ICD:Hypertension")).toBeInTheDocument();
    expect(screen.getByText("Original condition")).toBeInTheDocument();
    expect(screen.getByText("conditions.comparison.new")).toBeInTheDocument();
    expect(screen.getByText("status:resolved")).toBeInTheDocument();
    expect(screen.getByText("status:active")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "conditions.showSource" }));
    expect(screen.getByText("“anchored text”")).toBeInTheDocument();

    await user.click(screen.getByTitle("conditions.edit"));
    await user.click(screen.getByTitle("conditions.changeStatus"));
    await user.click(container.querySelector("button.text-destructive") as HTMLButtonElement);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onAddHistory).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renders known-comparison branch and no-ICD fallback without actions", () => {
    render(
      <ConditionRecordRow
        conditionRecord={makeRecord({
          condition_code: null,
          condition_icd_name_en: null,
          status_in_record: "resolved",
          condition_current_status: "resolved",
          source_anchor: "",
        })}
        comparison={{ isNew: false, previousOccurrences: 3 }}
        showActions={false}
      />,
    );

    expect(screen.getByText("(conditions.noIcdCode)")).toBeInTheDocument();
    expect(screen.getByText("conditions.comparison.known:3")).toBeInTheDocument();
    expect(screen.getByText("status:resolved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "conditions.edit" })).not.toBeInTheDocument();
  });
});

describe("a closure nobody has confirmed", () => {
  const pendingClosure = {
    status_in_record: "resolved",
    is_llm_extracted: true,
    is_user_verified: false,
  };

  it("says it is waiting rather than rendering as a settled resolution", () => {
    render(
      <ConditionRecordRow
        conditionRecord={makeRecord({ ...pendingClosure, condition_current_status: "active" })}
      />,
    );

    // Without this the row reads "Active → Resolved, status change" on a condition whose own
    // header still says active: the record contradicting itself with nothing to say which is true.
    expect(screen.getByText("conditions.awaitingReview")).toBeInTheDocument();
    expect(screen.getByText("(conditions.proposedChange)")).toBeInTheDocument();
    expect(screen.queryByText("(conditions.statusChange)")).not.toBeInTheDocument();
  });

  it("says nothing extra once a person has confirmed it", () => {
    render(
      <ConditionRecordRow
        conditionRecord={makeRecord({
          ...pendingClosure,
          is_user_verified: true,
          condition_current_status: "active",
        })}
      />,
    );

    expect(screen.queryByText("conditions.awaitingReview")).not.toBeInTheDocument();
    expect(screen.getByText("(conditions.statusChange)")).toBeInTheDocument();
  });

  it("leaves a closure a person wrote themselves alone", () => {
    // Not machine-authored, so it was never suppressed and never needed confirming.
    render(
      <ConditionRecordRow
        conditionRecord={makeRecord({
          ...pendingClosure,
          is_llm_extracted: false,
          condition_current_status: "active",
        })}
      />,
    );

    expect(screen.queryByText("conditions.awaitingReview")).not.toBeInTheDocument();
  });

  it("leaves an unverified mention that is not a closure alone", () => {
    // `active` and `suspected` apply unreviewed by design: they are how conditions reach the chart.
    render(
      <ConditionRecordRow
        conditionRecord={makeRecord({
          ...pendingClosure,
          status_in_record: "active",
          condition_current_status: "resolved",
        })}
      />,
    );

    expect(screen.queryByText("conditions.awaitingReview")).not.toBeInTheDocument();
    expect(screen.getByText("(conditions.statusChange)")).toBeInTheDocument();
  });
});

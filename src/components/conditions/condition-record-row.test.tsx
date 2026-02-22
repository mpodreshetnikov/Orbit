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

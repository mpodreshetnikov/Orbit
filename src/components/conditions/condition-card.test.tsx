import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConditionCard } from "./condition-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

function makeCondition(overrides: Record<string, unknown> = {}) {
  return {
    id: "cond-1",
    person_id: "person-1",
    code: "I10",
    name: "Hypertension",
    icd_name_en: "Essential hypertension",
    current_status: "active",
    onset_date: "2024-01-01",
    resolved_date: null,
    notes: "monitor blood pressure",
    mention_count: 3,
    first_mentioned_date: "2024-01-01",
    last_mentioned_date: "2025-01-01",
    history: [],
    ...overrides,
  } as unknown as import("@/types").ConditionWithHistory;
}

describe("ConditionCard", () => {
  it("renders active condition details and calls onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<ConditionCard condition={makeCondition()} onClick={onClick} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/health/conditions/cond-1");
    expect(screen.getByText("Hypertension")).toBeInTheDocument();
    expect(screen.getByText("conditions.status.active")).toBeInTheDocument();
    expect(screen.getByText("I10")).toBeInTheDocument();
    expect(screen.getByText("Essential hypertension")).toBeInTheDocument();
    expect(screen.getByText("monitor blood pressure")).toBeInTheDocument();
    expect(screen.getByText("3 conditions.mentions")).toBeInTheDocument();

    await user.click(screen.getByText("Hypertension"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders no-code and resolved/history timeline branches", () => {
    render(
      <ConditionCard
        condition={makeCondition({
          code: null,
          icd_name_en: null,
          current_status: "resolved",
          resolved_date: "2025-02-10",
          first_mentioned_date: "2025-02-10",
          last_mentioned_date: "2025-02-10",
          notes: null,
        })}
      />,
    );

    expect(screen.getByText("conditions.noIcdCode")).toBeInTheDocument();
    expect(screen.getByText("conditions.status.resolved")).toBeInTheDocument();
    expect(screen.getByText(/conditions.resolvedOn/)).toBeInTheDocument();
  });
});

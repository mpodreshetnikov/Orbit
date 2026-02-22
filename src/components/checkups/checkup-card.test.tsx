import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CheckupCard } from "./checkup-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

function makeItem(overrides: Record<string, unknown> = {}): import("@/types").CheckupItem {
  return {
    id: "checkup-1",
    person_id: "person-1",
    title: "Blood panel",
    category: "lab",
    schedule: { type: "interval", every: 1, unit: "year" },
    next_due_at: "2025-01-01",
    status: "active",
    reminder_days_before: [7],
    planned_on: "2025-01-02",
    why_text: null,
    why_links: [],
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@/types").CheckupItem;
}

describe("CheckupCard", () => {
  it("renders overdue active item and runs mark-complete/plan/select actions", async () => {
    const onMarkComplete = vi.fn();
    const onPlan = vi.fn();
    const onToggleSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <CheckupCard
        item={makeItem()}
        onMarkComplete={onMarkComplete}
        onPlan={onPlan}
        selectionMode
        selected={false}
        onToggleSelect={onToggleSelect}
      />,
    );

    expect(screen.getByText("checkups.overdue")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/health/checkups/checkup-1");

    await user.click(screen.getByRole("checkbox", { name: "checkups.selectToPlan" }));
    await user.click(screen.getByRole("button", { name: "checkups.markComplete" }));
    await user.click(screen.getByRole("button", { name: "checkups.plan" }));

    expect(onToggleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "checkup-1" }));
    expect(onMarkComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "checkup-1" }));
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "checkup-1" }));
  });

  it("renders non-active item without action buttons", () => {
    render(
      <CheckupCard
        item={makeItem({
          status: "paused",
          next_due_at: "2099-01-01",
          planned_on: null,
        })}
      />,
    );

    expect(screen.getByText("checkups.statusPaused")).toBeInTheDocument();
    expect(screen.queryByText("checkups.overdue")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "checkups.markComplete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "checkups.plan" })).not.toBeInTheDocument();
  });
});

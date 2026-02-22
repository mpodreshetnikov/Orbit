import React from "react";
import { render, screen } from "@testing-library/react";
import { enUS } from "date-fns/locale";
import { describe, expect, it, vi } from "vitest";
import type { Medication } from "@/types";
import { MedicationCard } from "./medication-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => enUS,
}));

function medication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    person_id: "person-1",
    name: "Ibuprofen",
    kind: "regular",
    unit: "pill",
    dose_per_unit: null,
    intake_advice: null,
    intake_advice_custom: null,
    scheduled_at: null,
    one_time_amount: null,
    schedule: {
      frequency: { type: "daily" },
      duration: { start_date: "2026-01-01", end_type: "endless" },
      reminder_times: [{ time: "09:00", amount: 1 }],
    },
    inventory_enabled: false,
    inventory_current: null,
    inventory_refill_threshold: null,
    status: "active",
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("MedicationCard", () => {
  it("renders one-time schedule summary and kind badge", () => {
    render(
      <MedicationCard
        medication={medication({
          kind: "one_time",
          scheduled_at: "2026-02-22T12:00:00.000Z",
          schedule: null,
        })}
      />,
    );

    expect(screen.getByText("medications.oneTime")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/health/medications/med-1");
  });

  it("renders regular daily summary and low-inventory warning", () => {
    render(
      <MedicationCard
        medication={medication({
          inventory_enabled: true,
          inventory_current: 2,
          inventory_refill_threshold: 3,
        })}
      />,
    );

    expect(
      screen.getByText("medications.frequencyDaily medications.scheduleAt 09:00"),
    ).toBeInTheDocument();
    expect(screen.getByText("medications.lowInventory")).toBeInTheDocument();
    expect(screen.getByText(/medications.stockLeft/)).toBeInTheDocument();
  });

  it("renders interval and days-of-week summaries", () => {
    const { rerender } = render(
      <MedicationCard
        medication={medication({
          schedule: {
            frequency: { type: "interval", every: 3, unit: "day" },
            duration: { start_date: "2026-01-01", end_type: "endless" },
            reminder_times: [{ time: "08:30", amount: 1 }],
          },
        })}
      />,
    );
    expect(
      screen.getByText("medications.every 3 medications.days medications.scheduleAt 08:30"),
    ).toBeInTheDocument();

    rerender(
      <MedicationCard
        medication={medication({
          schedule: {
            frequency: { type: "days_of_week", days: [5, 1, 3] },
            duration: { start_date: "2026-01-01", end_type: "endless" },
            reminder_times: [{ time: "07:00", amount: 1 }],
          },
        })}
      />,
    );

    expect(
      screen.getByText(
        "medications.dayMon, medications.dayWed, medications.dayFri medications.scheduleAt 07:00",
      ),
    ).toBeInTheDocument();
  });
});

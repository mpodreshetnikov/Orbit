import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MedRegimen } from "@/types/regimen";
import { RegimenCard, formatRegimenScheduleSummary } from "./regimen-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    return Object.entries(values).reduce(
      (message, [valueKey, value]) => message.replaceAll(`{${valueKey}}`, String(value)),
      key,
    );
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/date-locale", () => ({
  useIntlLocale: () => "en-US",
}));

function regimen(overrides: Partial<MedRegimen> = {}): MedRegimen {
  return {
    id: "reg-1",
    person_id: "person-1",
    custom_name: "Vitamin D",
    status: "active",
    intake_unit: "pill",
    dose_definition: { intake: { amount: 1, unit: "pill" }, active: [] },
    intake_advice_type: "none",
    intake_advice_text: null,
    schedule: { mode: "daily_times", times: ["09:00"], amounts: [1] },
    duration: { type: "endless", start_date: "2026-01-01" },
    reminder_prefs: null,
    inventory: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const t = (key: string, values?: { count?: number }): string =>
  values?.count != null ? `${key}:${values.count}` : key;

describe("formatRegimenScheduleSummary", () => {
  it("formats each schedule mode branch", () => {
    const oneOff = formatRegimenScheduleSummary(
      regimen({ schedule: { mode: "one_off", due_at: "2026-02-22T10:30:00.000Z" } }),
      t,
      "en-US",
    );
    expect(oneOff).toContain("2026");

    const daily = formatRegimenScheduleSummary(
      regimen({ schedule: { mode: "daily_times", times: ["08:00", "20:00"], amounts: [1, 1] } }),
      t,
      "en-US",
    );
    expect(daily).toBe("medications.frequencyDaily medications.scheduleAt 08:00, 20:00");

    const intervalHours = formatRegimenScheduleSummary(
      regimen({
        schedule: { mode: "interval_hours", interval: { every: 8 }, amount: 2 },
      }),
      t,
      "en-US",
    );
    expect(intervalHours).toBe("medications.every 8 medications.hours · 2 medications.unitPill:2");

    const intervalDays = formatRegimenScheduleSummary(
      regimen({
        schedule: {
          mode: "interval_days",
          interval: { every: 3 },
          time_of_day: "11:00",
          times: [],
        },
      }),
      t,
      "en-US",
    );
    expect(intervalDays).toBe("medications.every 3 medications.days medications.scheduleAt 11:00");

    const daysOfWeek = formatRegimenScheduleSummary(
      regimen({
        schedule: {
          mode: "days_of_week",
          days_of_week: [5, 1, 3],
          times: ["09:00"],
        },
      }),
      t,
      "en-US",
    );
    expect(daysOfWeek).toBe(
      "medications.dayMon, medications.dayWed, medications.dayFri medications.scheduleAt 09:00",
    );
  });
});

describe("RegimenCard", () => {
  it("renders low-inventory state and stock text", () => {
    render(
      <RegimenCard
        regimen={regimen({
          inventory: {
            enabled: true,
            current_amount: 2,
            refill_threshold_amount: 3,
            unit: "pill",
            auto_decrement_on_taken: true,
          },
        })}
      />,
    );

    expect(screen.getByText("medications.lowInventory")).toBeInTheDocument();
    expect(screen.getByText(/medications.stockLeft/)).toBeInTheDocument();
  });

  it("treats one-off regimens as completed status and keeps schedule summary", () => {
    render(
      <RegimenCard
        regimen={regimen({
          schedule: { mode: "one_off", due_at: "2026-03-01T12:00:00.000Z" },
          status: "active",
          inventory: null,
        })}
      />,
    );

    expect(screen.getByText("medications.statusCompleted")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/health/medications/reg-1");
  });
});

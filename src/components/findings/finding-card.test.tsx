import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindingCard } from "./finding-card";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, number>): string =>
      values?.count != null ? `${key}:${values.count}` : key,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    finding_code: "nodule",
    finding_type_text: "Nodule",
    site_code: "lung",
    body_site_text: "Lung",
    finding_type_id: null,
    body_site_id: null,
    catalog_finding_name_ru: null,
    catalog_finding_name_en: null,
    catalog_site_name_ru: null,
    catalog_site_name_en: null,
    latest_size_mm: 5,
    latest_count: 2,
    latest_severity: "severe",
    latest_laterality: "left",
    latest_date: "2026-02-10",
    is_resolved: false,
    occurrence_count: 3,
    history: [],
    ...overrides,
  } as unknown as import("@/types").FindingSummary;
}

describe("FindingCard", () => {
  it("renders unresolved severe finding details and site query link", () => {
    render(<FindingCard finding={makeFinding()} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/health/findings/nodule?site=lung");

    expect(screen.getByText("findings.severityOptions.severe")).toBeInTheDocument();
    expect(screen.getByText("findings.lateralityOptions.left Lung")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("findings.countValue:2")).toBeInTheDocument();
    expect(screen.getByText("3 findings.occurrences")).toBeInTheDocument();
  });

  it("renders resolved state and fallback URL key when finding_code is missing", () => {
    render(
      <FindingCard
        finding={makeFinding({
          finding_code: null,
          finding_type_text: "Mass lesion",
          site_code: null,
          body_site_text: null,
          latest_size_mm: null,
          latest_count: 1,
          latest_date: null,
          latest_laterality: "none",
          latest_severity: "moderate",
          is_resolved: true,
          occurrence_count: 1,
        })}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/health/findings/Mass%20lesion");
    expect(screen.getByText("findings.resolved")).toBeInTheDocument();
    expect(screen.queryByText("findings.severityOptions.moderate")).not.toBeInTheDocument();
  });
});

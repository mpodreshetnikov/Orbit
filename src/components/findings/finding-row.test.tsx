import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindingRow, type FindingComparison } from "./finding-row";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    return Object.entries(values).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), key);
  },
}));

function makeFinding(
  overrides: Record<string, unknown> = {},
): import("@/types").RecordFindingWithCatalog {
  return {
    id: "finding-1",
    record_id: "record-1",
    finding_type_text: "Nodule",
    finding_code: "NOD",
    body_site_text: "Lung",
    site_code: "lung",
    catalog_finding_name_ru: "Pulmonary nodule",
    catalog_site_name_ru: "Left lung",
    size_mm: 5,
    count: 2,
    severity: "moderate",
    laterality: "left",
    confidence: 0.7,
    source_anchor: null,
    is_llm_extracted: false,
    is_user_verified: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@/types").RecordFindingWithCatalog;
}

function makeComparison(overrides: Partial<FindingComparison> = {}): FindingComparison {
  return {
    isNew: false,
    previousOccurrences: 4,
    previousSize: 3,
    previousCount: 1,
    previousDate: "2025-01-01",
    ...overrides,
  };
}

describe("FindingRow", () => {
  it("renders severe finding details, known badge, and action callbacks", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <FindingRow
        finding={makeFinding()}
        comparison={makeComparison()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("Pulmonary nodule")).toBeInTheDocument();
    expect(screen.getByText("NOD")).toBeInTheDocument();
    expect(screen.getByText("Left lung")).toBeInTheDocument();
    expect(screen.getByText("lung")).toBeInTheDocument();
    expect(screen.getByText("findings.comparison.known (4)")).toBeInTheDocument();
    expect(screen.getByText("findings.severityOptions.moderate")).toBeInTheDocument();
    expect(screen.getByText("findings.lateralityOptions.left")).toBeInTheDocument();
    expect(screen.getByText("findings.comparison.previousSize")).toBeInTheDocument();
    expect(screen.getByText("findings.comparison.sizeChange")).toBeInTheDocument();
    expect(screen.getByText("x2")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    buttons[0].click();
    buttons[1].click();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renders unchanged size trend for known comparison", () => {
    render(
      <FindingRow
        finding={makeFinding({ severity: "mild", confidence: 0.95, size_mm: 3 })}
        comparison={makeComparison({ isNew: false, previousSize: 3 })}
      />,
    );

    expect(screen.getByText("findings.comparison.known (4)")).toBeInTheDocument();
    expect(screen.getByText(/findings\.comparison\.unchanged/)).toBeInTheDocument();
  });

  it("renders downward size change and no laterality badge for 'none'", () => {
    render(
      <FindingRow
        finding={makeFinding({
          laterality: "none",
          severity: "unknown",
          confidence: 0.95,
          size_mm: 2,
          count: 1,
        })}
        comparison={makeComparison({ previousSize: 5 })}
      />,
    );

    expect(screen.getByText("findings.comparison.sizeChange")).toBeInTheDocument();
    expect(screen.queryByText("findings.lateralityOptions.left")).toBeNull();
    expect(screen.getByText("findings.severityOptions.unknown")).toBeInTheDocument();
    expect(screen.queryByText("x1")).toBeNull();
  });

  it("supports fallback history link based on finding type text and new badge branch", () => {
    render(
      <FindingRow
        finding={makeFinding({
          finding_code: null,
          finding_type_text: "free text finding",
          site_code: null,
          catalog_finding_name_ru: null,
          catalog_site_name_ru: null,
          body_site_text: null,
        })}
        comparison={makeComparison({ isNew: true })}
      />,
    );

    expect(screen.getByText("findings.comparison.new")).toBeInTheDocument();
    const historyLink = screen.getByRole("link");
    expect(historyLink.getAttribute("href")).toBe("/health/findings/free%20text%20finding");
  });
});

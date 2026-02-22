import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FindingsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  usePersonFindingHistory: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  usePersonFindingHistory: (...args: unknown[]) => hookMocks.usePersonFindingHistory(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (
    selector?: ((state: { selectedPersonId: string | null }) => unknown) | undefined,
  ) => {
    const state = { selectedPersonId: selectedPersonIdState };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

vi.mock("@/components/findings", () => ({
  FindingCard: ({ finding }: { finding: { finding_type_text: string } }) => (
    <div>card:{finding.finding_type_text}</div>
  ),
}));

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    finding_type_text: "Nodule",
    finding_code: "NOD",
    body_site_text: "Lung",
    site_code: "lung",
    catalog_finding_name_ru: null,
    catalog_site_name_ru: null,
    latest_size_mm: 4,
    latest_severity: "mild",
    latest_laterality: "left",
    occurrence_count: 2,
    is_resolved: false,
    ...overrides,
  };
}

describe("FindingsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    hookMocks.usePersonFindingHistory.mockReturnValue({
      data: [],
      isLoading: false,
    });
  });

  it("renders person prompt, loading state, and empty state", () => {
    selectedPersonIdState = null;
    const noPerson = render(<FindingsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
    noPerson.unmount();

    selectedPersonIdState = "person-1";
    hookMocks.usePersonFindingHistory.mockReturnValueOnce({
      data: [],
      isLoading: true,
    });
    const loading = render(<FindingsPage />);
    expect(loading.container.querySelector(".animate-pulse")).toBeTruthy();
    loading.unmount();

    hookMocks.usePersonFindingHistory.mockReturnValueOnce({
      data: [],
      isLoading: false,
    });
    render(<FindingsPage />);
    expect(screen.getByText("findings.noFindings")).toBeInTheDocument();
    expect(screen.getByText("findings.noFindingsDescription")).toBeInTheDocument();
  });

  it("renders active and resolved sections, supports table view and search", async () => {
    hookMocks.usePersonFindingHistory.mockReturnValue({
      data: [
        makeFinding({ finding_type_text: "Active finding", is_resolved: false }),
        makeFinding({
          finding_type_text: "Resolved finding",
          is_resolved: true,
          latest_laterality: "none",
        }),
      ],
      isLoading: false,
    });

    render(<FindingsPage />);
    const user = userEvent.setup();

    expect(screen.getByText("findings.activeSection (1)")).toBeInTheDocument();
    expect(screen.getByText("findings.resolvedSection (1)")).toBeInTheDocument();
    expect(screen.getByText("card:Active finding")).toBeInTheDocument();
    expect(screen.getByText("card:Resolved finding")).toBeInTheDocument();

    await user.click(screen.getByLabelText("findings.tableView"));
    expect(screen.getAllByText("findings.findingType").length).toBeGreaterThan(0);
    expect(screen.getAllByText("findings.bodySite").length).toBeGreaterThan(0);
    expect(screen.getByText("findings.resolved")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("findings.searchPlaceholder"), "nod");
    expect(hookMocks.usePersonFindingHistory).toHaveBeenLastCalledWith("person-1", "nod");
  });

  it("shows all-resolved summary when active section is empty", () => {
    hookMocks.usePersonFindingHistory.mockReturnValue({
      data: [makeFinding({ finding_type_text: "Resolved only", is_resolved: true })],
      isLoading: false,
    });

    render(<FindingsPage />);
    expect(screen.getByText("findings.allResolved")).toBeInTheDocument();
  });
});

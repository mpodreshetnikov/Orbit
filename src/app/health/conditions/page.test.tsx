import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConditionsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  usePersonConditionsWithHistory: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/hooks", () => ({
  usePersonConditionsWithHistory: (...args: unknown[]) =>
    hookMocks.usePersonConditionsWithHistory(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (
    selector?: ((state: { selectedPersonId: string | null }) => unknown) | undefined,
  ) => {
    const state = { selectedPersonId: selectedPersonIdState };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

vi.mock("@/components/conditions/condition-card", () => ({
  ConditionCard: ({ condition }: { condition: { name: string } }) => (
    <div>card:{condition.name}</div>
  ),
}));

function makeCondition(overrides: Record<string, unknown> = {}) {
  return {
    id: "cond-1",
    name: "Hypertension",
    code: "I10",
    icd_name_en: "Essential hypertension",
    current_status: "active",
    mention_count: 2,
    onset_date: "2025-01-01",
    first_mentioned_date: "2025-01-01",
    last_mentioned_date: "2025-01-10",
    ...overrides,
  };
}

describe("ConditionsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    hookMocks.usePersonConditionsWithHistory.mockReturnValue({
      data: [],
      isLoading: false,
    });
  });

  it("renders person prompt, loading state, and empty state", () => {
    selectedPersonIdState = null;
    const noPerson = render(<ConditionsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
    noPerson.unmount();

    selectedPersonIdState = "person-1";
    hookMocks.usePersonConditionsWithHistory.mockReturnValueOnce({
      data: [],
      isLoading: true,
    });
    const loading = render(<ConditionsPage />);
    expect(loading.container.querySelector(".animate-pulse")).toBeTruthy();
    loading.unmount();

    hookMocks.usePersonConditionsWithHistory.mockReturnValueOnce({
      data: [],
      isLoading: false,
    });
    render(<ConditionsPage />);
    expect(screen.getByText("conditions.noConditions")).toBeInTheDocument();
    expect(screen.getByText("conditions.noConditionsHint")).toBeInTheDocument();
  });

  it("renders grouped sections, status tips toggle, table view, and search", async () => {
    hookMocks.usePersonConditionsWithHistory.mockReturnValue({
      data: [
        makeCondition({ id: "a", name: "Active cond", current_status: "active" }),
        makeCondition({ id: "s", name: "Suspected cond", current_status: "suspected" }),
        makeCondition({ id: "r", name: "Resolved cond", current_status: "resolved" }),
      ],
      isLoading: false,
    });

    render(<ConditionsPage />);
    const user = userEvent.setup();

    expect(screen.getByText("conditions.activeSection (1)")).toBeInTheDocument();
    expect(screen.getByText("conditions.suspectedSection (1)")).toBeInTheDocument();
    expect(screen.getByText("conditions.resolvedSection (1)")).toBeInTheDocument();
    expect(screen.getByText("card:Active cond")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "conditions.statusTips.title" }));
    expect(screen.getByText("conditions.statusTips.active")).toBeInTheDocument();
    expect(screen.getByText("conditions.statusTips.history")).toBeInTheDocument();

    await user.click(screen.getByLabelText("conditions.tableView"));
    expect(screen.getAllByText("conditions.name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("conditions.statusLabel").length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText("conditions.searchPlaceholder"), "active");
    expect(screen.getByText("Active cond")).toBeInTheDocument();
    expect(screen.queryByText("Suspected cond")).toBeNull();
  });

  it("shows all-resolved message when only inactive groups remain", () => {
    hookMocks.usePersonConditionsWithHistory.mockReturnValue({
      data: [
        makeCondition({ id: "r", name: "Resolved cond", current_status: "resolved" }),
        makeCondition({ id: "h", name: "History cond", current_status: "history" }),
      ],
      isLoading: false,
    });

    render(<ConditionsPage />);
    expect(screen.getByText("conditions.allResolved")).toBeInTheDocument();
  });
});

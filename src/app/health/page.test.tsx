import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HealthPage from "./page";

let selectedPersonIdState: string | null = null;
const usePersonsMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  usePersons: (...args: unknown[]) => usePersonsMock(...args),
}));

vi.mock("@/components/records", () => ({
  RecordsList: ({ personId, personName }: { personId: string; personName: string }) => (
    <div>
      records-list:{personId}:{personName}
    </div>
  ),
}));

describe("health page", () => {
  beforeEach(() => {
    selectedPersonIdState = null;
    usePersonsMock.mockReset();
    usePersonsMock.mockReturnValue({ data: [] });
  });

  it("shows empty-selection state when person is not selected", () => {
    render(<HealthPage />);
    expect(screen.getByText("person.noPerson")).toBeInTheDocument();
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("renders records list for selected person", () => {
    selectedPersonIdState = "person-1";
    usePersonsMock.mockReturnValue({
      data: [
        { id: "person-1", name: "Alex" },
        { id: "person-2", name: "Luna" },
      ],
    });

    render(<HealthPage />);
    expect(screen.getByText("records-list:person-1:Alex")).toBeInTheDocument();
  });
});

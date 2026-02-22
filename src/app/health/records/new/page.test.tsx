import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewRecordPage from "./page";

let selectedPersonIdState: string | null = "person-1";
const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const usePersonsMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  usePersons: (...args: unknown[]) => usePersonsMock(...args),
}));

vi.mock("@/components/records", () => ({
  AddRecordWizard: ({ personId, personName }: { personId: string; personName: string }) => (
    <div>
      add-record-wizard:{personId}:{personName}
    </div>
  ),
}));

describe("new record page", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    routerMock.push.mockReset();
    usePersonsMock.mockReset();
  });

  it("renders loading state", () => {
    usePersonsMock.mockReturnValue({ data: undefined, isLoading: true });
    render(<NewRecordPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows empty state and redirects when no selected person exists", async () => {
    selectedPersonIdState = "person-missing";
    usePersonsMock.mockReturnValue({
      data: [{ id: "person-1", name: "Alex" }],
      isLoading: false,
    });

    render(<NewRecordPage />);
    expect(screen.getByText("person.noPerson")).toBeInTheDocument();
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/health"));
  });

  it("renders add-record wizard for selected person", () => {
    selectedPersonIdState = "person-1";
    usePersonsMock.mockReturnValue({
      data: [
        { id: "person-1", name: "Alex" },
        { id: "person-2", name: "Luna" },
      ],
      isLoading: false,
    });

    render(<NewRecordPage />);
    expect(screen.getByText("add-record-wizard:person-1:Alex")).toBeInTheDocument();
  });
});

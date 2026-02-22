import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewCheckupPage from "./page";

let selectedPersonIdState: string | null = "person-1";
const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const useCreateCheckupItemMock = vi.fn();
const usePersonConditionsMock = vi.fn();

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
  useCreateCheckupItem: (...args: unknown[]) => useCreateCheckupItemMock(...args),
  usePersonConditions: (...args: unknown[]) => usePersonConditionsMock(...args),
}));

vi.mock("@/components/checkups", () => ({
  CheckupForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      checkup-form
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            person_id: "person-1",
            title: "CBC",
            category: "lab",
            schedule: { cadence: "yearly" },
          })
        }
      >
        submit-checkup
      </button>
      <button type="button" onClick={onCancel}>
        cancel-checkup
      </button>
    </div>
  ),
}));

describe("new checkup page", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    routerMock.push.mockReset();
    usePersonConditionsMock.mockReset();
    useCreateCheckupItemMock.mockReset();

    usePersonConditionsMock.mockReturnValue({ data: [] });
    useCreateCheckupItemMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "checkup-1" }),
      isPending: false,
    });
  });

  it("renders person prompt when person is not selected", () => {
    selectedPersonIdState = null;
    render(<NewCheckupPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("submits new checkup and supports cancel navigation", async () => {
    const mutation = {
      mutateAsync: vi.fn().mockResolvedValue({ id: "checkup-1" }),
      isPending: false,
    };
    useCreateCheckupItemMock.mockReturnValue(mutation);

    render(<NewCheckupPage />);
    expect(screen.getByText("checkup-form")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit-checkup" }));
    await waitFor(() => {
      expect(mutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          title: "CBC",
        }),
      );
      expect(routerMock.push).toHaveBeenCalledWith("/health/checkups/checkup-1");
    });

    await user.click(screen.getByRole("button", { name: "cancel-checkup" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/checkups");
  });
});

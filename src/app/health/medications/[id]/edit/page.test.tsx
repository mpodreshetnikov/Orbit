import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditMedicationPage from "./page";

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const useRegimenMock = vi.fn();
const useUpdateRegimenMock = vi.fn();
const regenerateMedicationEventsMock = vi.fn();
const getClientTimezoneMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks", () => ({
  useRegimen: (...args: unknown[]) => useRegimenMock(...args),
  useUpdateRegimen: (...args: unknown[]) => useUpdateRegimenMock(...args),
}));

vi.mock("@/lib/medication-events", () => ({
  regenerateMedicationEvents: (...args: unknown[]) => regenerateMedicationEventsMock(...args),
  getClientTimezone: (...args: unknown[]) => getClientTimezoneMock(...args),
}));

vi.mock("@/components/medications", () => ({
  MedicationForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      medication-form-edit
      <button type="button" onClick={() => void onSubmit({ notes: "updated" })}>
        submit-medication-edit
      </button>
      <button type="button" onClick={onCancel}>
        cancel-medication-edit
      </button>
    </div>
  ),
}));

function resolvedParams<T>(value: T): Promise<T> {
  return {
    then: (resolve: (v: T) => unknown) => resolve(value),
  } as unknown as Promise<T>;
}

describe("edit medication page", () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    useRegimenMock.mockReset();
    useUpdateRegimenMock.mockReset();
    regenerateMedicationEventsMock.mockReset();
    getClientTimezoneMock.mockReset();

    getClientTimezoneMock.mockReturnValue("UTC");
    useUpdateRegimenMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
  });

  it("renders loading state when regimen is loading", () => {
    useRegimenMock.mockReturnValue({ data: null, isLoading: true, error: null });
    const { container } = render(<EditMedicationPage params={resolvedParams({ id: "reg-1" })} />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders error state when error exists and regimen is present", () => {
    useRegimenMock.mockReturnValue({
      data: { id: "reg-1", person_id: "person-1" },
      isLoading: false,
      error: new Error("boom"),
    });

    render(<EditMedicationPage params={resolvedParams({ id: "reg-1" })} />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("submits updates, regenerates events, and supports cancel", async () => {
    const mutation = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    };
    useUpdateRegimenMock.mockReturnValue(mutation);
    useRegimenMock.mockReturnValue({
      data: {
        id: "reg-1",
        person_id: "person-1",
      },
      isLoading: false,
      error: null,
    });

    render(<EditMedicationPage params={resolvedParams({ id: "reg-1" })} />);
    expect(screen.getByText("medication-form-edit")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit-medication-edit" }));

    await waitFor(() => {
      expect(mutation.mutateAsync).toHaveBeenCalledWith({
        id: "reg-1",
        updates: { notes: "updated" },
      });
      expect(getClientTimezoneMock).toHaveBeenCalled();
      expect(regenerateMedicationEventsMock).toHaveBeenCalledWith("UTC", "person-1");
      expect(routerMock.push).toHaveBeenCalledWith("/health/medications/reg-1");
    });

    await user.click(screen.getByRole("button", { name: "cancel-medication-edit" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/medications/reg-1");
  });
});

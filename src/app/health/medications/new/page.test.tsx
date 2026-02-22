import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewMedicationPage from "./page";

let selectedPersonIdState: string | null = "person-1";
let kindParamState: string | null = null;

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const useCreateRegimenMock = vi.fn();
const useAddOneTimeDoseToRegimenMock = vi.fn();
const regenerateMedicationEventsMock = vi.fn();
const getClientTimezoneMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => ({
    get: (key: string) => (key === "kind" ? kindParamState : null),
  }),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useCreateRegimen: (...args: unknown[]) => useCreateRegimenMock(...args),
  useAddOneTimeDoseToRegimen: (...args: unknown[]) => useAddOneTimeDoseToRegimenMock(...args),
}));

vi.mock("@/lib/medication-events", () => ({
  regenerateMedicationEvents: (...args: unknown[]) => regenerateMedicationEventsMock(...args),
  getClientTimezone: (...args: unknown[]) => getClientTimezoneMock(...args),
}));

vi.mock("@/components/medications", () => ({
  MedicationForm: ({
    defaultKind,
    onSubmit,
    onCancel,
  }: {
    defaultKind: string;
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      medication-form:{defaultKind}
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            person_id: "person-1",
            custom_name: "Vitamin D",
            intake_unit: "pill",
            schedule: { type: "daily" },
            duration: { type: "ongoing" },
          })
        }
      >
        submit-create-regimen
      </button>
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            addToRegimenId: "reg-existing",
            scheduled_at: "2026-02-01T09:00:00.000Z",
            amount: 1,
            unit: "pill",
            notes: "with food",
          })
        }
      >
        submit-add-onetime
      </button>
      <button type="button" onClick={onCancel}>
        cancel-medication
      </button>
    </div>
  ),
}));

describe("new medication page", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    kindParamState = null;

    routerMock.push.mockReset();
    useCreateRegimenMock.mockReset();
    useAddOneTimeDoseToRegimenMock.mockReset();
    regenerateMedicationEventsMock.mockReset();
    getClientTimezoneMock.mockReset();

    getClientTimezoneMock.mockReturnValue("UTC");
    useCreateRegimenMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "reg-1", person_id: "person-1" }),
      isPending: false,
    });
    useAddOneTimeDoseToRegimenMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
  });

  it("renders person prompt when no person selected", () => {
    selectedPersonIdState = null;
    render(<NewMedicationPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("submits create-regimen flow and navigates to created regimen", async () => {
    kindParamState = "invalid";
    const createMutation = {
      mutateAsync: vi.fn().mockResolvedValue({ id: "reg-1", person_id: "person-1" }),
      isPending: false,
    };
    useCreateRegimenMock.mockReturnValue(createMutation);

    render(<NewMedicationPage />);
    expect(screen.getByText("medication-form:regular")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit-create-regimen" }));

    await waitFor(() => {
      expect(createMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          custom_name: "Vitamin D",
        }),
      );
      expect(getClientTimezoneMock).toHaveBeenCalled();
      expect(regenerateMedicationEventsMock).toHaveBeenCalledWith("UTC", "person-1");
      expect(routerMock.push).toHaveBeenCalledWith("/health/medications/reg-1");
    });
  });

  it("submits add-one-time-to-existing flow and supports cancel", async () => {
    kindParamState = "one_time";
    const addMutation = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    };
    useAddOneTimeDoseToRegimenMock.mockReturnValue(addMutation);

    render(<NewMedicationPage />);
    expect(screen.getByText("medication-form:one_time")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit-add-onetime" }));

    await waitFor(() => {
      expect(addMutation.mutateAsync).toHaveBeenCalledWith({
        person_id: "person-1",
        regimen_id: "reg-existing",
        scheduled_at: "2026-02-01T09:00:00.000Z",
        amount: 1,
        unit: "pill",
        notes: "with food",
      });
      expect(routerMock.push).toHaveBeenCalledWith("/health/medications/reg-existing");
    });

    await user.click(screen.getByRole("button", { name: "cancel-medication" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/medications");
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObservationEditDialog } from "./observation-edit-dialog";

const hookMocks = vi.hoisted(() => ({
  useCreateObservation: vi.fn(),
  useUpdateObservation: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useCreateObservation: (...args: unknown[]) => hookMocks.useCreateObservation(...args),
  useUpdateObservation: (...args: unknown[]) => hookMocks.useUpdateObservation(...args),
}));

function createMutationMock() {
  return {
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ObservationEditDialog", () => {
  beforeEach(() => {
    hookMocks.useCreateObservation.mockReset();
    hookMocks.useUpdateObservation.mockReset();
    hookMocks.useCreateObservation.mockReturnValue(createMutationMock());
    hookMocks.useUpdateObservation.mockReturnValue(createMutationMock());
  });

  it("creates observation with synonyms and accepted units", async () => {
    const createMutation = createMutationMock();
    hookMocks.useCreateObservation.mockReturnValue(createMutation);
    const onOpenChange = vi.fn();

    render(<ObservationEditDialog open onOpenChange={onOpenChange} observation={null} />);

    fireEvent.change(screen.getByLabelText("catalogs.obsCode"), { target: { value: "glucose" } });
    fireEvent.change(screen.getByLabelText("catalogs.canonicalUnit"), {
      target: { value: "mmol/L" },
    });
    fireEvent.change(screen.getByLabelText("catalogs.nameRu"), { target: { value: "Глюкоза" } });
    fireEvent.change(screen.getByLabelText("catalogs.nameEn"), { target: { value: "Glucose" } });
    fireEvent.change(screen.getByLabelText("catalogs.notes"), { target: { value: "important" } });
    fireEvent.change(screen.getByLabelText("catalogs.refLow"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("catalogs.refHigh"), { target: { value: "6" } });

    const synonymInputs = screen.getAllByPlaceholderText("catalogs.addSynonym");
    fireEvent.change(synonymInputs[0], { target: { value: "сахар" } });
    fireEvent.keyDown(synonymInputs[0], { key: "Enter", code: "Enter" });
    fireEvent.change(synonymInputs[1], { target: { value: "sugar" } });
    fireEvent.keyDown(synonymInputs[1], { key: "Enter", code: "Enter" });
    const addUnitInput = screen.getByPlaceholderText("catalogs.addUnit");
    fireEvent.change(addUnitInput, { target: { value: "mmol" } });
    fireEvent.keyDown(addUnitInput, { key: "Enter", code: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(createMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        obs_code: "glucose",
        name_ru: "Глюкоза",
        name_en: "Glucose",
        canonical_unit: "mmol/L",
        synonyms_ru: ["сахар"],
        synonyms_en: ["sugar"],
        accepted_units: {
          mmol: { factor_to_canonical: 1 },
        },
        default_ref_low: 4,
        default_ref_high: 6,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 15000);

  it("updates existing observation and keeps code field disabled", async () => {
    const updateMutation = createMutationMock();
    hookMocks.useUpdateObservation.mockReturnValue(updateMutation);
    const onOpenChange = vi.fn();

    render(
      <ObservationEditDialog
        open
        onOpenChange={onOpenChange}
        observation={
          {
            id: "obs-1",
            obs_code: "glucose",
            name_ru: "Глюкоза",
            name_en: "Glucose",
            canonical_unit: "mmol/L",
            synonyms_ru: ["сахар"],
            synonyms_en: ["sugar"],
            accepted_units: {
              mmol: { factor_to_canonical: 1 },
            },
            notes: "old",
            default_ref_low: 4,
            default_ref_high: 6,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          } as import("@/types").ObservationCatalog
        }
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("catalogs.obsCode")).toHaveValue("glucose"));
    expect(screen.getByLabelText("catalogs.obsCode")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("catalogs.nameEn"), {
      target: { value: "Serum glucose" },
    });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "obs-1",
        updates: expect.objectContaining({
          name_en: "Serum glucose",
          obs_code: "glucose",
        }),
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 15000);
});

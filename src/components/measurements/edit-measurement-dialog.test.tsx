import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementHistoryPoint } from "@/types";

const hookMocks = vi.hoisted(() => ({
  useUpdateMeasurement: vi.fn(),
  useMeasurementCatalogItem: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useUpdateMeasurement: (...args: unknown[]) => hookMocks.useUpdateMeasurement(...args),
  useMeasurementCatalogItem: (...args: unknown[]) => hookMocks.useMeasurementCatalogItem(...args),
}));

function mutationMock() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  };
}

const measurement = {
  id: "m-1",
  person_id: "person-1",
  code: "weight",
  name: "Weight",
  value: 72.5,
  unit: "kg",
  measured_at: "2026-02-20T10:30:00.000Z",
  notes: "  initial note  ",
  created_at: "2026-02-20T10:30:00.000Z",
} as MeasurementHistoryPoint;

describe("EditMeasurementDialog", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    hookMocks.useMeasurementCatalogItem.mockReturnValue({
      data: { id: "catalog-1", unit_en: "kg", unit_ru: "кг" },
    });
    hookMocks.useUpdateMeasurement.mockReturnValue(mutationMock());
  });

  it(
    "renders initial data and submits updated measurement payload",
    async () => {
      const onOpenChange = vi.fn();
      const updateMutation = mutationMock();
      hookMocks.useUpdateMeasurement.mockReturnValue(updateMutation);

      const { EditMeasurementDialog } = await import("./edit-measurement-dialog");
      render(
        <EditMeasurementDialog
          open
          onOpenChange={onOpenChange}
          personId="person-1"
          measurement={measurement}
          catalogId="catalog-1"
        />,
      );

      expect(screen.getByDisplayValue("72.5")).toBeInTheDocument();
      expect(screen.getByLabelText("measurements.notes")).toHaveValue(
        "  initial note  ",
      );
      expect(screen.getByText("kg")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.clear(screen.getByLabelText("measurements.value"));
      await user.type(screen.getByLabelText("measurements.value"), "73.1");
      await user.clear(screen.getByLabelText("measurements.notes"));
      await user.type(screen.getByLabelText("measurements.notes"), "  updated  ");
      await user.click(screen.getByRole("button", { name: "common.save" }));

      await waitFor(() =>
        expect(updateMutation.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "m-1",
            personId: "person-1",
            updates: expect.objectContaining({
              value: 73.1,
              notes: "updated",
            }),
          }),
        ),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
    20000,
  );

  it("uses RU locale unit label and closes from cancel", async () => {
    document.documentElement.lang = "ru";
    const onOpenChange = vi.fn();

    const { EditMeasurementDialog } = await import("./edit-measurement-dialog");
    render(
      <EditMeasurementDialog
        open
        onOpenChange={onOpenChange}
        personId="person-1"
        measurement={measurement}
        catalogId="catalog-1"
      />,
    );

    expect(screen.getByText("кг")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores submit when required context is missing", async () => {
    const onOpenChange = vi.fn();
    const updateMutation = mutationMock();
    hookMocks.useUpdateMeasurement.mockReturnValue(updateMutation);

    const { EditMeasurementDialog } = await import("./edit-measurement-dialog");
    const { rerender } = render(
      <EditMeasurementDialog
        open
        onOpenChange={onOpenChange}
        personId={null}
        measurement={measurement}
        catalogId="catalog-1"
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "common.save" }));
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();

    rerender(
      <EditMeasurementDialog
        open
        onOpenChange={onOpenChange}
        personId="person-1"
        measurement={null}
        catalogId="catalog-1"
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "common.save" }));
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("handles update mutation error without closing dialog", async () => {
    const onOpenChange = vi.fn();
    const updateMutation = {
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error("failed")),
    };
    hookMocks.useUpdateMeasurement.mockReturnValue(updateMutation);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { EditMeasurementDialog } = await import("./edit-measurement-dialog");
    render(
      <EditMeasurementDialog
        open
        onOpenChange={onOpenChange}
        personId="person-1"
        measurement={measurement}
        catalogId="catalog-1"
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateMutation.mutateAsync).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    errorSpy.mockRestore();
  });
});

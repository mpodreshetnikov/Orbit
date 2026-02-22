import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementCatalog } from "@/types";

const hookMocks = vi.hoisted(() => ({
  useCreateMeasurementCatalogItem: vi.fn(),
  useUpdateMeasurementCatalogItem: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useCreateMeasurementCatalogItem: (...args: unknown[]) =>
    hookMocks.useCreateMeasurementCatalogItem(...args),
  useUpdateMeasurementCatalogItem: (...args: unknown[]) =>
    hookMocks.useUpdateMeasurementCatalogItem(...args),
}));

function mutationMock() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MeasurementCatalogEditDialog", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    document.documentElement.lang = "en";
    hookMocks.useCreateMeasurementCatalogItem.mockReturnValue(mutationMock());
    hookMocks.useUpdateMeasurementCatalogItem.mockReturnValue(mutationMock());
  });

  it("creates a measurement catalog item with normalized code and sort order fallback", async () => {
    const createMutation = mutationMock();
    hookMocks.useCreateMeasurementCatalogItem.mockReturnValue(createMutation);
    const onOpenChange = vi.fn();

    const { MeasurementCatalogEditDialog } = await import("./measurement-catalog-edit-dialog");
    render(<MeasurementCatalogEditDialog open onOpenChange={onOpenChange} measurement={null} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("catalogs.measurementCode"), "  WEIGHT_1  ");
    await user.type(screen.getByLabelText("catalogs.nameEn"), "Weight");
    await user.type(screen.getByLabelText("catalogs.nameRu"), "Weight RU");
    await user.type(screen.getByLabelText("catalogs.unitEn"), "kg");
    await user.type(screen.getByLabelText("catalogs.unitRu"), "kg-ru");
    await user.clear(screen.getByLabelText("catalogs.sortOrder"));

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalled());
    const [payload] = createMutation.mutateAsync.mock.lastCall ?? [];
    expect(payload).toMatchObject({
      code: "weight_1",
      name_en: "Weight",
      name_ru: "Weight RU",
      unit_en: "kg",
      unit_ru: "kg-ru",
      category: "body",
      sort_order: 0,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 15_000);

  it("updates existing catalog item and keeps code field disabled", async () => {
    const updateMutation = mutationMock();
    hookMocks.useUpdateMeasurementCatalogItem.mockReturnValue(updateMutation);
    const onOpenChange = vi.fn();

    const { MeasurementCatalogEditDialog } = await import("./measurement-catalog-edit-dialog");
    render(
      <MeasurementCatalogEditDialog
        open
        onOpenChange={onOpenChange}
        measurement={
          {
            id: "cat-1",
            code: "height",
            name_en: "Height",
            name_ru: "Height RU",
            unit_en: "cm",
            unit_ru: "cm-ru",
            category: "body",
            sort_order: 2,
          } as MeasurementCatalog
        }
      />,
    );

    const codeInput = screen.getByLabelText("catalogs.measurementCode");
    expect(codeInput).toBeDisabled();

    const user = userEvent.setup();
    const nameEnInput = screen.getByLabelText("catalogs.nameEn");
    await user.clear(nameEnInput);
    await waitFor(() => expect(nameEnInput).toHaveValue(""));
    await user.type(nameEnInput, "Height updated");
    await waitFor(() => expect(nameEnInput).toHaveValue("Height updated"));
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalled());
    const [payload] = updateMutation.mutateAsync.mock.lastCall ?? [];
    expect(payload).toMatchObject({
      id: "cat-1",
      updates: expect.objectContaining({
        code: "height",
        name_en: "Height updated",
        sort_order: 2,
      }),
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("logs mutation errors and keeps dialog open", async () => {
    const createMutation = {
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error("save failed")),
    };
    hookMocks.useCreateMeasurementCatalogItem.mockReturnValue(createMutation);
    const onOpenChange = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { MeasurementCatalogEditDialog } = await import("./measurement-catalog-edit-dialog");
    render(<MeasurementCatalogEditDialog open onOpenChange={onOpenChange} measurement={null} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("catalogs.measurementCode"), "weight");
    await user.type(screen.getByLabelText("catalogs.nameEn"), "Weight");
    await user.type(screen.getByLabelText("catalogs.nameRu"), "Weight RU");
    await user.type(screen.getByLabelText("catalogs.unitEn"), "kg");
    await user.type(screen.getByLabelText("catalogs.unitRu"), "kg-ru");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createMutation.mutateAsync).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    errorSpy.mockRestore();
  });

  it("disables save and shows spinner when mutation is pending", async () => {
    hookMocks.useCreateMeasurementCatalogItem.mockReturnValue({
      isPending: true,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
    });
    const onOpenChange = vi.fn();

    const { MeasurementCatalogEditDialog } = await import("./measurement-catalog-edit-dialog");
    render(<MeasurementCatalogEditDialog open onOpenChange={onOpenChange} measurement={null} />);

    const saveButton = screen.getByRole("button", { name: "common.save" });
    expect(saveButton).toBeDisabled();
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });
});

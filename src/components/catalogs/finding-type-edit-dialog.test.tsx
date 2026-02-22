import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindingTypeEditDialog } from "./finding-type-edit-dialog";

const hookMocks = vi.hoisted(() => ({
  useCreateFindingType: vi.fn(),
  useUpdateFindingType: vi.fn(),
}));

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useCreateFindingType: (...args: unknown[]) => hookMocks.useCreateFindingType(...args),
  useUpdateFindingType: (...args: unknown[]) => hookMocks.useUpdateFindingType(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

describe("FindingTypeEditDialog", () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
    updateMutateAsync.mockReset();
    createMutateAsync.mockResolvedValue(undefined);
    updateMutateAsync.mockResolvedValue(undefined);

    hookMocks.useCreateFindingType.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateFindingType.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
  });

  it("creates a finding type with normalized code and synonyms", async () => {
    render(<FindingTypeEditDialog open onOpenChange={vi.fn()} findingType={null} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("catalogs.code"), "POLYP");
    await user.type(screen.getByLabelText("catalogs.nameRu"), "Полип");
    await user.type(screen.getByLabelText("catalogs.nameEn"), "Polyp");

    const synonymInputs = screen.getAllByPlaceholderText("catalogs.addSynonym");
    await user.type(synonymInputs[0], "  RuSyn{enter}");
    await user.type(synonymInputs[1], "EnSyn{enter}");

    await user.type(screen.getByLabelText("catalogs.notes"), "note");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        finding_code: "polyp",
        name_ru: "Полип",
        name_en: "Polyp",
        synonyms_ru: ["rusyn"],
        synonyms_en: ["ensyn"],
        notes: "note",
      });
    });
  });

  it("updates existing finding type", async () => {
    render(
      <FindingTypeEditDialog
        open
        onOpenChange={vi.fn()}
        findingType={{
          id: "ft-1",
          finding_code: "nodule",
          name_ru: "Узелок",
          name_en: "Nodule",
          synonyms_ru: ["узел"],
          synonyms_en: ["node"],
          notes: "old",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("catalogs.nameEn"));
    await user.type(screen.getByLabelText("catalogs.nameEn"), "Updated nodule");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "ft-1",
        updates: expect.objectContaining({
          finding_code: "nodule",
          name_ru: "Узелок",
          name_en: "Updated nodule",
        }),
      });
    });
  });
});

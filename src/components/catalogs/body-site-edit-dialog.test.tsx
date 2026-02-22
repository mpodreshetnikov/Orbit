import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BodySiteCatalog } from "@/types";
import { BodySiteEditDialog } from "./body-site-edit-dialog";

const hookMocks = vi.hoisted(() => ({
  useCreateBodySite: vi.fn(),
  useUpdateBodySite: vi.fn(),
}));

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useCreateBodySite: (...args: unknown[]) => hookMocks.useCreateBodySite(...args),
  useUpdateBodySite: (...args: unknown[]) => hookMocks.useUpdateBodySite(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder ?? "command-input"}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
    value,
    className,
  }: {
    children: React.ReactNode;
    onSelect?: (value: string) => void;
    value?: string;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={() => onSelect?.(value ?? "")}>
      {children}
    </button>
  ),
}));

function bodySite(overrides: Partial<BodySiteCatalog> = {}): BodySiteCatalog {
  return {
    id: "site-1",
    site_code: "kidney",
    name_ru: "Почка",
    name_en: "Kidney",
    parent_site_code: null,
    synonyms_ru: [],
    synonyms_en: [],
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("BodySiteEditDialog", () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
    updateMutateAsync.mockReset();
    createMutateAsync.mockResolvedValue(undefined);
    updateMutateAsync.mockResolvedValue(undefined);

    hookMocks.useCreateBodySite.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateBodySite.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
  });

  it("creates a new body-site entry with parent and synonyms", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <BodySiteEditDialog
        open
        onOpenChange={onOpenChange}
        bodySite={null}
        allSites={[
          bodySite({ id: "parent-1", site_code: "abdomen", name_ru: "Живот", name_en: "Abdomen" }),
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("catalogs.code"), {
      target: { value: "Kidney_Left" },
    });
    fireEvent.change(screen.getByLabelText("catalogs.nameRu"), {
      target: { value: "Левая почка" },
    });
    fireEvent.change(screen.getByLabelText("catalogs.nameEn"), {
      target: { value: "Left kidney" },
    });

    await user.click(screen.getByRole("button", { name: /Живот/ }));

    const synonymInputs = screen.getAllByPlaceholderText("catalogs.addSynonym");
    fireEvent.change(synonymInputs[0], { target: { value: "Почка слева" } });
    fireEvent.keyDown(synonymInputs[0], { key: "Enter" });
    fireEvent.change(synonymInputs[1], { target: { value: "Left renal" } });
    fireEvent.keyDown(synonymInputs[1], { key: "Enter" });

    fireEvent.change(screen.getByLabelText("catalogs.notes"), {
      target: { value: "custom note" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        site_code: "kidney_left",
        name_ru: "Левая почка",
        name_en: "Left kidney",
        parent_site_code: "abdomen",
        synonyms_ru: ["почка слева"],
        synonyms_en: ["left renal"],
        notes: "custom note",
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("updates existing site and supports clearing parent", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <BodySiteEditDialog
        open
        onOpenChange={onOpenChange}
        bodySite={bodySite({
          id: "site-2",
          site_code: "kidney_left",
          name_ru: "Левая почка",
          name_en: "Left kidney",
          parent_site_code: "abdomen",
          synonyms_ru: ["почка слева"],
          synonyms_en: ["left renal"],
          notes: "old note",
        })}
        allSites={[
          bodySite({ id: "parent-1", site_code: "abdomen", name_ru: "Живот", name_en: "Abdomen" }),
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("catalogs.nameEn"), {
      target: { value: "Left kidney updated" },
    });
    await user.click(screen.getByRole("button", { name: "catalogs.noParent" }));

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "site-2",
        updates: {
          site_code: "kidney_left",
          name_ru: "Левая почка",
          name_en: "Left kidney updated",
          parent_site_code: null,
          synonyms_ru: ["почка слева"],
          synonyms_en: ["left renal"],
          notes: "old note",
        },
      });
    });
  });
});

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingEditDialog } from "./finding-edit-dialog";

const hookMocks = vi.hoisted(() => ({
  useFindingTypeCatalog: vi.fn(),
  useBodySiteCatalog: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useFindingTypeCatalog: (...args: unknown[]) => hookMocks.useFindingTypeCatalog(...args),
  useBodySiteCatalog: (...args: unknown[]) => hookMocks.useBodySiteCatalog(...args),
}));

describe("FindingEditDialog", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    hookMocks.useFindingTypeCatalog.mockReset();
    hookMocks.useBodySiteCatalog.mockReset();
    hookMocks.useFindingTypeCatalog.mockReturnValue({ data: [] });
    hookMocks.useBodySiteCatalog.mockReturnValue({ data: [] });
  });

  it("prefills record date for new finding and submits custom finding payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <FindingEditDialog
        open
        onOpenChange={vi.fn()}
        finding={null}
        recordDate="2026-02-10"
        onSave={onSave}
        isNew
      />,
    );

    expect(screen.getByLabelText("findings.findingDate")).toHaveValue("2026-02-10");

    await user.type(screen.getByLabelText("findings.findingTypeText"), "Nodule");
    await user.type(screen.getByLabelText("findings.bodySiteText"), "Lung");
    await user.type(screen.getByLabelText("findings.size"), "5.2");
    await user.type(screen.getByLabelText("findings.count"), "2");
    await user.type(screen.getByLabelText("findings.sourceAnchor *"), "line 14");
    await user.type(screen.getByLabelText("findings.description"), "small nodule");

    const saveButton = screen.getByRole("button", { name: "common.save" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.lastCall ?? [];
    expect(payload).toMatchObject({
      finding_type_id: null,
      finding_code: null,
      finding_type_text: "Nodule",
      body_site_id: null,
      site_code: null,
      body_site_text: "Lung",
      size_mm: 5.2,
      count: 2,
      severity: "unknown",
      laterality: "none",
      finding_date: "2026-02-10",
      source_anchor: "line 14",
      description: "small nodule",
    });
  }, 15_000);

  it("submits edit payload using selected catalog codes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    hookMocks.useFindingTypeCatalog.mockReturnValue({
      data: [{ id: "ft-1", finding_code: "nodule", name_ru: "Nodule RU", name_en: "Nodule" }],
    });
    hookMocks.useBodySiteCatalog.mockReturnValue({
      data: [{ id: "bs-1", site_code: "lung", name_ru: "Lung RU", name_en: "Lung" }],
    });

    render(
      <FindingEditDialog
        open
        onOpenChange={vi.fn()}
        finding={{
          id: "finding-1",
          finding_type_text: "Nodule RU",
          finding_code: "nodule",
          body_site_text: "Lung RU",
          site_code: "lung",
          severity: "mild",
          laterality: "left",
          size_mm: 3,
          count: 1,
          source_anchor: "old source",
          finding_date: "2026-01-01",
        }}
        onSave={onSave}
        isNew={false}
      />,
    );

    const sourceAnchorInput = screen.getByLabelText("findings.sourceAnchor *");
    await user.clear(sourceAnchorInput);
    await waitFor(() => expect(sourceAnchorInput).toHaveValue(""));
    await user.type(sourceAnchorInput, "updated source");
    await waitFor(() => expect(sourceAnchorInput).toHaveValue("updated source"));

    const saveButton = screen.getByRole("button", { name: "common.save" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.lastCall ?? [];
    expect(payload).toMatchObject({
      finding_type_id: "ft-1",
      finding_code: "nodule",
      body_site_id: "bs-1",
      site_code: "lung",
      finding_type_text: "Nodule RU",
      source_anchor: "updated source",
    });
  });

  it("selects catalog entries, then allows switching back to custom finding", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    hookMocks.useFindingTypeCatalog.mockReturnValue({
      data: [
        {
          id: "ft-1",
          finding_code: "nodule",
          name_ru: "Nodule RU",
          name_en: "Nodule",
          synonyms_ru: ["node"],
          synonyms_en: ["nodule"],
        },
      ],
    });
    hookMocks.useBodySiteCatalog.mockReturnValue({
      data: [
        {
          id: "bs-1",
          site_code: "lung",
          name_ru: "Lung RU",
          name_en: "Lung",
          parent_site_code: "chest",
          synonyms_ru: ["lung"],
          synonyms_en: ["pulmonary"],
        },
      ],
    });

    render(<FindingEditDialog open onOpenChange={vi.fn()} finding={null} onSave={onSave} isNew />);

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByText("Nodule RU"));
    expect(screen.queryByLabelText("findings.findingTypeText")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(await screen.findByText("Lung RU"));
    expect(screen.queryByLabelText("findings.bodySiteText")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByText("findings.customFinding"));

    const findingTypeInput = await screen.findByLabelText("findings.findingTypeText");
    await user.clear(findingTypeInput);
    await user.type(findingTypeInput, "Custom");
    await waitFor(() => expect(findingTypeInput).toHaveValue("Custom"));
    await user.type(screen.getByLabelText("findings.sourceAnchor *"), "source line");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.lastCall ?? [];
    expect(payload).toMatchObject({
      finding_type_id: null,
      finding_code: null,
      finding_type_text: "Custom",
      body_site_id: "bs-1",
      site_code: "lung",
      body_site_text: "Lung RU",
    });
  }, 20_000);

  it("normalizes empty numeric/text fields to null on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<FindingEditDialog open onOpenChange={vi.fn()} finding={null} onSave={onSave} isNew />);

    await user.type(screen.getByLabelText("findings.findingTypeText"), "T");
    await user.type(screen.getByLabelText("findings.sourceAnchor *"), "  anchor  ");
    await user.type(screen.getByLabelText("findings.bodySiteText"), "   ");
    await user.type(screen.getByLabelText("findings.morphology"), "   ");
    await user.type(screen.getByLabelText("findings.description"), "   ");
    await user.type(screen.getByLabelText("findings.histology"), "   ");
    await user.type(screen.getByLabelText("findings.size"), "abc");
    await user.type(screen.getByLabelText("findings.count"), "abc");
    await user.clear(screen.getByLabelText("findings.findingDate"));

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.lastCall ?? [];
    expect(payload).toMatchObject({
      finding_type_text: "T",
      source_anchor: "anchor",
      body_site_text: null,
      morphology: null,
      description: null,
      histology: null,
      size_mm: null,
      count: null,
      finding_date: null,
    });
  });

  it("disables cancel/save actions while saving and still renders title", () => {
    const onOpenChange = vi.fn();
    render(
      <FindingEditDialog
        open
        onOpenChange={onOpenChange}
        finding={null}
        onSave={vi.fn()}
        isNew
        isSaving
      />,
    );

    expect(screen.getByText("findings.add")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });
});

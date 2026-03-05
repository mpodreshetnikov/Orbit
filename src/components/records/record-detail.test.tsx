import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConditionRecordWithDetails,
  ObservationStatus,
  RecordFindingWithCatalog,
  RecordObservationWithCatalog,
} from "@/types";
import type { FindingHistorySummary, ObservationHistorySummary } from "./record-detail";

const hookMocks = vi.hoisted(() => ({
  useMedicalRecord: vi.fn(),
  useSoftDeleteRecord: vi.fn(),
  useRestoreRecord: vi.fn(),
  useHardDeleteRecord: vi.fn(),
  useUpdateMedicalRecord: vi.fn(),
  useRecordObservations: vi.fn(),
  useUpdateRecordObservation: vi.fn(),
  useDeleteRecordObservation: vi.fn(),
  useCreateRecordObservation: vi.fn(),
  useObservationCatalog: vi.fn(),
  useRecordFindings: vi.fn(),
  useUpdateRecordFinding: vi.fn(),
  useDeleteRecordFinding: vi.fn(),
  useCreateRecordFinding: vi.fn(),
  useRecordConditions: vi.fn(),
  usePersonConditions: vi.fn(),
  useUpdateConditionRecord: vi.fn(),
  useDeleteConditionRecord: vi.fn(),
  useCreateConditionWithRecord: vi.fn(),
  useLinkConditionToRecord: vi.fn(),
  usePersonFindingHistory: vi.fn(),
  usePersonConditionRecordHistory: vi.fn(),
  usePersonObservationHistory: vi.fn(),
  useBackgroundOCR: vi.fn(),
  usePersons: vi.fn(),
}));

const routerMock = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks", () => ({
  useMedicalRecord: (...args: unknown[]) => hookMocks.useMedicalRecord(...args),
  useSoftDeleteRecord: (...args: unknown[]) => hookMocks.useSoftDeleteRecord(...args),
  useRestoreRecord: (...args: unknown[]) => hookMocks.useRestoreRecord(...args),
  useHardDeleteRecord: (...args: unknown[]) => hookMocks.useHardDeleteRecord(...args),
  useUpdateMedicalRecord: (...args: unknown[]) => hookMocks.useUpdateMedicalRecord(...args),
  useRecordObservations: (...args: unknown[]) => hookMocks.useRecordObservations(...args),
  useUpdateRecordObservation: (...args: unknown[]) => hookMocks.useUpdateRecordObservation(...args),
  useDeleteRecordObservation: (...args: unknown[]) => hookMocks.useDeleteRecordObservation(...args),
  useCreateRecordObservation: (...args: unknown[]) => hookMocks.useCreateRecordObservation(...args),
  useObservationCatalog: (...args: unknown[]) => hookMocks.useObservationCatalog(...args),
  useRecordFindings: (...args: unknown[]) => hookMocks.useRecordFindings(...args),
  useUpdateRecordFinding: (...args: unknown[]) => hookMocks.useUpdateRecordFinding(...args),
  useDeleteRecordFinding: (...args: unknown[]) => hookMocks.useDeleteRecordFinding(...args),
  useCreateRecordFinding: (...args: unknown[]) => hookMocks.useCreateRecordFinding(...args),
  useRecordConditions: (...args: unknown[]) => hookMocks.useRecordConditions(...args),
  usePersonConditions: (...args: unknown[]) => hookMocks.usePersonConditions(...args),
  useUpdateConditionRecord: (...args: unknown[]) => hookMocks.useUpdateConditionRecord(...args),
  useDeleteConditionRecord: (...args: unknown[]) => hookMocks.useDeleteConditionRecord(...args),
  useCreateConditionWithRecord: (...args: unknown[]) =>
    hookMocks.useCreateConditionWithRecord(...args),
  useLinkConditionToRecord: (...args: unknown[]) => hookMocks.useLinkConditionToRecord(...args),
  usePersonFindingHistory: (...args: unknown[]) => hookMocks.usePersonFindingHistory(...args),
  usePersonConditionRecordHistory: (...args: unknown[]) =>
    hookMocks.usePersonConditionRecordHistory(...args),
  usePersonObservationHistory: (...args: unknown[]) =>
    hookMocks.usePersonObservationHistory(...args),
  useBackgroundOCR: (...args: unknown[]) => hookMocks.useBackgroundOCR(...args),
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
}));

vi.mock("./attachment-preview", () => ({
  AttachmentGrid: () => <div>attachment-grid</div>,
}));

vi.mock("./ocr-review-step", () => ({
  OcrReviewStep: () => <div>ocr-review-step</div>,
}));

vi.mock("./structure-review-step", () => ({
  StructureReviewStep: () => <div>structure-review-step</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/findings", () => ({
  FindingRow: ({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) => (
    <div>
      finding-row
      {onEdit ? (
        <button type="button" onClick={() => onEdit?.()}>
          finding-row-edit
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={() => onDelete?.()}>
          finding-row-delete
        </button>
      ) : null}
    </div>
  ),
  FindingEditDialog: ({
    open,
    onSave,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    onSave?: (data: {
      finding_type_id: string | null;
      finding_code: string | null;
      finding_type_text: string;
      body_site_id: string | null;
      site_code: string | null;
      body_site_text: string | null;
      size_mm: number | null;
      count: number | null;
      severity: "mild" | "moderate" | "severe";
      laterality: "left" | "right" | "bilateral" | "unknown";
      morphology: string | null;
      description: string | null;
      histology: string | null;
      finding_date: string | null;
      source_anchor: string;
    }) => void;
  }) =>
    open ? (
      <div>
        finding-dialog
        <button
          type="button"
          onClick={() =>
            onSave?.({
              finding_type_id: null,
              finding_code: "nodule",
              finding_type_text: "Nodule",
              body_site_id: null,
              site_code: "lung",
              body_site_text: "Lung",
              size_mm: 5,
              count: 1,
              severity: "mild",
              laterality: "left",
              morphology: null,
              description: "desc",
              histology: null,
              finding_date: null,
              source_anchor: "line",
            })
          }
        >
          save-finding-dialog
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/conditions", () => ({
  ConditionRecordRow: ({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) => (
    <div>
      condition-row
      {onEdit ? (
        <button type="button" onClick={() => onEdit?.()}>
          condition-row-edit
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={() => onDelete?.()}>
          condition-row-delete
        </button>
      ) : null}
    </div>
  ),
  ConditionEditDialog: ({
    open,
    isNew,
    onSave,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    isNew?: boolean;
    onSave?: (data: {
      condition_id?: string;
      name?: string;
      code?: string | null;
      icd_name_en?: string | null;
      icd_name_ru?: string | null;
      status_in_record: "active" | "resolved" | "suspected";
      source_anchor: string | null;
    }) => void;
  }) =>
    open ? (
      <div>
        condition-dialog
        {isNew ? (
          <>
            <button
              type="button"
              onClick={() =>
                onSave?.({
                  condition_id: "cond-1",
                  status_in_record: "resolved",
                  source_anchor: "source",
                  code: "J45",
                  icd_name_en: "Asthma",
                })
              }
            >
              save-condition-link
            </button>
            <button
              type="button"
              onClick={() =>
                onSave?.({
                  name: "Created condition",
                  status_in_record: "active",
                  source_anchor: "source",
                })
              }
            >
              save-condition-create
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              onSave?.({
                status_in_record: "active",
                source_anchor: "updated",
                code: "J45",
                icd_name_en: "Asthma",
              })
            }
          >
            save-condition-edit
          </button>
        )}
      </div>
    ) : null,
}));

function createMutationMock() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  };
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "record-1",
    person_id: "person-1",
    title: "CBC Report",
    status: "active",
    record_type: "lab",
    record_date: "2026-01-01",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    notes: "Some notes",
    llm_keywords: ["cbc", "blood"],
    attachments: [],
    ocr_text: "Scanned OCR text",
    ocr_error: null,
    ...overrides,
  };
}

describe("RecordDetail", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.resetModules();
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    hookMocks.useRecordObservations.mockReturnValue({
      data: [
        {
          id: "obs-1",
          record_id: "record-1",
          obs_name: "Glucose",
          obs_code: "glucose",
          value_numeric: 5.2,
          value_text: "5.2",
          value_canonical: 5.2,
          unit: "mmol/L",
          unit_canonical: "mmol/L",
          ref_range_text: "4-6",
          ref_range_low: 4,
          ref_range_high: 6,
          ref_range_low_canonical: 4,
          ref_range_high_canonical: 6,
          status: "normal",
          source_anchor: "line",
          default_ref_low: 4,
          default_ref_high: 6,
        },
      ],
    });
    hookMocks.useRecordFindings.mockReturnValue({
      data: [
        {
          id: "finding-1",
          record_id: "record-1",
          finding_type_text: "Nodule",
          finding_code: "nodule",
          site_code: "lung",
          body_site_text: "Lung",
          size_mm: 5,
          count: 1,
          severity: "mild",
          laterality: "left",
        },
      ],
    });
    hookMocks.useRecordConditions.mockReturnValue({
      data: [
        {
          id: "cr-1",
          record_id: "record-1",
          condition_id: "cond-1",
          condition_name: "Asthma",
          status_in_record: "active",
        },
      ],
    });
    hookMocks.usePersonConditions.mockReturnValue({ data: [{ id: "cond-1", name: "Asthma" }] });
    hookMocks.usePersonFindingHistory.mockReturnValue({
      data: [
        {
          finding_code: "nodule",
          finding_type_text: "Nodule",
          site_code: "lung",
          body_site_text: "Lung",
          latest_size_mm: 5,
          latest_count: 1,
          latest_date: "2026-01-01",
          occurrence_count: 1,
          history: [{ id: "h1", record_id: "other-record" }],
        },
      ],
    });
    hookMocks.usePersonConditionRecordHistory.mockReturnValue({
      data: { "cond-1": ["other-record"] },
    });
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [
        {
          obs_code: "glucose",
          obs_name: "Glucose",
          latest_value: 5.2,
          latest_unit: "mmol/L",
          latest_status: "normal",
          latest_ref_low: 4,
          latest_ref_high: 6,
          latest_ref_low_canonical: 4,
          latest_ref_high_canonical: 6,
          default_ref_low: 4,
          default_ref_high: 6,
          measurement_count: 1,
          history: [{ id: "h1", record_id: "other-record", value_canonical: 5.0 }],
        },
      ],
    });
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [
        {
          obs_code: "glucose",
          name_ru: "Глюкоза",
          name_en: "Glucose",
          canonical_unit: "mmol/L",
          accepted_units: {},
          synonyms_ru: [],
          synonyms_en: [],
        },
      ],
    });
    hookMocks.useBackgroundOCR.mockReturnValue({ retryOcr: vi.fn() });
    hookMocks.usePersons.mockReturnValue({ data: [{ id: "person-1", name: "Alex" }] });

    hookMocks.useSoftDeleteRecord.mockReturnValue(createMutationMock());
    hookMocks.useRestoreRecord.mockReturnValue(createMutationMock());
    hookMocks.useHardDeleteRecord.mockReturnValue(createMutationMock());
    hookMocks.useUpdateMedicalRecord.mockReturnValue(createMutationMock());
    hookMocks.useUpdateRecordObservation.mockReturnValue(createMutationMock());
    hookMocks.useDeleteRecordObservation.mockReturnValue(createMutationMock());
    hookMocks.useCreateRecordObservation.mockReturnValue(createMutationMock());
    hookMocks.useUpdateRecordFinding.mockReturnValue(createMutationMock());
    hookMocks.useDeleteRecordFinding.mockReturnValue(createMutationMock());
    hookMocks.useCreateRecordFinding.mockReturnValue(createMutationMock());
    hookMocks.useUpdateConditionRecord.mockReturnValue(createMutationMock());
    hookMocks.useDeleteConditionRecord.mockReturnValue(createMutationMock());
    hookMocks.useCreateConditionWithRecord.mockReturnValue(createMutationMock());
    hookMocks.useLinkConditionToRecord.mockReturnValue(createMutationMock());
  });

  it("renders loading/error states and retries failed OCR", async () => {
    const { RecordDetail } = await import("./record-detail");

    hookMocks.useMedicalRecord.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    const loadingView = render(<RecordDetail recordId="record-1" />);
    expect(loadingView.container.querySelector(".animate-pulse")).toBeTruthy();
    loadingView.unmount();

    hookMocks.useMedicalRecord.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("failed"),
      refetch: vi.fn(),
    });
    const errorView = render(<RecordDetail recordId="record-1" />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "common.back" }));
    expect(routerMock.back).toHaveBeenCalled();
    errorView.unmount();

    const retryOcr = vi.fn().mockResolvedValue(undefined);
    const refetch = vi.fn();
    hookMocks.useBackgroundOCR.mockReturnValue({ retryOcr });
    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        status: "ocr_failed",
        ocr_error: "ocr failed",
        attachments: [
          {
            id: "attachment-1",
            record_id: "record-1",
            storage_path: "person-1/record-1/report.pdf",
            mime_type: "application/pdf",
            original_filename: "report.pdf",
            file_size: 1024,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      isLoading: false,
      error: null,
      refetch,
    });
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("processing.ocrFailed")).toBeInTheDocument();
    expect(screen.getByText("ocr failed")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "processing.retryOcr" }));

    await waitFor(() => {
      expect(retryOcr).toHaveBeenCalledWith({
        recordId: "record-1",
        personId: "person-1",
        personName: "Alex",
      });
      expect(refetch).toHaveBeenCalled();
    });
  }, 20000);

  it("disables OCR retry when no attachments are available", async () => {
    const { RecordDetail } = await import("./record-detail");

    const retryOcr = vi.fn().mockResolvedValue(undefined);
    const refetch = vi.fn();
    hookMocks.useBackgroundOCR.mockReturnValue({ retryOcr });
    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        status: "ocr_failed",
        ocr_error: "No attachments found for this record",
        attachments: [],
      }),
      isLoading: false,
      error: null,
      refetch,
    });
    render(<RecordDetail recordId="record-1" />);

    const retryButton = screen.getByRole("button", { name: "processing.retryOcr" });
    expect(retryButton).toBeDisabled();
    expect(screen.getByText("records.detail.noAttachments")).toBeInTheDocument();

    await userEvent.setup().click(retryButton);

    expect(retryOcr).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("renders ocr and structure review branches", async () => {
    const { RecordDetail } = await import("./record-detail");

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({ status: "ocr_review" }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const view = render(<RecordDetail recordId="record-1" />);
    expect(screen.getByText("ocr-review-step")).toBeInTheDocument();
    view.unmount();

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({ status: "structure_review" }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<RecordDetail recordId="record-1" />);
    expect(screen.getByText("structure-review-step")).toBeInTheDocument();
  });

  it("renders active detail and opens add observation dialog", async () => {
    const { RecordDetail } = await import("./record-detail");
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("CBC Report")).toBeInTheDocument();
    expect(screen.getByText("records.detail.observations (1)")).toBeInTheDocument();
    expect(screen.getByText("Glucose")).toBeInTheDocument();
    expect(screen.getByText("finding-row")).toBeInTheDocument();
    expect(screen.getByText("condition-row")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "observations.add" }));
    expect(await screen.findByText("observations.addObservation")).toBeInTheDocument();
  });

  it("handles edit/save, remove, restore, and hard delete flows", async () => {
    const updateMutation = createMutationMock();
    updateMutation.mutate = vi.fn((_, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    const softDeleteMutation = createMutationMock();
    softDeleteMutation.mutate = vi.fn((_, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    const hardDeleteMutation = createMutationMock();
    hardDeleteMutation.mutate = vi.fn((_, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    const restoreMutation = createMutationMock();

    hookMocks.useUpdateMedicalRecord.mockReturnValue(updateMutation);
    hookMocks.useSoftDeleteRecord.mockReturnValue(softDeleteMutation);
    hookMocks.useHardDeleteRecord.mockReturnValue(hardDeleteMutation);
    hookMocks.useRestoreRecord.mockReturnValue(restoreMutation);

    const { RecordDetail } = await import("./record-detail");

    const activeView = render(<RecordDetail recordId="record-1" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "common.edit" }));
    const titleInput = screen.getByPlaceholderText("records.add.recordTitlePlaceholder");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated CBC Report");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(updateMutation.mutate).toHaveBeenCalledWith(
      {
        id: "record-1",
        updates: expect.objectContaining({
          title: "Updated CBC Report",
        }),
      },
      expect.any(Object),
    );

    await user.click(screen.getByRole("button", { name: "records.actions.remove" }));
    await user.click(screen.getByRole("button", { name: "common.remove" }));
    expect(softDeleteMutation.mutate).toHaveBeenCalledWith("record-1", expect.any(Object));
    expect(routerMock.push).toHaveBeenCalledWith("/health");
    activeView.unmount();

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({ status: "removed" }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<RecordDetail recordId="record-1" />);

    await user.click(screen.getByRole("button", { name: "records.actions.restore" }));
    expect(restoreMutation.mutate).toHaveBeenCalledWith("record-1");

    await user.click(screen.getByRole("button", { name: "records.actions.delete" }));
    await user.click(screen.getByRole("button", { name: "common.delete" }));
    expect(hardDeleteMutation.mutate).toHaveBeenCalledWith("record-1", expect.any(Object));
    expect(routerMock.push).toHaveBeenCalledWith("/health");
  }, 20000);

  it("renders active empty-state placeholders and metadata fallback branches", async () => {
    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        title: "Sparse record",
        record_date: null,
        notes: null,
        ocr_text: null,
        llm_keywords: null,
        attachments: [],
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    hookMocks.useRecordObservations.mockReturnValue({ data: [] });
    hookMocks.useRecordFindings.mockReturnValue({ data: [] });
    hookMocks.useRecordConditions.mockReturnValue({ data: [] });

    const { RecordDetail } = await import("./record-detail");
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("records.noDate")).toBeInTheDocument();
    expect(screen.getByText("observations.noObservations")).toBeInTheDocument();
    expect(screen.getByText("findings.noFindings")).toBeInTheDocument();
    expect(screen.getByText("conditions.noConditions")).toBeInTheDocument();
    expect(screen.getByText("records.detail.noNotes")).toBeInTheDocument();
    expect(screen.queryByText("records.detail.keywords")).not.toBeInTheDocument();
    expect(screen.queryByText("records.detail.ocrText")).not.toBeInTheDocument();
  });

  it("renders processing status branches and refresh action", async () => {
    const refetch = vi.fn();
    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        title: "",
        status: "ocr_processing",
      }),
      isLoading: false,
      error: null,
      refetch,
    });

    const { RecordDetail } = await import("./record-detail");
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("processing.processing")).toBeInTheDocument();
    expect(screen.getByText("processing.ocrInProgress")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "common.refresh" }));
    expect(refetch).toHaveBeenCalled();

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        status: "structuring",
      }),
      isLoading: false,
      error: null,
      refetch,
    });
    render(<RecordDetail recordId="record-1" />);
    expect(screen.getByText("processing.structureInProgress")).toBeInTheDocument();
  });

  it("executes finding and condition mutation flows from dialogs/rows", async () => {
    const createFindingMutation = createMutationMock();
    const updateFindingMutation = createMutationMock();
    const deleteFindingMutation = createMutationMock();
    const createConditionMutation = createMutationMock();
    const linkConditionMutation = createMutationMock();
    const updateConditionMutation = createMutationMock();
    const deleteConditionMutation = createMutationMock();

    hookMocks.useCreateRecordFinding.mockReturnValue(createFindingMutation);
    hookMocks.useUpdateRecordFinding.mockReturnValue(updateFindingMutation);
    hookMocks.useDeleteRecordFinding.mockReturnValue(deleteFindingMutation);
    hookMocks.useCreateConditionWithRecord.mockReturnValue(createConditionMutation);
    hookMocks.useLinkConditionToRecord.mockReturnValue(linkConditionMutation);
    hookMocks.useUpdateConditionRecord.mockReturnValue(updateConditionMutation);
    hookMocks.useDeleteConditionRecord.mockReturnValue(deleteConditionMutation);

    const { RecordDetail } = await import("./record-detail");
    render(<RecordDetail recordId="record-1" />);

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "findings.add" }));
    await user.click(screen.getByRole("button", { name: "save-finding-dialog" }));
    await waitFor(() =>
      expect(createFindingMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          record_id: "record-1",
          finding_code: "nodule",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "finding-row-edit" }));
    await user.click(screen.getByRole("button", { name: "save-finding-dialog" }));
    await waitFor(() =>
      expect(updateFindingMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: "finding-1" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "finding-row-delete" }));
    expect(deleteFindingMutation.mutateAsync).toHaveBeenCalledWith({
      id: "finding-1",
      recordId: "record-1",
    });

    await user.click(screen.getByRole("button", { name: "conditions.add" }));
    await user.click(screen.getByRole("button", { name: "save-condition-link" }));
    await waitFor(() =>
      expect(linkConditionMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          condition_id: "cond-1",
          record_id: "record-1",
          status_in_record: "resolved",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "conditions.add" }));
    await user.click(screen.getByRole("button", { name: "save-condition-create" }));
    await waitFor(() =>
      expect(createConditionMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          record_id: "record-1",
          name: "Created condition",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "condition-row-edit" }));
    await user.click(screen.getByRole("button", { name: "save-condition-edit" }));
    await waitFor(() =>
      expect(updateConditionMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "cr-1",
          conditionId: "cond-1",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "condition-row-delete" }));
    expect(deleteConditionMutation.mutateAsync).toHaveBeenCalledWith({
      id: "cr-1",
      recordId: "record-1",
    });
  }, 20000);

  it("covers observation helper components and edit-dialog edge branches", async () => {
    const {
      ObservationStatusBadge,
      ObservationValueChangeIndicator,
      ObservationComparisonBadge,
      ObservationRowEditable,
      ObservationEditDialog,
    } = await import("./record-detail");

    const { container, rerender } = render(<ObservationStatusBadge status={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ObservationStatusBadge status={"mystery" as ObservationStatus} />);
    expect(screen.getByText("mystery")).toBeInTheDocument();

    rerender(
      <ObservationValueChangeIndicator
        currentValue={4}
        previousValue={6}
        refLow={5}
        defaultRefHigh={7}
      />,
    );
    expect(screen.getByText("-2")).toBeInTheDocument();

    rerender(
      <ObservationComparisonBadge
        comparison={{
          isNew: false,
          previousOccurrences: 1,
          previousValue: null,
          previousUnit: null,
        }}
      />,
    );
    expect(screen.getByText("observations.comparison.known")).toBeInTheDocument();

    const onEdit = vi.fn();
    const onDelete = vi.fn();
    rerender(
      <ObservationRowEditable
        observation={
          {
            id: "obs-custom",
            obs_name: "Custom marker",
            obs_code: null,
            value_numeric: null,
            value_text: "trace",
            unit: null,
            ref_range_low: null,
            ref_range_high: null,
            status: "high",
          } as RecordObservationWithCatalog
        }
        comparison={{
          isNew: true,
          previousOccurrences: 0,
          previousValue: null,
          previousUnit: null,
        }}
        onEdit={onEdit}
        onDelete={onDelete}
        isProcessing={false}
      />,
    );
    expect(screen.getByText("observations.customBadge")).toBeInTheDocument();
    expect(screen.getByText("observations.addToCatalogHint")).toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole("button")[0]);
    await userEvent.setup().click(screen.getAllByRole("button")[1]);
    expect(onEdit).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();

    hookMocks.useObservationCatalog.mockReturnValue({
      data: [
        {
          obs_code: "glucose",
          name_ru: "Glucose",
          name_en: "Glucose",
          canonical_unit: "mmol/L",
          accepted_units: {
            "mg/dL": { factor_to_canonical: 0.0555 },
          },
          synonyms_ru: [],
          synonyms_en: [],
        },
      ],
    });

    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    rerender(
      <ObservationEditDialog
        open
        onOpenChange={onOpenChange}
        observation={null}
        onSave={onSave}
        isNew
      />,
    );

    await userEvent.setup().click(screen.getAllByRole("combobox")[0]);
    const searchInput = screen.getByPlaceholderText("observations.searchOrSelect");
    await userEvent.setup().type(searchInput, "zzz-not-found");

    await userEvent.setup().clear(searchInput);
    await userEvent.setup().type(searchInput, "glu");
    await userEvent.setup().click(screen.getByText("Glucose"));

    await userEvent.setup().clear(screen.getByLabelText("observations.value"));
    await userEvent.setup().type(screen.getByLabelText("observations.value"), "90");
    await userEvent.setup().clear(screen.getByLabelText("observations.refLow"));
    await userEvent.setup().type(screen.getByLabelText("observations.refLow"), "70");
    await userEvent.setup().clear(screen.getByLabelText("observations.refHigh"));
    await userEvent.setup().type(screen.getByLabelText("observations.refHigh"), "110");
    await userEvent.setup().click(screen.getByRole("button", { name: "common.save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        obs_name: "Glucose",
        obs_code: "glucose",
        value_numeric: 90,
        value_canonical: 90,
        unit_canonical: "mmol/L",
      }),
    );
  }, 20000);

  it("covers finding/condition/observation comparison helper branches", async () => {
    const {
      getComparisonForConditionData,
      getComparisonForFindingData,
      getComparisonForObservationData,
    } = await import("./record-detail");

    expect(
      getComparisonForFindingData({
        finding: {
          finding_code: "nodule",
          finding_type_text: "Nodule",
          site_code: "lung",
          body_site_text: "Lung",
        } as RecordFindingWithCatalog,
        personFindingHistory: undefined,
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toBeNull();

    expect(
      getComparisonForFindingData({
        finding: {
          finding_code: "nodule",
          finding_type_text: "Nodule",
          site_code: "lung",
          body_site_text: "Lung",
        } as RecordFindingWithCatalog,
        personFindingHistory: [],
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toEqual(
      expect.objectContaining({
        isNew: true,
        previousOccurrences: 0,
      }),
    );

    expect(
      getComparisonForFindingData({
        finding: {
          finding_code: "nodule",
          finding_type_text: "Nodule",
          site_code: "lung",
          body_site_text: "Lung",
        } as RecordFindingWithCatalog,
        personFindingHistory: [
          {
            finding_code: "nodule",
            finding_type_text: "Nodule",
            site_code: "lung",
            body_site_text: "Lung",
            history: [
              { record_id: "record-1", size_mm: 5, count: 1, record_date: "2026-01-01" },
              { record_id: "record-0", size_mm: 4, count: 1, record_date: "2025-12-01" },
            ],
          },
        ] as FindingHistorySummary[],
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toEqual(
      expect.objectContaining({
        isNew: false,
        previousOccurrences: 1,
        previousSize: 4,
      }),
    );

    expect(
      getComparisonForConditionData({
        conditionRecord: { condition_id: "cond-1" } as ConditionRecordWithDetails,
        personConditionRecordHistory: undefined,
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toBeNull();
    expect(
      getComparisonForConditionData({
        conditionRecord: { condition_id: "cond-1" } as ConditionRecordWithDetails,
        personConditionRecordHistory: { "cond-1": ["record-1", "record-2"] },
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toEqual({ isNew: false, previousOccurrences: 1 });

    expect(
      getComparisonForObservationData({
        observation: { obs_code: "glu", obs_name: "Glucose" } as RecordObservationWithCatalog,
        personObservationHistory: undefined,
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toBeNull();
    expect(
      getComparisonForObservationData({
        observation: { obs_code: "glu", obs_name: "Glucose" } as RecordObservationWithCatalog,
        personObservationHistory: [],
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toEqual({
      isNew: true,
      previousOccurrences: 0,
      previousValue: null,
      previousUnit: null,
    });
    expect(
      getComparisonForObservationData({
        observation: { obs_code: "glu", obs_name: "Glucose" } as RecordObservationWithCatalog,
        personObservationHistory: [
          {
            obs_code: "glu",
            obs_name: "Glucose",
            history: [
              {
                record_id: "record-1",
                record_date: "2026-01-02",
                created_at: "2026-01-02T00:00:00.000Z",
                value_canonical: 5.6,
                value_numeric: 5.6,
                unit_canonical: "mmol/L",
                unit: "mmol/L",
              },
              {
                record_id: "record-0",
                record_date: "2026-01-01",
                created_at: "2026-01-01T00:00:00.000Z",
                value_canonical: null,
                value_numeric: 5.1,
                unit_canonical: null,
                unit: "mg/dL",
              },
            ],
          },
        ] as ObservationHistorySummary[],
        recordId: "record-1",
        recordLoaded: true,
      }),
    ).toEqual({
      isNew: false,
      previousOccurrences: 1,
      previousValue: 5.1,
      previousUnit: "mg/dL",
    });
  });
});

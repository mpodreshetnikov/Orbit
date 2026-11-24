import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConditionRecordWithDetails,
  ObservationStatus,
  RecordFindingWithCatalog,
  RecordObservationWithCatalog,
} from "@/types";
import type { FindingHistorySummary, ObservationHistorySummary } from "./record-detail";
import { RecordDetail } from "./record-detail-gate";

const ruleOnClosureMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));

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
  useRuleOnProposedClosure: () => ({ ruleOnClosure: ruleOnClosureMock, rulingOnId: null }),
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
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
  useBackgroundOCR: () => ({ retryOcr: vi.fn().mockResolvedValue(undefined) }),
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
    structure_error: null,
    ...overrides,
  };
}

function mockRecordQuery(
  data: ReturnType<typeof baseRecord> | null | undefined,
  { isLoading = false, error = null }: { isLoading?: boolean; error?: Error | null } = {},
) {
  hookMocks.useMedicalRecord.mockReturnValue({ data, isLoading, error, refetch: vi.fn() });
}

function pdfAttachment(filename: string) {
  return {
    id: `attachment-${filename}`,
    record_id: "record-1",
    storage_path: `person-1/record-1/${filename}`,
    mime_type: "application/pdf",
    original_filename: filename,
    file_size: 1024,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("RecordDetail", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
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

  it("renders loading placeholders", () => {
    mockRecordQuery(null, { isLoading: true });
    const { container } = render(<RecordDetail recordId="record-1" />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("shows no-attachments copy for unprocessed records without files", () => {
    mockRecordQuery(
      baseRecord({
        status: "ocr_failed",
        ocr_error: "No attachments found for this record",
        attachments: [],
      }),
    );
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("records.detail.noAttachments")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "processing.retryOcr" })).not.toBeInTheDocument();
  });

  it.each([
    { state: "missing record", data: null },
    { state: "unresolved data", data: undefined },
    { state: "error without a message", data: null, error: new Error() },
    { state: "failed request", data: null, error: new Error("failed") },
    {
      state: "failed refresh with cached data",
      data: baseRecord({ status: "ocr_processing" }),
      error: new Error("Record request failed"),
    },
  ])("shows an error for $state", async ({ data, error }) => {
    mockRecordQuery(data, { error });

    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText(error?.message || "records.detail.notFound")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "CBC Report" })).not.toBeInTheDocument();
    expect(screen.queryByText("records.status.notProcessedHint")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "common.back" }));
    expect(routerMock.back).toHaveBeenCalledTimes(1);
  });

  it.each(["ocr_processing", "processing"])("opens saved files and OCR for %s", async (status) => {
    mockRecordQuery(
      baseRecord({
        title: "",
        status,
        attachments: [pdfAttachment("report.pdf")],
        ocr_text: "Synthetic OCR excerpt",
        ocr_error: "Old OCR failure from a previous attempt",
      }),
    );
    render(<RecordDetail recordId="record-1" />);
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: /records.detail.ocrText/ });

    expect(screen.getByRole("heading", { name: "records.status.notProcessed" })).toBeVisible();
    expect(screen.getByText("records.status.notProcessedHint")).toBeVisible();
    expect(screen.getByText("attachment-grid")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "records.actions.remove" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("processing.pleaseWait")).not.toBeInTheDocument();
    expect(screen.queryByText("Old OCR failure from a previous attempt")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic OCR excerpt")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("Synthetic OCR excerpt")).toBeVisible();
    await user.click(toggle);
    expect(screen.queryByText("Synthetic OCR excerpt")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "" }));
    expect(routerMock.back).toHaveBeenCalledTimes(1);
  });

  it("allows removal without inventing a failure reason for an older failed record", () => {
    mockRecordQuery(baseRecord({ status: "ocr_failed", ocr_error: null }));
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByRole("heading", { name: "CBC Report" })).toBeVisible();
    expect(screen.getByRole("button", { name: "records.actions.remove" })).toBeEnabled();
    expect(screen.queryByText("processing.failed")).not.toBeInTheDocument();
  });

  it("names the cause of a failed OCR in the reader's language", () => {
    mockRecordQuery(
      baseRecord({
        status: "ocr_failed",
        ocr_error:
          "ocr_cause:provider_auth the transcription service rejected this deployment's credentials",
      }),
    );
    const view = render(<RecordDetail recordId="record-1" />);
    // Not the server's English sentence: a rejected key is not a photograph to retake, and the
    // reader has to be told which of the two this was.
    expect(screen.getByText("processing.ocrCause.provider_auth")).toBeInTheDocument();
    view.unmount();

    // A row written before the causes existed still says what little it knows.
    mockRecordQuery(
      baseRecord({
        status: "ocr_failed",
        ocr_error: "Failed to extract text from any attachment",
      }),
    );
    render(<RecordDetail recordId="record-1" />);
    expect(screen.getByText("Failed to extract text from any attachment")).toBeInTheDocument();
  });

  it("says on the review screen that a page of the document was lost", () => {
    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        status: "ocr_review",
        ocr_error:
          "ocr_cause:provider_unavailable the transcription service was unavailable: " +
          "1 of 3 pages failed",
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const view = render(<RecordDetail recordId="record-1" />);
    // A three-page document that came back with two pages is not a clean success.
    expect(screen.getByText("processing.ocrPartial")).toBeInTheDocument();
    expect(screen.getByText("processing.ocrCause.provider_unavailable")).toBeInTheDocument();
    view.unmount();

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({ status: "ocr_review" }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<RecordDetail recordId="record-1" />);
    expect(screen.queryByText("processing.ocrPartial")).not.toBeInTheDocument();
  });

  it("renders ocr and structure review branches", () => {
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

  it("keeps a failed structuring visible on the OCR review screen", () => {
    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({
        status: "ocr_review",
        structure_error: "Structure extraction failed: 502",
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const view = render(<RecordDetail recordId="record-1" />);
    // The toast that announced it is long gone; the reason has to survive a refresh.
    expect(screen.getByText("processing.structureFailed")).toBeInTheDocument();
    expect(screen.getByText("Structure extraction failed: 502")).toBeInTheDocument();
    view.unmount();

    hookMocks.useMedicalRecord.mockReturnValue({
      data: baseRecord({ status: "ocr_review" }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<RecordDetail recordId="record-1" />);
    expect(screen.queryByText("processing.structureFailed")).not.toBeInTheDocument();
  });

  it("renders active detail and opens add observation dialog", async () => {
    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("CBC Report")).toBeInTheDocument();
    expect(screen.getByText("records.detail.observations (1)")).toBeInTheDocument();
    expect(screen.getByText("Glucose")).toBeInTheDocument();
    expect(screen.getByText("finding-row")).toBeInTheDocument();
    expect(screen.getByText("condition-row")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "observations.add" }));
    expect(await screen.findByText("observations.addObservation")).toBeInTheDocument();
  });

  it("puts a row kept unrecognised into history once the owner matches it", async () => {
    const updateObs = createMutationMock();
    hookMocks.useUpdateRecordObservation.mockReturnValue(updateObs);
    hookMocks.useRecordObservations.mockReturnValue({
      data: [
        {
          id: "obs-kept",
          record_id: "record-1",
          obs_name: "Сахар крови",
          obs_code: null,
          is_applied: false,
          value_numeric: 5.1,
          value_text: "5.1",
          value_canonical: null,
          unit: "mmol/L",
          unit_canonical: null,
          ref_range_text: null,
          ref_range_low: null,
          ref_range_high: null,
          ref_range_low_canonical: null,
          ref_range_high_canonical: null,
          status: null,
        },
      ],
    });
    render(<RecordDetail recordId="record-1" />);
    const user = userEvent.setup();

    const row = screen.getByText("Сахар крови").closest(".rounded-lg") as HTMLElement;
    await user.click(within(row).getAllByRole("button")[0]);
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.type(screen.getByPlaceholderText("observations.searchOrSelect"), "глю");
    await user.click(await screen.findByText("Глюкоза"));
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(updateObs.mutateAsync).toHaveBeenCalledWith({
        id: "obs-kept",
        updates: expect.objectContaining({ obs_code: "glucose", is_applied: true }),
      }),
    );
  }, 20000);

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

  it("renders active empty-state placeholders and metadata fallback branches", () => {
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

    render(<RecordDetail recordId="record-1" />);

    expect(screen.getByText("records.noDate")).toBeInTheDocument();
    expect(screen.getByText("observations.noObservations")).toBeInTheDocument();
    expect(screen.getByText("findings.noFindings")).toBeInTheDocument();
    expect(screen.getByText("conditions.noConditions")).toBeInTheDocument();
    expect(screen.getByText("records.detail.noNotes")).toBeInTheDocument();
    expect(screen.queryByText("records.detail.keywords")).not.toBeInTheDocument();
    expect(screen.queryByText("records.detail.ocrText")).not.toBeInTheDocument();
  });

  it("shows neutral status for records left structuring", () => {
    mockRecordQuery(baseRecord({ status: "structuring" }));
    render(<RecordDetail recordId="record-1" />);
    expect(screen.getByText("records.status.notProcessedHint")).toBeVisible();
  });

  it("soft-removes ocr_failed records from the unprocessed detail view", async () => {
    const softDeleteMutation = createMutationMock();
    softDeleteMutation.mutate = vi.fn((_, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    hookMocks.useSoftDeleteRecord.mockReturnValue(softDeleteMutation);
    mockRecordQuery(
      baseRecord({
        status: "ocr_failed",
        ocr_error: "ocr failed",
        ocr_text: "Partial OCR from failed run",
        attachments: [pdfAttachment("report.pdf")],
      }),
    );

    render(<RecordDetail recordId="record-1" />);
    const user = userEvent.setup();

    expect(screen.getByText("records.status.notProcessedHint")).toBeInTheDocument();
    expect(screen.getByText("records.status.viaAssistant")).toBeInTheDocument();
    expect(screen.getByText("ocr failed")).toBeInTheDocument();
    expect(screen.getByText("attachment-grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /records.detail.ocrText/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "processing.retryOcr" })).not.toBeInTheDocument();
    expect(screen.queryByText("records.confirm.removeTitle")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "records.actions.remove" }));
    expect(screen.getByText("records.confirm.removeTitle")).toBeVisible();
    expect(softDeleteMutation.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "common.remove" }));
    expect(softDeleteMutation.mutate).toHaveBeenCalledWith("record-1", expect.any(Object));
    expect(screen.queryByText("records.confirm.removeTitle")).not.toBeInTheDocument();
    expect(routerMock.push).toHaveBeenCalledWith("/health");
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
            is_applied: true,
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

    // A row kept at approval although the catalogue did not know it says so, and has no history
    // link to offer.
    rerender(
      <ObservationRowEditable
        observation={
          {
            id: "obs-unrecognised",
            obs_name: "Странный показатель",
            obs_code: null,
            is_applied: false,
            value_numeric: 3,
            value_text: "3",
            unit: null,
            ref_range_low: null,
            ref_range_high: null,
            status: null,
          } as RecordObservationWithCatalog
        }
        onEdit={onEdit}
        onDelete={onDelete}
        isProcessing={false}
      />,
    );
    expect(screen.getByText("observations.unrecognisedBadge")).toBeInTheDocument();
    expect(screen.getByText("observations.unrecognisedHint")).toBeInTheDocument();
    expect(screen.queryByText("observations.customBadge")).not.toBeInTheDocument();

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

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservationStatus, RecordObservationWithCatalog } from "@/types";

const hookMocks = vi.hoisted(() => ({
  useUpdateMedicalRecord: vi.fn(),
  useRecordObservations: vi.fn(),
  useUpdateRecordObservation: vi.fn(),
  useDeleteRecordObservation: vi.fn(),
  useCreateRecordObservation: vi.fn(),
  useObservationCatalog: vi.fn(),
  useRecordFindings: vi.fn(),
  useRecordExtractionIssues: vi.fn(),
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
  useCompleteCheckupItem: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("@/hooks", () => ({
  useUpdateMedicalRecord: (...args: unknown[]) => hookMocks.useUpdateMedicalRecord(...args),
  useRecordObservations: (...args: unknown[]) => hookMocks.useRecordObservations(...args),
  useUpdateRecordObservation: (...args: unknown[]) => hookMocks.useUpdateRecordObservation(...args),
  useDeleteRecordObservation: (...args: unknown[]) => hookMocks.useDeleteRecordObservation(...args),
  useCreateRecordObservation: (...args: unknown[]) => hookMocks.useCreateRecordObservation(...args),
  useObservationCatalog: (...args: unknown[]) => hookMocks.useObservationCatalog(...args),
  useRecordFindings: (...args: unknown[]) => hookMocks.useRecordFindings(...args),
  useRecordExtractionIssues: (...args: unknown[]) => hookMocks.useRecordExtractionIssues(...args),
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
  useCompleteCheckupItem: (...args: unknown[]) => hookMocks.useCompleteCheckupItem(...args),
}));

vi.mock("@/components/findings", () => ({
  FindingRow: ({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) => (
    <div>
      finding-row
      <button type="button" onClick={() => onEdit?.()}>
        finding-row-edit
      </button>
      <button type="button" onClick={() => onDelete?.()}>
        finding-row-delete
      </button>
    </div>
  ),
  FindingEditDialog: ({
    open,
    onSave,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    isNew?: boolean;
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
      <button type="button" onClick={() => onEdit?.()}>
        condition-row-edit
      </button>
      <button type="button" onClick={() => onDelete?.()}>
        condition-row-delete
      </button>
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
                  condition_id: "c1",
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
                  name: "New condition",
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
                source_anchor: "updated-source",
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

function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "record-1",
    person_id: "person-1",
    title: "CBC",
    record_type: "lab",
    record_date: "2026-01-01",
    notes: "",
    llm_keywords: ["cbc"],
    attachments: [],
    status: "structure_review",
    llm_suggested_checkup_completions: [
      {
        checkup_item_id: "checkup-1",
        checkup_title: "CBC yearly",
        suggested_done_at: "2026-01-02",
        reason: "",
      },
    ],
    ...overrides,
  } as unknown as import("@/types").MedicalRecordWithAttachments;
}

describe("StructureReviewStep", () => {
  beforeEach(() => {
    vi.resetModules();
    routerMocks.push.mockClear();
    routerMocks.replace.mockClear();
    routerMocks.refresh.mockClear();
    routerMocks.prefetch.mockClear();
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
    // Most records have nothing to correct; the tests that care set their own.
    hookMocks.useRecordExtractionIssues.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
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
      data: [{ id: "condition-1", condition_id: "c1" }],
    });
    hookMocks.usePersonConditions.mockReturnValue({ data: [{ id: "c1", name: "Asthma" }] });
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
    hookMocks.usePersonFindingHistory.mockReturnValue({ data: [] });
    hookMocks.usePersonConditionRecordHistory.mockReturnValue({ data: {} });
    hookMocks.usePersonObservationHistory.mockReturnValue({ data: [] });

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
    hookMocks.useCompleteCheckupItem.mockReturnValue(createMutationMock());
  });

  it("renders review sections and opens add observation dialog", async () => {
    const { StructureReviewStep } = await import("./structure-review-step");
    render(<StructureReviewStep record={createRecord()} onComplete={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("records.structure.reviewTitle")).toBeInTheDocument();
    expect(screen.getByText("observations.title")).toBeInTheDocument();
    expect(screen.getByText("checkups.suggestedCompletions.title")).toBeInTheDocument();
    expect(screen.getByText("finding-row")).toBeInTheDocument();
    expect(screen.getByText("condition-row")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "observations.add" }));
    expect(await screen.findByText("observations.addObservation")).toBeInTheDocument();
  });

  // Value-level corrections used to end in a log line nobody reads. The review screen is the last
  // moment a person can put the real value back, so it has to say what was substituted.
  it("shows what the extraction had to correct, and says nothing when there was nothing", async () => {
    hookMocks.useRecordExtractionIssues.mockReturnValue({
      data: [
        {
          id: "issue-1",
          record_id: "record-1",
          entity_kind: "observation",
          entity_label: "Гемоглобин",
          field: "observation.status",
          received: "borderline",
          resolution: "replaced_with_default",
          applied_fallback: "unknown",
          detail: null,
        },
      ],
      isLoading: false,
      isError: false,
    });

    const { StructureReviewStep } = await import("./structure-review-step");
    const { unmount } = render(
      <StructureReviewStep record={createRecord()} onComplete={vi.fn()} onBack={vi.fn()} />,
    );

    expect(screen.getByText("records.wizard.extractionIssues")).toBeInTheDocument();
    expect(screen.getByText("records.wizard.extractionIssueReplaced")).toBeInTheDocument();
    unmount();

    // And a clean extraction must not leave a warning banner sitting there.
    hookMocks.useRecordExtractionIssues.mockReturnValue({ data: [], isLoading: false });
    render(<StructureReviewStep record={createRecord()} onComplete={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText("records.wizard.extractionIssues")).not.toBeInTheDocument();
  });

  // A failed read is not the same as a clean extraction: a reviewer must not approve a record
  // believing nothing was corrected when the warnings simply could not be fetched.
  it("says so when the corrections could not be read", async () => {
    hookMocks.useRecordExtractionIssues.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    const { StructureReviewStep } = await import("./structure-review-step");
    render(<StructureReviewStep record={createRecord()} onComplete={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("records.wizard.extractionIssuesUnavailable")).toBeInTheDocument();
    expect(screen.queryByText("records.wizard.extractionIssues")).not.toBeInTheDocument();
  });

  it("applies suggested checkups and completes review on save", async () => {
    const updateMedicalRecordMutation = createMutationMock();
    const completeCheckupMutation = createMutationMock();
    hookMocks.useUpdateMedicalRecord.mockReturnValue(updateMedicalRecordMutation);
    hookMocks.useCompleteCheckupItem.mockReturnValue(completeCheckupMutation);
    const onComplete = vi.fn();

    const { StructureReviewStep } = await import("./structure-review-step");
    render(
      <StructureReviewStep record={createRecord()} onComplete={onComplete} onBack={vi.fn()} />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "records.add.saveAndActivate" }));

    await waitFor(() => expect(updateMedicalRecordMutation.mutateAsync).toHaveBeenCalled());
    expect(completeCheckupMutation.mutateAsync).toHaveBeenCalledWith({
      checkup_item_id: "checkup-1",
      done_at: "2026-01-02",
      note: null,
      evidence_record_id: "record-1",
    });
    expect(updateMedicalRecordMutation.mutateAsync).toHaveBeenNthCalledWith(2, {
      id: "record-1",
      updates: { llm_suggested_checkup_completions: null },
    });
    expect(routerMocks.push).toHaveBeenCalledWith("/health");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("dismisses suggested checkup item and saves draft via onComplete", async () => {
    const updateMedicalRecordMutation = createMutationMock();
    hookMocks.useUpdateMedicalRecord.mockReturnValue(updateMedicalRecordMutation);
    const onComplete = vi.fn();

    const { StructureReviewStep } = await import("./structure-review-step");
    render(
      <StructureReviewStep
        record={createRecord({
          llm_suggested_checkup_completions: [
            {
              checkup_item_id: "checkup-1",
              checkup_title: "CBC yearly",
              suggested_done_at: "2026-01-02",
            },
            {
              checkup_item_id: "checkup-2",
              checkup_title: "BP check",
              suggested_done_at: "2026-01-03",
            },
          ],
        })}
        onComplete={onComplete}
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getAllByTitle("checkups.suggestedCompletions.dismiss")[0]);
    await userEvent.setup().click(screen.getByRole("button", { name: "records.add.saveDraft" }));

    await waitFor(() => {
      expect(updateMedicalRecordMutation.mutateAsync).toHaveBeenNthCalledWith(1, {
        id: "record-1",
        updates: {
          llm_suggested_checkup_completions: [
            {
              checkup_item_id: "checkup-2",
              checkup_title: "BP check",
              suggested_done_at: "2026-01-03",
            },
          ],
        },
      });
      expect(updateMedicalRecordMutation.mutateAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: "record-1",
          updates: expect.objectContaining({
            status: "draft",
          }),
        }),
      );
    });
    expect(onComplete).toHaveBeenCalled();
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("executes finding and condition add/edit/delete mutation flows", async () => {
    const updateFindingMutation = createMutationMock();
    const createFindingMutation = createMutationMock();
    const deleteFindingMutation = createMutationMock();
    const updateConditionMutation = createMutationMock();
    const createConditionMutation = createMutationMock();
    const linkConditionMutation = createMutationMock();
    const deleteConditionMutation = createMutationMock();

    hookMocks.useUpdateRecordFinding.mockReturnValue(updateFindingMutation);
    hookMocks.useCreateRecordFinding.mockReturnValue(createFindingMutation);
    hookMocks.useDeleteRecordFinding.mockReturnValue(deleteFindingMutation);
    hookMocks.useUpdateConditionRecord.mockReturnValue(updateConditionMutation);
    hookMocks.useCreateConditionWithRecord.mockReturnValue(createConditionMutation);
    hookMocks.useLinkConditionToRecord.mockReturnValue(linkConditionMutation);
    hookMocks.useDeleteConditionRecord.mockReturnValue(deleteConditionMutation);

    const { StructureReviewStep } = await import("./structure-review-step");
    render(<StructureReviewStep record={createRecord()} onComplete={vi.fn()} onBack={vi.fn()} />);

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
          condition_id: "c1",
          record_id: "record-1",
          status_in_record: "resolved",
          code: "J45",
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
          name: "New condition",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "condition-row-edit" }));
    await user.click(screen.getByRole("button", { name: "save-condition-edit" }));
    await waitFor(() =>
      expect(updateConditionMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "condition-1",
          conditionId: "c1",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "condition-row-delete" }));
    expect(deleteConditionMutation.mutateAsync).toHaveBeenCalledWith({
      id: "condition-1",
      recordId: "record-1",
    });
  }, 15000);

  it("deletes unapplied custom observations before save", async () => {
    const deleteObservationMutation = createMutationMock();
    const updateMedicalRecordMutation = createMutationMock();
    hookMocks.useDeleteRecordObservation.mockReturnValue(deleteObservationMutation);
    hookMocks.useUpdateMedicalRecord.mockReturnValue(updateMedicalRecordMutation);
    hookMocks.useRecordObservations.mockReturnValue({
      data: [
        {
          id: "obs-custom",
          record_id: "record-1",
          obs_name: "Custom marker",
          obs_code: null,
          is_applied: false,
          value_numeric: null,
          value_text: "trace",
          value_canonical: null,
          unit: null,
          unit_canonical: null,
          ref_range_text: null,
          ref_range_low: null,
          ref_range_high: null,
          ref_range_low_canonical: null,
          ref_range_high_canonical: null,
          status: null,
          source_anchor: null,
          confidence: null,
          is_llm_extracted: true,
          is_user_verified: false,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          default_ref_low: null,
          default_ref_high: null,
        },
      ],
    });

    const onComplete = vi.fn();
    const { StructureReviewStep } = await import("./structure-review-step");
    render(
      <StructureReviewStep record={createRecord()} onComplete={onComplete} onBack={vi.fn()} />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "records.add.saveDraft" }));

    await waitFor(() =>
      expect(deleteObservationMutation.mutateAsync).toHaveBeenCalledWith({
        id: "obs-custom",
        recordId: "record-1",
      }),
    );
    expect(updateMedicalRecordMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "record-1",
        updates: expect.objectContaining({ status: "draft" }),
      }),
    );
    expect(onComplete).toHaveBeenCalled();
  });

  it("renders observation status/comparison indicators across branch variants", async () => {
    const { ObservationStatusBadge, ObservationValueChangeIndicator, ObservationComparisonBadge } =
      await import("./structure-review-step");

    const { container, rerender } = render(<ObservationStatusBadge status={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ObservationStatusBadge status={"high" as ObservationStatus} />);
    expect(screen.getByText("observations.status.high")).toBeInTheDocument();

    rerender(<ObservationStatusBadge status={"unexpected" as ObservationStatus} />);
    expect(screen.getByText("observations.status.unexpected")).toBeInTheDocument();

    rerender(<ObservationValueChangeIndicator currentValue={5} previousValue={5} unit="mmol/L" />);
    expect(screen.getByText(/= 5/)).toBeInTheDocument();

    rerender(
      <ObservationValueChangeIndicator
        currentValue={6}
        previousValue={5}
        refLow={4}
        refHigh={8}
        unit="mmol/L"
      />,
    );
    expect(screen.getByText("+1")).toBeInTheDocument();

    rerender(
      <ObservationComparisonBadge
        comparison={{
          isNew: true,
          previousOccurrences: 0,
          previousValue: null,
          previousUnit: null,
        }}
      />,
    );
    expect(screen.getByText("observations.comparison.new")).toBeInTheDocument();

    rerender(
      <ObservationComparisonBadge
        comparison={{
          isNew: false,
          previousOccurrences: 3,
          previousValue: 5.5,
          previousUnit: "mmol/L",
        }}
      />,
    );
    expect(screen.getByText("observations.comparison.known")).toBeInTheDocument();
  });

  it("renders observation row branches for unapplied and applied custom observations", async () => {
    const { ObservationRow } = await import("./structure-review-step");
    const onApply = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    const baseObservation = {
      id: "obs-custom",
      record_id: "record-1",
      obs_name: "Custom marker",
      obs_code: null,
      is_applied: false,
      value_numeric: null,
      value_text: "trace",
      value_canonical: null,
      unit: null,
      unit_canonical: null,
      ref_range_text: null,
      ref_range_low: null,
      ref_range_high: null,
      ref_range_low_canonical: null,
      ref_range_high_canonical: null,
      status: null,
      source_anchor: null,
      confidence: 0.7,
      is_llm_extracted: true,
      is_user_verified: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      default_ref_low: null,
      default_ref_high: null,
    } as unknown as RecordObservationWithCatalog;

    const { rerender } = render(
      <ObservationRow
        observation={baseObservation}
        comparison={null}
        onApply={onApply}
        onEdit={onEdit}
        onDelete={onDelete}
        isProcessing={false}
      />,
    );

    expect(screen.getByText("observations.pendingBadge")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "observations.applyButton" }));
    await userEvent.setup().click(screen.getAllByRole("button")[1]);
    await userEvent.setup().click(screen.getAllByRole("button")[2]);
    expect(onApply).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();

    rerender(
      <ObservationRow
        observation={{ ...baseObservation, is_applied: true }}
        comparison={{
          isNew: false,
          previousOccurrences: 2,
          previousValue: 4.2,
          previousUnit: "mmol/L",
        }}
        onApply={onApply}
        onEdit={onEdit}
        onDelete={onDelete}
        isProcessing={false}
      />,
    );
    expect(screen.getByText("observations.addToCatalogHint")).toBeInTheDocument();
    expect(screen.getByText("observations.comparison.known")).toBeInTheDocument();
  });

  it("saves edit-observation dialog with canonical conversion and resets new-mode state", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [
        {
          obs_code: "glucose",
          name_ru: "Glucose",
          name_en: "Glucose",
          canonical_unit: "mmol/L",
          accepted_units: {
            "mg/L": { factor_to_canonical: 0.1 },
          },
          synonyms_ru: [],
          synonyms_en: [],
        },
      ],
    });

    const { EditObservationDialog } = await import("./structure-review-step");
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const observation = {
      obs_name: "Glucose",
      value_text: "10",
      unit: "mg/L",
      ref_range_text: "4-6",
      ref_range_low: 20,
      ref_range_high: 40,
      status: "high",
      obs_code: "glucose",
    } as RecordObservationWithCatalog;

    const { rerender } = render(
      <EditObservationDialog
        open
        onOpenChange={onOpenChange}
        observation={observation}
        onSave={onSave}
        isNew={false}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "common.save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        obs_name: "Glucose",
        value_numeric: 10,
        value_canonical: 1,
        ref_range_low: 20,
        ref_range_high: 40,
        ref_range_low_canonical: 2,
        ref_range_high_canonical: 4,
        unit_canonical: "mmol/L",
        obs_code: "glucose",
      }),
    );

    rerender(
      <EditObservationDialog
        open
        onOpenChange={onOpenChange}
        observation={null}
        onSave={onSave}
        isNew
      />,
    );
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Trash2,
  RotateCcw,
  FileCheck,
  Pencil,
  X,
  Save,
  Tag,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  Loader2,
  FlaskConical,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Stethoscope,
  HeartPulse,
  CircleDot,
  History,
  TrendingUp,
  TrendingDown,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentGrid } from "./attachment-preview";
import { OcrReviewStep } from "./ocr-review-step";
import { StructureReviewStep } from "./structure-review-step";
import {
  useMedicalRecord,
  useSoftDeleteRecord,
  useRestoreRecord,
  useHardDeleteRecord,
  useUpdateMedicalRecord,
  useRecordObservations,
  useUpdateRecordObservation,
  useDeleteRecordObservation,
  useCreateRecordObservation,
  useObservationCatalog,
  useRecordFindings,
  useUpdateRecordFinding,
  useDeleteRecordFinding,
  useCreateRecordFinding,
  useRecordConditions,
  usePersonConditions,
  useUpdateConditionRecord,
  useDeleteConditionRecord,
  useCreateConditionWithRecord,
  useLinkConditionToRecord,
  usePersonFindingHistory,
  usePersonConditionRecordHistory,
  usePersonObservationHistory,
  useBackgroundOCR,
  usePersons,
} from "@/hooks";
import { FindingRow, FindingEditDialog, type FindingComparison } from "@/components/findings";
import {
  ConditionRecordRow,
  ConditionEditDialog,
  type ConditionComparison,
} from "@/components/conditions";
import type {
  RecordType,
  ObservationStatus,
  RecordObservationWithCatalog,
  RecordFindingWithCatalog,
  FindingSeverity,
  FindingLaterality,
  ConditionRecordWithDetails,
  ConditionStatus,
} from "@/types";
import { RECORD_TYPES } from "@/types";
import { cn } from "@/lib/utils";

const RECORD_TYPE_COLORS: Record<RecordType, string> = {
  lab: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  visit: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  imaging: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  prescription: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  vaccination: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  vet: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  procedure: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  other: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

interface RecordDetailProps {
  recordId: string;
}

export function RecordDetail({ recordId }: RecordDetailProps) {
  const t = useTranslations();
  const router = useRouter();
  const dateLocale = useDateFnsLocale();

  const { data: record, isLoading, error, refetch } = useMedicalRecord(recordId);
  const { data: observations } = useRecordObservations(recordId);
  const { data: findings } = useRecordFindings(recordId);
  const { data: conditionRecords } = useRecordConditions(recordId);
  const { data: personConditions } = usePersonConditions(record?.person_id ?? null);
  const { data: personFindingHistory } = usePersonFindingHistory(record?.person_id ?? null);
  const { data: personConditionRecordHistory } = usePersonConditionRecordHistory(
    record?.person_id ?? null,
  );
  const { data: personObservationHistory } = usePersonObservationHistory(record?.person_id ?? null);
  const { retryOcr } = useBackgroundOCR();
  const { data: persons } = usePersons();

  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showOcrText, setShowOcrText] = useState(false);

  // Observation editing state
  const [editingObservation, setEditingObservation] = useState<RecordObservationWithCatalog | null>(
    null,
  );
  const [isAddingObservation, setIsAddingObservation] = useState(false);

  // Finding editing state
  const [editingFinding, setEditingFinding] = useState<RecordFindingWithCatalog | null>(null);
  const [isAddingFinding, setIsAddingFinding] = useState(false);

  // Condition editing state
  const [editingCondition, setEditingCondition] = useState<ConditionRecordWithDetails | null>(null);
  const [isAddingCondition, setIsAddingCondition] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    title: "",
    record_type: "other" as RecordType,
    record_date: "",
    notes: "",
    ocr_text: "",
    llm_keywords: [] as string[],
  });

  // Tag input state
  const [newTag, setNewTag] = useState("");

  const softDeleteMutation = useSoftDeleteRecord();
  const restoreMutation = useRestoreRecord();
  const hardDeleteMutation = useHardDeleteRecord();
  const updateMutation = useUpdateMedicalRecord();
  const updateObsMutation = useUpdateRecordObservation();
  const deleteObsMutation = useDeleteRecordObservation();
  const createObsMutation = useCreateRecordObservation();
  const updateFindingMutation = useUpdateRecordFinding();
  const deleteFindingMutation = useDeleteRecordFinding();
  const createFindingMutation = useCreateRecordFinding();
  const updateConditionRecordMutation = useUpdateConditionRecord();
  const deleteConditionRecordMutation = useDeleteConditionRecord();
  const createConditionWithRecordMutation = useCreateConditionWithRecord();
  const linkConditionToRecordMutation = useLinkConditionToRecord();

  const isObsProcessing =
    updateObsMutation.isPending || deleteObsMutation.isPending || createObsMutation.isPending;
  const isFindingProcessing =
    updateFindingMutation.isPending ||
    deleteFindingMutation.isPending ||
    createFindingMutation.isPending;
  const isConditionProcessing =
    updateConditionRecordMutation.isPending ||
    deleteConditionRecordMutation.isPending ||
    createConditionWithRecordMutation.isPending ||
    linkConditionToRecordMutation.isPending;

  // Helper function to compute comparison data for a finding
  // Compares the current finding with previous occurrences from the person's history
  const getComparisonForFinding = (finding: RecordFindingWithCatalog): FindingComparison | null => {
    // Wait for record to load, but proceed even if history is empty (means everything is new)
    if (!record) return null;
    if (personFindingHistory === undefined) return null; // Still loading

    // Build the key for matching - same logic as in use-finding-history.ts
    const findingKey = finding.finding_code || finding.finding_type_text.toLowerCase().trim();
    const siteKey = finding.site_code || finding.body_site_text?.toLowerCase().trim() || "unknown";

    // Find matching history entry
    const historyMatch = personFindingHistory.find((h) => {
      const historyFindingKey = h.finding_code || h.finding_type_text.toLowerCase().trim();
      const historySiteKey = h.site_code || h.body_site_text?.toLowerCase().trim() || "unknown";
      return historyFindingKey === findingKey && historySiteKey === siteKey;
    });

    if (!historyMatch) {
      // This is a completely new finding type+site combination
      return {
        isNew: true,
        previousOccurrences: 0,
        previousSize: null,
        previousCount: null,
        previousDate: null,
      };
    }

    // Filter out the current finding from history to find truly previous occurrences
    // An occurrence is "previous" if it's from a different record (not the current one)
    const previousOccurrences = historyMatch.history.filter((h) => h.record_id !== recordId);

    if (previousOccurrences.length === 0) {
      // This is the first occurrence of this finding (only this record has it)
      return {
        isNew: true,
        previousOccurrences: 0,
        previousSize: null,
        previousCount: null,
        previousDate: null,
      };
    }

    // Sort by date to get the most recent previous occurrence
    // History is already sorted newest first, so the first item after filtering is the most recent previous
    const mostRecentPrevious = previousOccurrences[0];

    return {
      isNew: false,
      previousOccurrences: previousOccurrences.length,
      previousSize: mostRecentPrevious.size_mm,
      previousCount: mostRecentPrevious.count,
      previousDate: mostRecentPrevious.record_date,
    };
  };

  const getComparisonForCondition = (
    cr: ConditionRecordWithDetails,
  ): ConditionComparison | null => {
    if (!record || personConditionRecordHistory === undefined) return null;
    const recordIds = personConditionRecordHistory[cr.condition_id] ?? [];
    const previousOccurrences = recordIds.filter((id) => id !== recordId).length;
    return {
      isNew: previousOccurrences === 0,
      previousOccurrences,
    };
  };

  const getComparisonForObservation = (
    obs: RecordObservationWithCatalog,
  ): {
    isNew: boolean;
    previousOccurrences: number;
    previousValue: number | null;
    previousUnit: string | null;
  } | null => {
    if (!record || personObservationHistory === undefined) return null;
    const obsKey = obs.obs_code || obs.obs_name.toLowerCase().trim();
    const historySummary = personObservationHistory.find((h) => {
      const historyKey = h.obs_code || h.obs_name.toLowerCase().trim();
      return historyKey === obsKey;
    });
    if (!historySummary) {
      return { isNew: true, previousOccurrences: 0, previousValue: null, previousUnit: null };
    }
    // Filter out current record and sort by date descending to get most recent previous
    const previousHistory = historySummary.history
      .filter((h) => h.record_id !== recordId)
      .sort((a, b) => {
        const dateA = new Date(a.record_date || a.created_at).getTime();
        const dateB = new Date(b.record_date || b.created_at).getTime();
        return dateB - dateA;
      });
    if (previousHistory.length === 0) {
      return { isNew: true, previousOccurrences: 0, previousValue: null, previousUnit: null };
    }
    const mostRecent = previousHistory[0];
    return {
      isNew: false,
      previousOccurrences: previousHistory.length,
      previousValue: mostRecent.value_canonical ?? mostRecent.value_numeric,
      previousUnit: mostRecent.unit_canonical || mostRecent.unit,
    };
  };

  const handleEditObservation = (obs: RecordObservationWithCatalog) => {
    setEditingObservation(obs);
    setIsAddingObservation(false);
  };

  const handleAddObservation = () => {
    setEditingObservation(null);
    setIsAddingObservation(true);
  };

  const handleSaveObservation = async (data: {
    obs_name: string;
    value_text: string;
    value_numeric: number | null;
    value_canonical: number | null;
    unit: string;
    unit_canonical: string | null;
    ref_range_text: string;
    ref_range_low: number | null;
    ref_range_high: number | null;
    ref_range_low_canonical: number | null;
    ref_range_high_canonical: number | null;
    status: ObservationStatus | null;
    obs_code: string | null;
  }) => {
    if (isAddingObservation) {
      await createObsMutation.mutateAsync({
        record_id: recordId,
        obs_name: data.obs_name,
        value_text: data.value_text,
        value_numeric: data.value_numeric,
        value_canonical: data.value_canonical,
        unit: data.unit || null,
        unit_canonical: data.unit_canonical,
        ref_range_text: data.ref_range_text || null,
        ref_range_low: data.ref_range_low,
        ref_range_high: data.ref_range_high,
        ref_range_low_canonical: data.ref_range_low_canonical,
        ref_range_high_canonical: data.ref_range_high_canonical,
        status: data.status,
        obs_code: data.obs_code,
        is_llm_extracted: false,
        is_user_verified: true,
      });
    } else if (editingObservation) {
      await updateObsMutation.mutateAsync({
        id: editingObservation.id,
        updates: {
          obs_name: data.obs_name,
          value_text: data.value_text,
          value_numeric: data.value_numeric,
          value_canonical: data.value_canonical,
          unit: data.unit || null,
          unit_canonical: data.unit_canonical,
          ref_range_text: data.ref_range_text || null,
          ref_range_low: data.ref_range_low,
          ref_range_high: data.ref_range_high,
          ref_range_low_canonical: data.ref_range_low_canonical,
          ref_range_high_canonical: data.ref_range_high_canonical,
          status: data.status,
          obs_code: data.obs_code,
          is_user_verified: true,
        },
      });
    }

    setEditingObservation(null);
    setIsAddingObservation(false);
  };

  const handleDeleteObservation = async (obs: RecordObservationWithCatalog) => {
    await deleteObsMutation.mutateAsync({ id: obs.id, recordId });
  };

  // Finding handlers
  const handleEditFinding = (finding: RecordFindingWithCatalog) => {
    setEditingFinding(finding);
    setIsAddingFinding(false);
  };

  const handleAddFinding = () => {
    setEditingFinding(null);
    setIsAddingFinding(true);
  };

  const handleSaveFinding = async (data: {
    finding_type_id: string | null;
    finding_code: string | null;
    finding_type_text: string;
    body_site_id: string | null;
    site_code: string | null;
    body_site_text: string | null;
    size_mm: number | null;
    count: number | null;
    severity: FindingSeverity;
    laterality: FindingLaterality;
    morphology: string | null;
    description: string | null;
    histology: string | null;
    finding_date: string | null;
    source_anchor: string;
  }) => {
    if (isAddingFinding && record) {
      await createFindingMutation.mutateAsync({
        person_id: record.person_id,
        record_id: recordId,
        ...data,
        is_llm_extracted: false,
        is_user_verified: true,
      });
    } else if (editingFinding) {
      await updateFindingMutation.mutateAsync({
        id: editingFinding.id,
        updates: {
          ...data,
          is_user_verified: true,
        },
      });
    }

    setEditingFinding(null);
    setIsAddingFinding(false);
  };

  const handleDeleteFinding = async (finding: RecordFindingWithCatalog) => {
    await deleteFindingMutation.mutateAsync({ id: finding.id, recordId });
  };

  // Condition handlers
  const handleEditCondition = (cr: ConditionRecordWithDetails) => {
    setEditingCondition(cr);
    setIsAddingCondition(false);
  };

  const handleAddCondition = () => {
    setEditingCondition(null);
    setIsAddingCondition(true);
  };

  const handleSaveCondition = async (data: {
    condition_id?: string;
    name?: string;
    code?: string | null;
    icd_name_en?: string | null;
    icd_name_ru?: string | null;
    status_in_record: ConditionStatus;
    source_anchor: string | null;
  }) => {
    if (isAddingCondition && record) {
      if (data.condition_id) {
        // Linking to existing condition (auto-updates current_status if most recent)
        await linkConditionToRecordMutation.mutateAsync({
          condition_id: data.condition_id,
          record_id: recordId,
          status_in_record: data.status_in_record,
          source_anchor: data.source_anchor || undefined,
          // Pass ICD code if user added one
          code: data.code,
          icd_name_en: data.icd_name_en,
        });
      } else if (data.name) {
        // Creating new condition
        await createConditionWithRecordMutation.mutateAsync({
          person_id: record.person_id,
          record_id: recordId,
          name: data.name,
          code: data.code,
          icd_name_en: data.icd_name_en,
          icd_name_ru: data.icd_name_ru,
          status: data.status_in_record,
          source_anchor: data.source_anchor || undefined,
        });
      }
    } else if (editingCondition) {
      // Editing existing condition record (auto-updates current_status if most recent)
      await updateConditionRecordMutation.mutateAsync({
        id: editingCondition.id,
        updates: {
          status_in_record: data.status_in_record,
          source_anchor: data.source_anchor,
          is_user_verified: true,
        },
        recordId: recordId,
        conditionId: editingCondition.condition_id,
        code: data.code,
        icd_name_en: data.icd_name_en,
      });
    }

    setEditingCondition(null);
    setIsAddingCondition(false);
  };

  const handleDeleteCondition = async (cr: ConditionRecordWithDetails) => {
    await deleteConditionRecordMutation.mutateAsync({
      id: cr.id,
      recordId: recordId,
    });
  };

  const startEditing = () => {
    if (record) {
      setEditForm({
        title: record.title,
        record_type: record.record_type,
        record_date: record.record_date || "",
        notes: record.notes || "",
        ocr_text: record.ocr_text || "",
        llm_keywords: record.llm_keywords || [],
      });
      setNewTag("");
      setIsEditing(true);
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveChanges = () => {
    updateMutation.mutate(
      {
        id: recordId,
        updates: {
          title: editForm.title,
          record_type: editForm.record_type,
          record_date: editForm.record_date || null,
          notes: editForm.notes || null,
          ocr_text: editForm.ocr_text || null,
          llm_keywords: editForm.llm_keywords.length > 0 ? editForm.llm_keywords : null,
        },
      },
      {
        onSuccess: () => {
          setIsEditing(false);
        },
      },
    );
  };

  const addTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !editForm.llm_keywords.includes(trimmed)) {
      setEditForm((prev) => ({
        ...prev,
        llm_keywords: [...prev.llm_keywords, trimmed],
      }));
      setNewTag("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setEditForm((prev) => ({
      ...prev,
      llm_keywords: prev.llm_keywords.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  const handleRemove = () => {
    setShowRemoveDialog(true);
  };

  const confirmRemove = () => {
    softDeleteMutation.mutate(recordId, {
      onSuccess: () => {
        setShowRemoveDialog(false);
        router.push("/health");
      },
    });
  };

  const handleRestore = () => {
    restoreMutation.mutate(recordId);
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    hardDeleteMutation.mutate(recordId, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        router.push("/health");
      },
    });
  };

  const handleActivate = () => {
    updateMutation.mutate(
      { id: recordId, updates: { status: "active" } },
      {
        onSuccess: () => {
          router.push("/health");
        },
      },
    );
  };

  if (isLoading) {
    return <RecordDetailSkeleton />;
  }

  if (error || !record) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {error?.message || "Record not found"}
          </p>
        </div>
      </div>
    );
  }

  const isRemoved = record.status === "removed";
  const isDraft = record.status === "draft";
  const isOcrReview = record.status === "ocr_review";
  const isOcrFailed = record.status === "ocr_failed";
  const isStructureReview = record.status === "structure_review";
  const isProcessing = record.status === "ocr_processing" || record.status === "structuring";

  // Show OCR failed state: error message and Retry OCR button
  if (isOcrFailed) {
    const personName = persons?.find((p) => p.id === record.person_id)?.name ?? record.title ?? "";
    const handleRetryOcr = async () => {
      await retryOcr({
        recordId,
        personId: record.person_id,
        personName,
      });
      refetch();
    };
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{t("processing.ocrFailed")}</h1>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            {record.ocr_error || t("processing.failed")}
          </p>
          <Button onClick={handleRetryOcr}>{t("processing.retryOcr")}</Button>
        </div>
      </div>
    );
  }

  // Show processing state (use record title from OCR when available)
  if (isProcessing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {record.title || t("processing.processing")}
            </h1>
            <p className="text-muted-foreground">
              {record.status === "ocr_processing"
                ? t("processing.ocrInProgress")
                : t("processing.structureInProgress")}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">{t("processing.pleaseWait")}</p>
          <Button variant="outline" className="mt-6" onClick={() => refetch()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  // Show OCR review step
  if (isOcrReview) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{t("records.ocr.pageTitle")}</h1>
        </div>
        <OcrReviewStep
          recordId={recordId}
          ocrText={record.ocr_text || ""}
          attachments={record.attachments}
          onComplete={() => refetch()}
        />
      </div>
    );
  }

  // Show structure review step
  if (isStructureReview) {
    const handleBackToOcr = () => {
      updateMutation.mutate(
        { id: recordId, updates: { status: "ocr_review" } },
        { onSuccess: () => refetch() },
      );
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <Badge variant="secondary" className="mb-1">
              {t("records.status.structureReview")}
            </Badge>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("records.structure.reviewTitle")}
            </h1>
          </div>
        </div>
        <StructureReviewStep
          record={record}
          onComplete={() => refetch()}
          onBack={handleBackToOcr}
        />
      </div>
    );
  }

  // Default view for draft, active, removed statuses
  return (
    <div className="space-y-6">
      {/* Header - Mobile responsive */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {isEditing ? (
                <Select
                  value={editForm.record_type}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({ ...prev, record_type: value as RecordType }))
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECORD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`records.types.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge
                  variant="outline"
                  className={cn("font-medium", RECORD_TYPE_COLORS[record.record_type])}
                >
                  {t(`records.types.${record.record_type}`)}
                </Badge>
              )}
              {isDraft && <Badge variant="secondary">{t("records.status.draft")}</Badge>}
              {isRemoved && <Badge variant="destructive">{t("records.status.removed")}</Badge>}
            </div>
            {isEditing ? (
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                className="text-xl font-bold"
                placeholder={t("records.add.recordTitlePlaceholder")}
              />
            ) : (
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{record.title}</h1>
            )}
          </div>
        </div>

        {/* Actions - scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 shrink-0">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={cancelEditing}>
                <X className="mr-2 h-4 w-4" />
                {t("common.cancel")}
              </Button>
              <Button onClick={saveChanges} disabled={updateMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {t("common.save")}
              </Button>
            </>
          ) : (
            <>
              {!isRemoved && (
                <Button variant="outline" onClick={startEditing}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("common.edit")}
                </Button>
              )}
              {isDraft && (
                <Button onClick={handleActivate} disabled={updateMutation.isPending}>
                  <FileCheck className="mr-2 h-4 w-4" />
                  {t("records.add.saveAndActivate")}
                </Button>
              )}
              {!isRemoved && !isDraft && (
                <Button
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={softDeleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("records.actions.remove")}
                </Button>
              )}
              {isRemoved && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleRestore}
                    disabled={restoreMutation.isPending}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t("records.actions.restore")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={hardDeleteMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("records.actions.delete")}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          {isEditing ? (
            <Input
              type="date"
              value={editForm.record_date}
              onChange={(e) => setEditForm((prev) => ({ ...prev, record_date: e.target.value }))}
              className="h-8 w-auto"
            />
          ) : (
            <span>
              {record.record_date
                ? format(new Date(record.record_date), "MMMM d, yyyy", { locale: dateLocale })
                : t("records.noDate")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span>
            {t("records.detail.createdAt")}:{" "}
            {format(new Date(record.created_at), "MMM d, yyyy 'at' HH:mm", { locale: dateLocale })}
          </span>
        </div>
        {record.updated_at !== record.created_at && (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>
              {t("records.detail.updatedAt")}:{" "}
              {format(new Date(record.updated_at), "MMM d, yyyy 'at' HH:mm", {
                locale: dateLocale,
              })}
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* Keywords */}
      {(record.llm_keywords && record.llm_keywords.length > 0) || isEditing ? (
        <>
          <div>
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <Tag className="h-4 w-4" />
              {t("records.detail.keywords")}
            </h2>
            {isEditing ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {editForm.llm_keywords.map((keyword, index) => (
                    <Badge key={index} variant="secondary" className="gap-1 pr-1">
                      {keyword}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTag(keyword)}
                        className="h-5 w-5 ml-1 rounded-full p-0 hover:bg-muted-foreground/20"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder={t("records.wizard.addKeyword")}
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={addTag}
                    disabled={!newTag.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {record.llm_keywords?.map((keyword, index) => (
                  <Badge key={index} variant="secondary">
                    {keyword}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Separator />
        </>
      ) : null}

      {/* Observations */}
      {record.status === "active" && (
        <>
          <Card className="p-4 sm:p-6">
            <CardHeader className="p-0 pb-3 sm:pb-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 shrink-0" />
                  {t("records.detail.observations")} ({observations?.length || 0})
                </h2>
                {!isRemoved && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddObservation}
                    disabled={isObsProcessing}
                    className="w-full sm:w-auto shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t("observations.add")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {observations && observations.length > 0 ? (
                <div className="space-y-2">
                  {observations.map((obs) => (
                    <ObservationRowEditable
                      key={obs.id}
                      observation={obs}
                      comparison={getComparisonForObservation(obs)}
                      onEdit={() => handleEditObservation(obs)}
                      onDelete={() => handleDeleteObservation(obs)}
                      isProcessing={isObsProcessing}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 sm:py-8 text-muted-foreground border rounded-lg border-dashed">
                  <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t("observations.noObservations")}</p>
                  <p className="text-xs mt-1">{t("observations.noObservationsHint")}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Separator />

          {/* Edit/Add Observation Dialog */}
          <ObservationEditDialog
            open={!!editingObservation || isAddingObservation}
            onOpenChange={(open) => {
              if (!open) {
                setEditingObservation(null);
                setIsAddingObservation(false);
              }
            }}
            observation={editingObservation}
            onSave={handleSaveObservation}
            isNew={isAddingObservation}
          />

          {/* Findings Section */}
          <Card className="p-4 sm:p-6">
            <CardHeader className="p-0 pb-3 sm:pb-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 shrink-0" />
                  {t("findings.title")} ({findings?.length || 0})
                </h2>
                {!isRemoved && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddFinding}
                    disabled={isFindingProcessing}
                    className="w-full sm:w-auto shrink-0"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t("findings.add")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {findings && findings.length > 0 ? (
                <div className="space-y-2">
                  {findings.map((finding) => (
                    <FindingRow
                      key={finding.id}
                      finding={finding}
                      comparison={getComparisonForFinding(finding)}
                      onEdit={isRemoved ? undefined : () => handleEditFinding(finding)}
                      onDelete={isRemoved ? undefined : () => handleDeleteFinding(finding)}
                      isProcessing={isFindingProcessing}
                      showActions={!isRemoved}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 sm:py-8 text-muted-foreground border rounded-lg border-dashed">
                  <Stethoscope className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t("findings.noFindings")}</p>
                  <p className="text-xs mt-1">{t("findings.noFindingsHint")}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Separator />

          {/* Edit/Add Finding Dialog */}
          <FindingEditDialog
            open={!!editingFinding || isAddingFinding}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setEditingFinding(null);
                setIsAddingFinding(false);
              }
            }}
            finding={editingFinding}
            recordDate={record?.record_date ?? null}
            onSave={handleSaveFinding}
            isNew={isAddingFinding}
          />

          {/* Conditions Section */}
          <Card className="p-4 sm:p-6">
            <CardHeader className="p-0 pb-3 sm:pb-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <HeartPulse className="h-4 w-4 shrink-0" />
                  {t("conditions.title")} ({conditionRecords?.length || 0})
                </h2>
                {!isRemoved && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddCondition}
                    disabled={isConditionProcessing}
                    className="w-full sm:w-auto shrink-0"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t("conditions.add")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {conditionRecords && conditionRecords.length > 0 ? (
                <div className="space-y-2">
                  {conditionRecords.map((cr) => (
                    <ConditionRecordRow
                      key={cr.id}
                      conditionRecord={cr}
                      comparison={getComparisonForCondition(cr)}
                      onEdit={isRemoved ? undefined : () => handleEditCondition(cr)}
                      onDelete={isRemoved ? undefined : () => handleDeleteCondition(cr)}
                      isProcessing={isConditionProcessing}
                      showActions={!isRemoved}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 sm:py-8 text-muted-foreground border rounded-lg border-dashed">
                  <HeartPulse className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t("conditions.noConditions")}</p>
                  <p className="text-xs mt-1">{t("conditions.noConditionsHint")}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Separator />

          {/* Edit/Add Condition Dialog */}
          <ConditionEditDialog
            open={!!editingCondition || isAddingCondition}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setEditingCondition(null);
                setIsAddingCondition(false);
              }
            }}
            conditionRecord={editingCondition}
            existingConditions={personConditions || []}
            onSave={handleSaveCondition}
            isNew={isAddingCondition}
          />
        </>
      )}

      {/* Notes (used as summary) */}
      <div>
        <h2 className="text-lg font-semibold mb-2">{t("records.detail.notes")}</h2>
        {isEditing ? (
          <Textarea
            value={editForm.notes}
            onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder={t("records.add.notesPlaceholder")}
            rows={4}
          />
        ) : record.notes ? (
          <p className="text-muted-foreground whitespace-pre-wrap">{record.notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">{t("records.detail.noNotes")}</p>
        )}
      </div>

      <Separator />

      {/* OCR Text (collapsible) */}
      {(record.ocr_text || isEditing) && (
        <>
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowOcrText(!showOcrText)}
              className="w-full justify-between text-left h-auto p-0 hover:bg-transparent"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>
                  {t("records.detail.ocrText")}
                  {record.ocr_text && ` (${record.ocr_text.length} ${t("records.wizard.chars")})`}
                </span>
              </div>
              {showOcrText ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
            {showOcrText &&
              (isEditing ? (
                <Textarea
                  value={editForm.ocr_text}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, ocr_text: e.target.value }))}
                  className="mt-3 min-h-[200px] font-mono text-xs"
                  placeholder={t("records.wizard.ocrTextPlaceholder")}
                />
              ) : (
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">
                  {record.ocr_text || t("records.detail.noOcrText")}
                </pre>
              ))}
          </div>
          <Separator />
        </>
      )}

      {/* Attachments */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          {t("records.detail.attachments")} ({record.attachments.length})
        </h2>
        <AttachmentGrid attachments={record.attachments} />
      </div>

      {/* Remove confirmation dialog */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("records.confirm.removeMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete permanently confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("records.confirm.deleteMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Helper component for displaying observation status
function ObservationStatusBadge({ status }: { status: ObservationStatus | null }) {
  if (!status || status === "unknown") return null;

  const config: Record<ObservationStatus, { color: string; icon: React.ReactNode }> = {
    normal: {
      color: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
      icon: null,
    },
    low: {
      color: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
      icon: <ArrowDown className="h-3 w-3" />,
    },
    high: {
      color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
      icon: <ArrowUp className="h-3 w-3" />,
    },
    critical_low: {
      color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    critical_high: {
      color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    unknown: {
      color: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
      icon: null,
    },
  };

  const { color, icon } = config[status] || config.unknown;

  return (
    <Badge variant="outline" className={cn("gap-1 text-xs", color)}>
      {icon}
      {status.replace("_", " ")}
    </Badge>
  );
}

// Type for observation comparison
type ObservationComparisonData = {
  isNew: boolean;
  previousOccurrences: number;
  previousValue: number | null;
  previousUnit: string | null;
};

// Observation value change indicator
// Uses "closer to middle of reference range is better" logic
function ObservationValueChangeIndicator({
  currentValue,
  previousValue,
  unit,
  refLow,
  refHigh,
  defaultRefLow,
  defaultRefHigh,
}: {
  currentValue: number | null;
  previousValue: number | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  defaultRefLow?: number | null;
  defaultRefHigh?: number | null;
}) {
  const t = useTranslations();

  if (currentValue === null || previousValue === null) return null;

  // Round to 2 decimal places to avoid floating point issues
  const change = Math.round((currentValue - previousValue) * 100) / 100;

  if (change === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <span>
          = {previousValue}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
    );
  }

  const isIncrease = change > 0;
  const changeText = isIncrease ? `+${change}` : `${change}`;

  // Use specific ref range if available, otherwise use defaults
  const effectiveRefLow = refLow ?? defaultRefLow;
  const effectiveRefHigh = refHigh ?? defaultRefHigh;

  // Determine if change is an improvement based on distance from reference range middle
  let isImprovement: boolean | null = null;
  if (effectiveRefLow != null && effectiveRefHigh != null) {
    const middle = (effectiveRefLow + effectiveRefHigh) / 2;
    const prevDistance = Math.abs(previousValue - middle);
    const currDistance = Math.abs(currentValue - middle);
    isImprovement = currDistance < prevDistance;
  }

  // Determine color: green = improvement, red = worsening, gray = unknown
  let colorClass = "text-muted-foreground"; // fallback if no ref range
  if (isImprovement === true) {
    colorClass = "text-green-600 dark:text-green-400";
  } else if (isImprovement === false) {
    colorClass = "text-red-600 dark:text-red-400";
  }

  return (
    <span className={cn("flex items-center gap-0.5 text-xs", colorClass)}>
      {isIncrease ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      <span>{changeText}</span>
      <span className="text-muted-foreground/70">
        ({t("observations.comparison.was")} {previousValue})
      </span>
    </span>
  );
}

// Observation comparison badge
function ObservationComparisonBadge({ comparison }: { comparison: ObservationComparisonData }) {
  const t = useTranslations();
  if (comparison.isNew) {
    return (
      <Badge
        variant="outline"
        className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1"
      >
        <CircleDot className="h-3 w-3" />
        {t("observations.comparison.new")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20 gap-1"
      title={t("observations.comparison.knownTitle", { count: comparison.previousOccurrences })}
    >
      <History className="h-3 w-3" />
      {t("observations.comparison.known", { count: comparison.previousOccurrences })}
    </Badge>
  );
}

// Observation row component with edit/delete buttons
function ObservationRowEditable({
  observation,
  comparison,
  onEdit,
  onDelete,
  isProcessing,
}: {
  observation: RecordObservationWithCatalog;
  comparison?: ObservationComparisonData | null;
  onEdit: () => void;
  onDelete: () => void;
  isProcessing: boolean;
}) {
  const t = useTranslations();
  const displayValue =
    observation.value_numeric !== null
      ? observation.value_numeric.toString()
      : observation.value_text || "—";

  const isBad =
    observation.status === "low" ||
    observation.status === "high" ||
    observation.status === "critical_low" ||
    observation.status === "critical_high";
  const isCustom = !observation.obs_code;

  // Format reference range display
  const hasRefRange = observation.ref_range_low !== null || observation.ref_range_high !== null;
  const refRangeLow = observation.ref_range_low !== null ? observation.ref_range_low : "—";
  const refRangeHigh = observation.ref_range_high !== null ? observation.ref_range_high : "—";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        isBad && "border-orange-500/30 bg-orange-500/5",
        isCustom && !isBad && "border-dashed border-muted-foreground/40",
        comparison?.isNew && !isBad && !isCustom && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{observation.obs_name}</span>
          {observation.obs_code ? (
            <span className="text-xs text-muted-foreground shrink-0">({observation.obs_code})</span>
          ) : (
            <Badge
              variant="outline"
              className="text-xs border-dashed text-muted-foreground"
              title={t("observations.addToCatalogHint")}
            >
              {t("observations.customBadge")}
            </Badge>
          )}
        </div>
        {/* Subtle hint for custom observations */}
        {isCustom && (
          <p className="text-xs text-muted-foreground/70 mt-1 italic">
            {t("observations.addToCatalogHint")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
        {/* Comparison badge */}
        {comparison && <ObservationComparisonBadge comparison={comparison} />}
        {/* Reference range */}
        {hasRefRange && (
          <div className="text-xs text-muted-foreground">
            <span className="text-[10px] text-muted-foreground/70">
              ({refRangeLow}–{refRangeHigh})
            </span>
          </div>
        )}
        {/* Value with change indicator */}
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="font-semibold">{displayValue}</span>
            {observation.unit && (
              <span className="ml-1 text-muted-foreground text-sm">{observation.unit}</span>
            )}
          </div>
          {comparison && !comparison.isNew && comparison.previousValue !== null && (
            <ObservationValueChangeIndicator
              currentValue={observation.value_numeric}
              previousValue={comparison.previousValue}
              unit={observation.unit}
              refLow={observation.ref_range_low}
              refHigh={observation.ref_range_high}
              defaultRefLow={observation.default_ref_low}
              defaultRefHigh={observation.default_ref_high}
            />
          )}
        </div>
        <ObservationStatusBadge status={observation.status} />
        <div className="flex items-center gap-0.5 ms-auto sm:ms-0">
          {observation.obs_code && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
              title={t("observations.openHistory")}
            >
              <Link href={`/health/observations/${encodeURIComponent(observation.obs_code)}`}>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            disabled={isProcessing}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isProcessing}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Observation Edit Dialog
function ObservationEditDialog({
  open,
  onOpenChange,
  observation,
  onSave,
  isNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  observation: Partial<RecordObservationWithCatalog> | null;
  onSave: (data: {
    obs_name: string;
    value_text: string;
    value_numeric: number | null;
    value_canonical: number | null;
    unit: string;
    unit_canonical: string | null;
    ref_range_text: string;
    ref_range_low: number | null;
    ref_range_high: number | null;
    ref_range_low_canonical: number | null;
    ref_range_high_canonical: number | null;
    status: ObservationStatus | null;
    obs_code: string | null;
  }) => void;
  isNew: boolean;
}) {
  const t = useTranslations();
  const { data: catalog } = useObservationCatalog();

  const [obsName, setObsName] = useState("");
  const [valueText, setValueText] = useState("");
  const [unit, setUnit] = useState("");
  const [refRange, setRefRange] = useState("");
  const [refRangeLow, setRefRangeLow] = useState("");
  const [refRangeHigh, setRefRangeHigh] = useState("");
  const [status, setStatus] = useState<ObservationStatus | null>(null);
  const [obsCode, setObsCode] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);

  useEffect(() => {
    if (open && observation) {
      setObsName(observation.obs_name || "");
      setValueText(observation.value_text || "");
      setUnit(observation.unit || "");
      setRefRange(observation.ref_range_text || "");
      setRefRangeLow(observation.ref_range_low?.toString() || "");
      setRefRangeHigh(observation.ref_range_high?.toString() || "");
      setStatus((observation.status as ObservationStatus) || null);
      setObsCode(observation.obs_code || null);
      setCatalogSearch("");
      setIsComboboxOpen(false);
    } else if (open && isNew) {
      setObsName("");
      setValueText("");
      setUnit("");
      setRefRange("");
      setRefRangeLow("");
      setRefRangeHigh("");
      setStatus(null);
      setObsCode(null);
      setCatalogSearch("");
      setIsComboboxOpen(false);
    }
  }, [open, observation, isNew]);

  // Convert value to canonical using catalog unit config
  const convertToCanonical = (value: number | null, unitStr: string): number | null => {
    if (value === null) return null;
    if (!currentCatalogEntry?.accepted_units) return value;

    // Find unit config (case-insensitive)
    const unitConfig = Object.entries(currentCatalogEntry.accepted_units).find(
      ([u]) => u.toLowerCase() === unitStr.toLowerCase(),
    )?.[1] as { factor_to_canonical?: number; formula_to_canonical?: string } | undefined;

    if (!unitConfig) return value;

    // Apply formula if exists
    if (unitConfig.formula_to_canonical) {
      try {
        // Formula uses 'x' as placeholder for value
        const formula = unitConfig.formula_to_canonical.replace(/x/g, value.toString());
        return eval(formula);
      } catch {
        return value;
      }
    }

    // Apply factor if exists
    if (unitConfig.factor_to_canonical) {
      return value * unitConfig.factor_to_canonical;
    }

    return value;
  };

  const handleSave = () => {
    const numericValue = parseFloat(valueText);
    const refLow = parseFloat(refRangeLow);
    const refHigh = parseFloat(refRangeHigh);
    const valueNumeric = !isNaN(numericValue) ? numericValue : null;
    const refLowVal = !isNaN(refLow) ? refLow : null;
    const refHighVal = !isNaN(refHigh) ? refHigh : null;
    const unitTrimmed = unit.trim();

    // Convert values to canonical
    const valueCanonical = convertToCanonical(valueNumeric, unitTrimmed);
    const refLowCanonical = convertToCanonical(refLowVal, unitTrimmed);
    const refHighCanonical = convertToCanonical(refHighVal, unitTrimmed);

    // Get canonical unit from catalog
    const unitCanonical = currentCatalogEntry?.canonical_unit || null;

    onSave({
      obs_name: obsName.trim(),
      value_text: valueText.trim(),
      value_numeric: valueNumeric,
      value_canonical: valueCanonical,
      unit: unitTrimmed,
      unit_canonical: unitCanonical,
      ref_range_text: refRange.trim(),
      ref_range_low: refLowVal,
      ref_range_high: refHighVal,
      ref_range_low_canonical: refLowCanonical,
      ref_range_high_canonical: refHighCanonical,
      status,
      obs_code: obsCode,
    });
  };

  const handleCatalogSelect = (code: string | null) => {
    if (code === null) {
      setObsCode(null);
      setUnit("");
      setCatalogSearch("");
      setIsComboboxOpen(false);
      return;
    }
    const entry = catalog?.find((c) => c.obs_code === code);
    if (entry) {
      setObsCode(code);
      setObsName(entry.name_ru);
      setUnit(entry.canonical_unit);
      setCatalogSearch("");
      setIsComboboxOpen(false);
    }
  };

  const currentCatalogEntry = obsCode ? catalog?.find((c) => c.obs_code === obsCode) : null;
  const acceptedUnits = currentCatalogEntry?.accepted_units
    ? Object.keys(currentCatalogEntry.accepted_units)
    : null;

  const filteredCatalog =
    catalog?.filter((item) => {
      if (!catalogSearch.trim()) return true;
      const search = catalogSearch.toLowerCase();
      return (
        item.obs_code.toLowerCase().includes(search) ||
        item.name_ru.toLowerCase().includes(search) ||
        item.name_en.toLowerCase().includes(search) ||
        item.synonyms_ru?.some((s) => s.toLowerCase().includes(search)) ||
        item.synonyms_en?.some((s) => s.toLowerCase().includes(search))
      );
    }) || [];

  const displayValue = currentCatalogEntry
    ? `${currentCatalogEntry.name_ru} (${currentCatalogEntry.obs_code})`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? t("observations.addObservation") : t("observations.editObservation")}
          </DialogTitle>
          <DialogDescription>{t("observations.editDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Searchable catalog combobox */}
          {catalog && catalog.length > 0 && (
            <div className="space-y-2">
              <Label>{t("observations.fromCatalog")}</Label>
              <div className="relative">
                <Popover
                  open={isComboboxOpen}
                  onOpenChange={(open) => {
                    setIsComboboxOpen(open);
                    if (open) setCatalogSearch("");
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={isComboboxOpen}
                      className={`h-10 w-full justify-between px-3 py-2 text-sm ${!displayValue ? "text-muted-foreground" : ""}`}
                    >
                      <span className="truncate">
                        {displayValue || t("observations.searchOrSelect")}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={catalogSearch}
                        onValueChange={setCatalogSearch}
                        placeholder={t("observations.searchOrSelect")}
                        autoFocus
                      />
                      <CommandList className="max-h-60">
                        <CommandGroup>
                          <CommandItem
                            value="__custom__"
                            onSelect={() => handleCatalogSelect(null)}
                            className={obsCode === null ? "bg-accent" : ""}
                          >
                            <Check
                              className={`h-4 w-4 ${obsCode === null ? "opacity-100" : "opacity-0"}`}
                            />
                            <span className="text-muted-foreground italic">
                              {t("observations.customObservation")}
                            </span>
                          </CommandItem>
                          {filteredCatalog.map((item) => (
                            <CommandItem
                              key={item.obs_code}
                              value={item.obs_code}
                              onSelect={() => handleCatalogSelect(item.obs_code)}
                              className={obsCode === item.obs_code ? "bg-accent" : ""}
                            >
                              <Check
                                className={`h-4 w-4 shrink-0 ${obsCode === item.obs_code ? "opacity-100" : "opacity-0"}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{item.name_ru}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {item.obs_code} · {item.canonical_unit}
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        {filteredCatalog.length === 0 && catalogSearch && (
                          <CommandEmpty>{t("catalogs.noSearchResults")}</CommandEmpty>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="obs_name">{t("observations.name")}</Label>
            <Input
              id="obs_name"
              value={obsName}
              onChange={(e) => setObsName(e.target.value)}
              placeholder={t("observations.namePlaceholder")}
              disabled={!!currentCatalogEntry}
            />
          </div>

          {/* Value and Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="value">{t("observations.value")}</Label>
              <Input
                id="value"
                value={valueText}
                onChange={(e) => setValueText(e.target.value)}
                placeholder="14.2"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("observations.unit")}</Label>
              {acceptedUnits && acceptedUnits.length > 0 ? (
                <Select
                  value={unit || "_none"}
                  onValueChange={(v) => setUnit(v === "_none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("observations.selectUnit")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">—</SelectItem>
                    {acceptedUnits.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="g/L" />
              )}
            </div>
          </div>

          {/* Reference range */}
          <div className="space-y-2">
            <Label>{t("observations.refRange")}</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ref_low" className="text-xs text-muted-foreground">
                  {t("observations.refLow")}
                </Label>
                <Input
                  id="ref_low"
                  type="number"
                  step="any"
                  value={refRangeLow}
                  onChange={(e) => setRefRangeLow(e.target.value)}
                  placeholder="12.0"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ref_high" className="text-xs text-muted-foreground">
                  {t("observations.refHigh")}
                </Label>
                <Input
                  id="ref_high"
                  type="number"
                  step="any"
                  value={refRangeHigh}
                  onChange={(e) => setRefRangeHigh(e.target.value)}
                  placeholder="16.0"
                />
              </div>
            </div>
            <Input
              value={refRange}
              onChange={(e) => setRefRange(e.target.value)}
              placeholder={t("observations.refRangeText")}
              className="text-xs"
            />
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>{t("observations.statusLabel")}</Label>
            <Select
              value={status || "_unknown"}
              onValueChange={(v) => setStatus(v === "_unknown" ? null : (v as ObservationStatus))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("observations.selectStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_unknown">{t("observations.status.unknown")}</SelectItem>
                <SelectItem value="normal">{t("observations.status.normal")}</SelectItem>
                <SelectItem value="low">{t("observations.status.low")}</SelectItem>
                <SelectItem value="high">{t("observations.status.high")}</SelectItem>
                <SelectItem value="critical_low">
                  {t("observations.status.critical_low")}
                </SelectItem>
                <SelectItem value="critical_high">
                  {t("observations.status.critical_high")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!obsName.trim()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-64" />
        </div>
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="aspect-[4/3]" />
          <Skeleton className="aspect-[4/3]" />
        </div>
      </div>
    </div>
  );
}

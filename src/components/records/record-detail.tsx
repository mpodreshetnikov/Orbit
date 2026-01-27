"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { AttachmentGrid } from "./attachment-preview";
import { OcrReviewStep } from "./ocr-review-step";
import { StructureReviewStep } from "./structure-review-step";
import {
  useMedicalRecord,
  useSoftDeleteRecord,
  useRestoreRecord,
  useHardDeleteRecord,
  useUpdateMedicalRecord,
} from "@/hooks";
import type { RecordType } from "@/types";
import { RECORD_TYPES } from "@/types";
import { cn } from "@/lib/utils";

const RECORD_TYPE_COLORS: Record<RecordType, string> = {
  lab: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  visit: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  imaging: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  prescription: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  vaccination: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  vet: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  other: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

interface RecordDetailProps {
  recordId: string;
}

export function RecordDetail({ recordId }: RecordDetailProps) {
  const t = useTranslations();
  const router = useRouter();

  const { data: record, isLoading, error, refetch } = useMedicalRecord(recordId);

  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showOcrText, setShowOcrText] = useState(false);
  
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
      }
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
      }
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
  const isStructureReview = record.status === "structure_review";
  const isProcessing = record.status === "ocr_processing" || record.status === "structuring";

  // Show processing state
  if (isProcessing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("processing.processing")}</h1>
            <p className="text-muted-foreground">
              {record.status === "ocr_processing" 
                ? t("processing.ocrInProgress") 
                : t("processing.structureInProgress")}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            {t("processing.pleaseWait")}
          </p>
          <Button 
            variant="outline" 
            className="mt-6"
            onClick={() => refetch()}
          >
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
          <div>
            <Badge variant="secondary" className="mb-1">{t("records.status.ocrReview")}</Badge>
            <h1 className="text-2xl font-bold tracking-tight">{t("records.ocr.reviewTitle")}</h1>
          </div>
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
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <Badge variant="secondary" className="mb-1">{t("records.status.structureReview")}</Badge>
            <h1 className="text-2xl font-bold tracking-tight">{t("records.structure.reviewTitle")}</h1>
          </div>
        </div>
        <StructureReviewStep
          record={record}
          onComplete={() => refetch()}
        />
      </div>
    );
  }

  // Default view for draft, active, removed statuses
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
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
              {isDraft && (
                <Badge variant="secondary">{t("records.status.draft")}</Badge>
              )}
              {isRemoved && (
                <Badge variant="destructive">{t("records.status.removed")}</Badge>
              )}
            </div>
            {isEditing ? (
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                className="text-xl font-bold"
                placeholder={t("records.add.recordTitlePlaceholder")}
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight">{record.title}</h1>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
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
                ? format(new Date(record.record_date), "MMMM d, yyyy")
                : t("records.noDate")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span>
            {t("records.detail.createdAt")}:{" "}
            {format(new Date(record.created_at), "MMM d, yyyy 'at' HH:mm")}
          </span>
        </div>
        {record.updated_at !== record.created_at && (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>
              {t("records.detail.updatedAt")}:{" "}
              {format(new Date(record.updated_at), "MMM d, yyyy 'at' HH:mm")}
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
                      <button
                        type="button"
                        onClick={() => removeTag(keyword)}
                        className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
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
            <button
              type="button"
              onClick={() => setShowOcrText(!showOcrText)}
              className="flex w-full items-center justify-between text-left"
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
            </button>
            {showOcrText && (
              isEditing ? (
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
              )
            )}
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
            <AlertDialogDescription>
              {t("records.confirm.removeMessage")}
            </AlertDialogDescription>
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
            <AlertDialogDescription>
              {t("records.confirm.deleteMessage")}
            </AlertDialogDescription>
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

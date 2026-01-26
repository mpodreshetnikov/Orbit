"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  FileCheck,
  X,
  AlertCircle,
  Bug,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Progress } from "@/components/ui/progress";
import { FileDropzone } from "./file-dropzone";
import { AttachmentPreview } from "./attachment-preview";
import {
  useCreateMedicalRecord,
  useUpdateMedicalRecord,
  useUploadMultipleAttachments,
  useHardDeleteRecord,
  useIngestRecord,
  useMedicalRecord,
} from "@/hooks";
import { RECORD_TYPES, type RecordType, type ExtractionResult } from "@/types";
import { cn } from "@/lib/utils";

type WizardStep = 1 | 2 | 3 | 4;

interface AddRecordWizardProps {
  personId: string;
  personName: string;
}

interface FormData {
  title: string;
  recordType: RecordType;
  recordDate: string;
  notes: string;
  keywords: string[];
}

const STEP_LABELS = {
  1: "upload",
  2: "processing",
  3: "review",
  4: "complete",
} as const;

export function AddRecordWizard({ personId, personName }: AddRecordWizardProps) {
  const t = useTranslations();
  const router = useRouter();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [draftRecordId, setDraftRecordId] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [formData, setFormData] = useState<FormData>({
    title: "",
    recordType: "other",
    recordDate: format(new Date(), "yyyy-MM-dd"),
    notes: "",
    keywords: [],
  });
  const [newKeyword, setNewKeyword] = useState("");
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [showOcrDebug, setShowOcrDebug] = useState(false);

  // Mutations
  const createMutation = useCreateMedicalRecord();
  const updateMutation = useUpdateMedicalRecord();
  const uploadMutation = useUploadMultipleAttachments();
  const deleteMutation = useHardDeleteRecord();
  const ingestMutation = useIngestRecord();

  // Fetch created record for preview
  const { data: createdRecord } = useMedicalRecord(draftRecordId);

  // Processing progress (upload = 30%, LLM vision OCR = 70%)
  const totalProgress = uploadMutation.isPending
    ? 0.15 // Uploading
    : ingestMutation.isPending
    ? 0.5 // LLM processing (halfway)
    : extractionResult
    ? 1
    : 0;

  // Handle files selected
  const handleFilesSelected = useCallback((files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files]);
  }, []);

  // Handle file removal
  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Navigate back
  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      if (selectedFiles.length > 0) {
        setShowDiscardDialog(true);
      } else {
        router.back();
      }
    } else if (currentStep === 2) {
      // Cancel processing and go back to upload
      setCurrentStep(1);
      setProcessingError(null);
    } else if (currentStep === 3) {
      // Show confirmation to discard and restart
      setShowDiscardDialog(true);
    }
  }, [currentStep, selectedFiles.length, router]);

  // Discard and go back
  const handleDiscard = useCallback(async () => {
    // If we have a draft record, delete it
    if (draftRecordId) {
      try {
        await deleteMutation.mutateAsync(draftRecordId);
      } catch {
        // Ignore errors, continue with discard
      }
    }
    
    // Reset state
    setSelectedFiles([]);
    setDraftRecordId(null);
    setExtractionResult(null);
    setFormData({
      title: "",
      recordType: "other",
      recordDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      keywords: [],
    });
    setProcessingError(null);
    setOcrText("");
    setShowOcrDebug(false);

    if (currentStep === 3) {
      // Go back to step 1 to redo
      setCurrentStep(1);
    } else {
      router.back();
    }
  }, [draftRecordId, deleteMutation, currentStep, router]);

  // Start processing (Step 1 -> Step 2)
  const startProcessing = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setCurrentStep(2);
    setProcessingError(null);

    try {
      // Step 1: Create draft record
      const record = await createMutation.mutateAsync({
        person_id: personId,
        title: "Processing...",
        record_type: "other",
        record_date: format(new Date(), "yyyy-MM-dd"),
        status: "draft",
      });
      setDraftRecordId(record.id);

      // Step 2: Upload files
      await uploadMutation.mutateAsync({
        recordId: record.id,
        personId: personId,
        files: selectedFiles,
      });

      // Step 3: Call LLM Vision for OCR + extraction (all done server-side)
      const ingestResult = await ingestMutation.mutateAsync({
        recordId: record.id,
      });

      if (ingestResult.extraction) {
        const extraction = ingestResult.extraction;
        
        // Save OCR text for debug display
        setOcrText(extraction.ocr_text || "");

        setExtractionResult({
          ocr_text: extraction.ocr_text || "",
          record_type: extraction.record_type as RecordType,
          title: extraction.title,
          record_date: extraction.record_date,
          summary: extraction.summary,
          keywords: extraction.keywords,
        });

        // Pre-fill form with extraction results
        setFormData({
          title: extraction.title,
          recordType: (extraction.record_type as RecordType) || "other",
          recordDate: extraction.record_date || format(new Date(), "yyyy-MM-dd"),
          notes: extraction.summary,
          keywords: extraction.keywords || [],
        });
      } else {
        // No extraction result, continue with empty
        setExtractionResult({
          ocr_text: "",
          record_type: "other",
          title: "",
          record_date: null,
          summary: "",
          keywords: [],
        });
      }

      // Move to review step
      setCurrentStep(3);
    } catch (error) {
      console.error("Processing error:", error);
      setProcessingError(
        error instanceof Error ? error.message : "Processing failed"
      );
    }
  }, [
    selectedFiles,
    personId,
    createMutation,
    uploadMutation,
    ingestMutation,
  ]);

  // Finalize record (Step 3 -> Step 4)
  const finalizeRecord = useCallback(async () => {
    if (!draftRecordId) return;

    try {
      await updateMutation.mutateAsync({
        id: draftRecordId,
        updates: {
          title: formData.title || "Medical Record",
          record_type: formData.recordType,
          record_date: formData.recordDate || null,
          notes: formData.notes || null,
          ocr_text: ocrText || null,
          status: "active",
        },
      });

      setCurrentStep(4);
    } catch (error) {
      console.error("Finalize error:", error);
      setProcessingError(
        error instanceof Error ? error.message : "Failed to save record"
      );
    }
  }, [draftRecordId, formData, ocrText, updateMutation]);

  // Add keyword
  const handleAddKeyword = useCallback(() => {
    const keyword = newKeyword.trim();
    if (keyword && !formData.keywords.includes(keyword)) {
      setFormData((prev) => ({
        ...prev,
        keywords: [...prev.keywords, keyword],
      }));
      setNewKeyword("");
    }
  }, [newKeyword, formData.keywords]);

  // Remove keyword
  const handleRemoveKeyword = useCallback((keyword: string) => {
    setFormData((prev) => ({
      ...prev,
      keywords: prev.keywords.filter((k) => k !== keyword),
    }));
  }, []);

  // View record
  const handleViewRecord = useCallback(() => {
    if (draftRecordId) {
      router.push(`/health/records/${draftRecordId}`);
    }
  }, [draftRecordId, router]);

  // Go to records list
  const handleGoToList = useCallback(() => {
    router.push("/health");
  }, [router]);

  // Add another record (reset wizard)
  const handleAddAnother = useCallback(() => {
    setSelectedFiles([]);
    setDraftRecordId(null);
    setExtractionResult(null);
    setFormData({
      title: "",
      recordType: "other",
      recordDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      keywords: [],
    });
    setProcessingError(null);
    setOcrText("");
    setShowOcrDebug(false);
    setCurrentStep(1);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header with step indicator */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          disabled={currentStep === 4 || createMutation.isPending || uploadMutation.isPending}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("records.add.title")}
          </h1>
          <p className="text-muted-foreground">
            {personName} — {t(`records.wizard.step${currentStep}`)}
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2, 3, 4] as WizardStep[]).map((step) => (
          <div
            key={step}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
              step === currentStep
                ? "bg-primary text-primary-foreground"
                : step < currentStep
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            {step < currentStep ? <Check className="h-4 w-4" /> : step}
          </div>
        ))}
        <div className="ml-2 text-sm text-muted-foreground">
          {t(`records.wizard.${STEP_LABELS[currentStep]}`)}
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {/* Step 1: Upload */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              selectedFiles={selectedFiles}
              onRemoveFile={handleRemoveFile}
              isUploading={false}
              maxFiles={10}
              showCamera={true}
            />

            <div className="flex justify-end">
              <Button
                onClick={startProcessing}
                disabled={selectedFiles.length === 0}
              >
                {t("records.wizard.continue")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Processing */}
        {currentStep === 2 && (
          <div className="flex flex-col items-center justify-center space-y-6 py-12">
            {processingError ? (
              <>
                <AlertCircle className="h-16 w-16 text-destructive" />
                <div className="text-center">
                  <h3 className="text-lg font-semibold">
                    {t("records.wizard.processingError")}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {processingError}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleBack}>
                    {t("common.back")}
                  </Button>
                  <Button onClick={startProcessing}>
                    {t("common.retry")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <div className="w-full max-w-md space-y-2">
                  <Progress value={totalProgress * 100} />
                  <p className="text-center text-sm text-muted-foreground">
                    {uploadMutation.isPending
                      ? t("records.wizard.uploading")
                      : ingestMutation.isPending
                      ? t("records.wizard.llmProcessing")
                      : t("records.wizard.processing")}
                  </p>
                </div>
                <Button variant="outline" onClick={handleBack}>
                  {t("common.cancel")}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Step 3: Review */}
        {currentStep === 3 && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left: Preview */}
            <div className="space-y-4">
              <h3 className="font-semibold">{t("records.wizard.preview")}</h3>
              
              {/* Attachment thumbnails */}
              {createdRecord?.attachments && createdRecord.attachments.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {createdRecord.attachments.slice(0, 4).map((attachment) => (
                    <AttachmentPreview
                      key={attachment.id}
                      attachment={attachment}
                      showActions={false}
                    />
                  ))}
                  {createdRecord.attachments.length > 4 && (
                    <div className="flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted">
                      <span className="text-sm text-muted-foreground">
                        +{createdRecord.attachments.length - 4} more
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Raw OCR Text (collapsible, editable) */}
              {ocrText && (
                <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3">
                  <button
                    type="button"
                    onClick={() => setShowOcrDebug(!showOcrDebug)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Bug className="h-4 w-4" />
                      <span>{t("records.wizard.rawOcrText")} ({ocrText.length} {t("records.wizard.chars")})</span>
                    </div>
                    {showOcrDebug ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {showOcrDebug && (
                    <Textarea
                      value={ocrText}
                      onChange={(e) => setOcrText(e.target.value)}
                      className="mt-3 min-h-[200px] font-mono text-xs"
                      placeholder={t("records.wizard.ocrTextPlaceholder")}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Right: Edit form */}
            <div className="space-y-4">
              <h3 className="font-semibold">{t("records.wizard.editFields")}</h3>

              {/* Record Type */}
              <div className="space-y-2">
                <Label htmlFor="recordType">{t("records.add.recordType")}</Label>
                <Select
                  value={formData.recordType}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      recordType: value as RecordType,
                    }))
                  }
                >
                  <SelectTrigger id="recordType">
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
              </div>

              {/* Record Date */}
              <div className="space-y-2">
                <Label htmlFor="recordDate">{t("records.add.recordDate")}</Label>
                <Input
                  id="recordDate"
                  type="date"
                  value={formData.recordDate}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      recordDate: e.target.value,
                    }))
                  }
                />
              </div>

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">{t("records.add.recordTitle")}</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder={t("records.add.recordTitlePlaceholder")}
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">{t("records.add.notes")}</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder={t("records.add.notesPlaceholder")}
                  rows={3}
                />
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <Label>{t("records.wizard.keywords")}</Label>
                <div className="flex flex-wrap gap-2">
                  {formData.keywords.map((keyword) => (
                    <Badge
                      key={keyword}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => handleRemoveKeyword(keyword)}
                    >
                      {keyword}
                      <X className="ml-1 h-3 w-3" />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder={t("records.wizard.addKeyword")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddKeyword();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddKeyword}
                    disabled={!newKeyword.trim()}
                  >
                    {t("common.add")}
                  </Button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="col-span-full flex items-center justify-between border-t pt-6">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("records.wizard.redoUpload")}
              </Button>
              <Button
                onClick={finalizeRecord}
                disabled={!formData.title.trim() || updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck className="mr-2 h-4 w-4" />
                )}
                {t("records.add.saveAndActivate")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {currentStep === 4 && (
          <div className="flex flex-col items-center justify-center space-y-6 py-12">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
              <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold">
                {t("records.wizard.complete")}
              </h3>
              <p className="mt-2 text-muted-foreground">
                {t("records.wizard.completeDescription")}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={handleGoToList}>
                {t("records.wizard.viewAll")}
              </Button>
              <Button variant="outline" onClick={handleViewRecord}>
                {t("records.wizard.viewRecord")}
              </Button>
              <Button onClick={handleAddAnother}>
                <Plus className="mr-2 h-4 w-4" />
                {t("records.wizard.addAnother")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Discard confirmation dialog */}
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.confirm.discardMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

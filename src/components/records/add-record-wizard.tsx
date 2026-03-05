"use client";

import React from "react";
import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
  Plus,
  FileStack,
  Eye,
  Upload,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  useCreateMedicalRecord,
  useDeleteAttachment,
  useHardDeleteRecord,
  useBackgroundOCR,
  useUploadAttachment,
  useUpdateMedicalRecord,
  useStructureExtraction,
} from "@/hooks";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
import type { RecordAttachment } from "@/types";
import { cn } from "@/lib/utils";

type InputMode = "upload" | "paste";

type WizardStep = 1 | 2 | 3;

type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

interface UploadQueueItem {
  id: string;
  file: File;
  status: UploadStatus;
  sortOrder: number;
  attachment?: RecordAttachment;
  error?: string;
}

interface AddRecordWizardProps {
  personId: string;
  personName: string;
}

const STEP_LABELS = {
  1: "upload",
  2: "starting",
  3: "queued",
} as const;

export function AddRecordWizard({ personId, personName }: AddRecordWizardProps) {
  const t = useTranslations();
  const router = useRouter();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [inputMode, setInputMode] = useState<InputMode>("upload");
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [draftRecordId, setDraftRecordId] = useState<string | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recordsStarted, setRecordsStarted] = useState(0);
  const [isSubmittingPaste, setIsSubmittingPaste] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isRemovingFiles, setIsRemovingFiles] = useState(false);
  const draftCreationPromiseRef = useRef<Promise<string> | null>(null);
  const nextSortOrderRef = useRef(0);

  // Mutations and hooks
  const createMutation = useCreateMedicalRecord();
  const updateMutation = useUpdateMedicalRecord();
  const uploadAttachmentMutation = useUploadAttachment();
  const deleteAttachmentMutation = useDeleteAttachment();
  const deleteMutation = useHardDeleteRecord();
  const { startBackgroundOCR } = useBackgroundOCR();
  const { extractStructure } = useStructureExtraction();

  // Processing queue state - subscribe to jobs directly to get re-renders on changes
  const jobs = useProcessingQueueStore((state) => state.jobs);
  const activeJobs = Object.values(jobs).filter(
    (job) => job.stage === "uploading" || job.stage === "processing",
  );

  const selectedFiles = uploadQueue.map((item) => item.file);
  const uploadedCount = uploadQueue.filter((item) => item.status === "uploaded").length;
  const hasUploadFailures = uploadQueue.some((item) => item.status === "failed");
  const allUploadsComplete = uploadQueue.length > 0 && uploadedCount === uploadQueue.length;

  const ensureDraftRecord = useCallback(async (): Promise<string> => {
    if (draftRecordId) {
      return draftRecordId;
    }

    if (!draftCreationPromiseRef.current) {
      draftCreationPromiseRef.current = createMutation
        .mutateAsync({
          person_id: personId,
          title: t("processing.processing"),
          record_type: "other",
          record_date: format(new Date(), "yyyy-MM-dd"),
          status: "draft",
        })
        .then((record) => {
          setDraftRecordId(record.id);
          return record.id;
        })
        .finally(() => {
          draftCreationPromiseRef.current = null;
        });
    }

    return draftCreationPromiseRef.current;
  }, [createMutation, draftRecordId, personId, t]);

  const updateUploadQueueItem = useCallback((id: string, updates: Partial<UploadQueueItem>) => {
    setUploadQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const uploadFiles = useCallback(
    async (items: UploadQueueItem[]) => {
      setIsUploadingFiles(true);
      let recordId: string;
      try {
        recordId = await ensureDraftRecord();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to create record";
        setStartError(errorMessage);
        setUploadQueue((prev) =>
          prev.map((item) =>
            items.some((queued) => queued.id === item.id)
              ? { ...item, status: "failed", error: errorMessage }
              : item,
          ),
        );
        setIsUploadingFiles(false);
        return;
      }

      for (const item of items) {
        updateUploadQueueItem(item.id, { status: "uploading", error: undefined });
        try {
          const attachment = await uploadAttachmentMutation.mutateAsync({
            recordId,
            personId,
            file: item.file,
            sortOrder: item.sortOrder,
          });
          updateUploadQueueItem(item.id, {
            status: "uploaded",
            attachment,
            error: undefined,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Upload failed";
          updateUploadQueueItem(item.id, { status: "failed", error: errorMessage });
          setStartError(errorMessage);
        }
      }

      setIsUploadingFiles(false);
    },
    [ensureDraftRecord, personId, updateUploadQueueItem, uploadAttachmentMutation],
  );

  // Handle files selected
  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const newItems = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        file,
        status: "queued" as const,
        sortOrder: nextSortOrderRef.current++,
      }));
      setUploadQueue((prev) => [...prev, ...newItems]);
      setStartError(null);
      void uploadFiles(newItems);
    },
    [uploadFiles],
  );

  // Handle file removal
  const handleRemoveFile = useCallback(
    (index: number) => {
      const queueItem = uploadQueue[index];
      if (!queueItem || queueItem.status === "uploading") {
        return;
      }

      setUploadQueue((prev) => prev.filter((_, i) => i !== index));

      if (queueItem.attachment) {
        setIsRemovingFiles(true);
        void deleteAttachmentMutation
          .mutateAsync(queueItem.attachment)
          .catch((error) => {
            const errorMessage =
              error instanceof Error ? error.message : "Failed to remove attachment";
            setStartError(errorMessage);
          })
          .finally(() => setIsRemovingFiles(false));
      }
    },
    [deleteAttachmentMutation, uploadQueue],
  );

  // Navigate back
  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      if (selectedFiles.length > 0 || pastedText.trim().length > 0 || draftRecordId) {
        setShowDiscardDialog(true);
      } else {
        router.back();
      }
    } else if (currentStep === 2) {
      // Already processing, can't go back
      return;
    } else if (currentStep === 3) {
      // From queued screen, just go back to main page
      router.push("/health");
    }
  }, [currentStep, selectedFiles.length, pastedText, draftRecordId, router]);

  // Discard and go back
  const handleDiscard = useCallback(async () => {
    // If we have a draft record that wasn't started, delete it
    if (draftRecordId) {
      try {
        await deleteMutation.mutateAsync(draftRecordId);
      } catch {
        // Ignore errors, continue with discard
      }
    }

    // Reset state
    setUploadQueue([]);
    setPastedText("");
    setDraftRecordId(null);
    draftCreationPromiseRef.current = null;
    nextSortOrderRef.current = 0;
    setStartError(null);
    setShowDiscardDialog(false);
    router.back();
  }, [draftRecordId, deleteMutation, router]);

  // Submit pasted text (skip OCR entirely, go directly to structure extraction)
  const submitPastedText = useCallback(async () => {
    if (pastedText.trim().length === 0) return;

    setIsSubmittingPaste(true);
    setStartError(null);

    try {
      // Create draft record with ocr_text already filled
      const record = await createMutation.mutateAsync({
        person_id: personId,
        title: t("processing.processing"),
        record_type: "other",
        record_date: format(new Date(), "yyyy-MM-dd"),
        status: "draft",
      });

      // Update with pasted text (status will be set to 'structuring' by extractStructure)
      await updateMutation.mutateAsync({
        id: record.id,
        updates: {
          ocr_text: pastedText.trim(),
        },
      });

      // Start structure extraction immediately (this sets status to 'structuring')
      // Don't await - let it run in background
      extractStructure({ recordId: record.id });

      // Navigate to the record page - it will show structuring state, then structure_review
      router.push(`/health/records/${record.id}`);
    } catch (error) {
      console.error("Submit pasted text error:", error);
      setStartError(error instanceof Error ? error.message : "Failed to create record");
    } finally {
      setIsSubmittingPaste(false);
    }
  }, [pastedText, personId, t, createMutation, updateMutation, extractStructure, router]);

  // Start processing (Step 1 -> Step 2 -> Step 3)
  const startProcessing = useCallback(async () => {
    if (!draftRecordId || !allUploadsComplete) return;

    setCurrentStep(2);
    setStartError(null);

    try {
      // Step 1: Start OCR for already uploaded attachments (doesn't wait for completion)
      startBackgroundOCR({
        recordId: draftRecordId,
        personId: personId,
        personName: personName,
        files: [],
      });

      // Move to queued step
      setRecordsStarted((prev) => prev + 1);
      setCurrentStep(3);
    } catch (error) {
      console.error("Start processing error:", error);
      setStartError(error instanceof Error ? error.message : "Failed to start processing");
      setCurrentStep(1);
    }
  }, [allUploadsComplete, draftRecordId, personId, personName, startBackgroundOCR]);

  // Add another record (reset wizard)
  const handleAddAnother = useCallback(() => {
    setUploadQueue([]);
    setPastedText("");
    setDraftRecordId(null);
    draftCreationPromiseRef.current = null;
    nextSortOrderRef.current = 0;
    setStartError(null);
    setCurrentStep(1);
  }, []);

  // Go to records list
  const handleGoToList = useCallback(() => {
    router.push("/health");
  }, [router]);

  // View drafts
  const handleViewDrafts = useCallback(() => {
    router.push("/health?tab=draft");
  }, [router]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header with step indicator */}
      <div className="flex items-start gap-3 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          disabled={currentStep === 2}
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t("records.add.title")}</h1>
          <p className="text-sm text-muted-foreground truncate">
            {personName} — {t(`records.wizard.step${currentStep}`)}
          </p>
        </div>
        {/* Active processing badge */}
        {activeJobs.length > 0 && (
          <Badge variant="secondary" className="gap-1 shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="hidden sm:inline">
              {activeJobs.length} {t("processing.inProgress")}
            </span>
            <span className="sm:hidden">{activeJobs.length}</span>
          </Badge>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as WizardStep[]).map((step) => (
          <div
            key={step}
            className={cn(
              "flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-xs sm:text-sm font-medium transition-colors",
              step === currentStep
                ? "bg-primary text-primary-foreground"
                : step < currentStep
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {step < currentStep ? <Check className="h-3 w-3 sm:h-4 sm:w-4" /> : step}
          </div>
        ))}
        <div className="ml-2 text-xs sm:text-sm text-muted-foreground">
          {t(`records.wizard.${STEP_LABELS[currentStep]}`)}
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {/* Step 1: Upload or Paste */}
        {currentStep === 1 && (
          <div className="space-y-6">
            {startError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <p className="text-destructive">{startError}</p>
                </div>
              </div>
            )}

            {/* Input mode tabs */}
            <Tabs
              value={inputMode}
              onValueChange={(v) => setInputMode(v as InputMode)}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upload" className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t("records.wizard.uploadFiles")}
                </TabsTrigger>
                <TabsTrigger value="paste" className="gap-2">
                  <FileText className="h-4 w-4" />
                  {t("records.wizard.pasteText")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Upload mode */}
            {inputMode === "upload" && (
              <>
                <FileDropzone
                  onFilesSelected={handleFilesSelected}
                  selectedFiles={selectedFiles}
                  onRemoveFile={handleRemoveFile}
                  isUploading={isUploadingFiles || isRemovingFiles}
                  fileUploadStates={uploadQueue.map((item) => ({
                    status: item.status,
                    error: item.error,
                  }))}
                  maxFiles={10}
                  showCamera={true}
                />

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {recordsStarted > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {t("records.wizard.recordsQueued", { count: recordsStarted })}
                      </p>
                    )}
                    {uploadQueue.length > 0 && !allUploadsComplete && !hasUploadFailures && (
                      <p className="text-sm text-muted-foreground">
                        {t("records.wizard.waitingForUploads")}
                      </p>
                    )}
                    {uploadQueue.length > 0 && allUploadsComplete && (
                      <p className="text-sm text-emerald-600">{t("records.wizard.uploadReady")}</p>
                    )}
                    {hasUploadFailures && (
                      <p className="text-sm text-destructive">{t("records.wizard.uploadFailed")}</p>
                    )}
                    {uploadQueue.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("records.wizard.uploadingProgress", {
                          uploaded: uploadedCount,
                          total: uploadQueue.length,
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex-1" />
                  <Button
                    onClick={startProcessing}
                    disabled={!allUploadsComplete || isRemovingFiles}
                  >
                    {t("records.wizard.startProcessing")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </>
            )}

            {/* Paste mode */}
            {inputMode === "paste" && (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t("records.wizard.pasteDescription")}
                  </p>
                  <Textarea
                    placeholder={t("records.wizard.pasteTextPlaceholder")}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    className="min-h-[300px] font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {pastedText.length.toLocaleString()} {t("common.characters")}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  {recordsStarted > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("records.wizard.recordsQueued", { count: recordsStarted })}
                    </p>
                  )}
                  <div className="flex-1" />
                  <Button
                    onClick={submitPastedText}
                    disabled={pastedText.trim().length === 0 || isSubmittingPaste}
                  >
                    {isSubmittingPaste ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t("records.wizard.proceedToReview")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 2: Starting OCR */}
        {currentStep === 2 && (
          <div className="flex flex-col items-center justify-center space-y-6 py-12">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <div className="w-full max-w-md space-y-2">
              <Progress value={30} />
              <p className="text-center text-sm text-muted-foreground">
                {t("records.wizard.creatingRecord")}
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Queued - Allow adding more */}
        {currentStep === 3 && (
          <div className="flex flex-col items-center justify-center space-y-6 py-12">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <FileStack className="h-10 w-10 text-primary" />
            </div>
            <div className="text-center max-w-md">
              <h3 className="text-xl font-semibold">{t("records.wizard.recordQueued")}</h3>
              <p className="mt-2 text-muted-foreground">{t("records.wizard.queuedDescription")}</p>
              <p className="mt-4 text-sm text-muted-foreground">
                {t("records.wizard.notificationHint")}
              </p>
            </div>

            {/* Active jobs indicator */}
            {activeJobs.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">
                  {t("processing.processingCount", { count: activeJobs.length })}
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-2 sm:gap-3 w-full px-4 sm:px-0">
              {draftRecordId && (
                <Button
                  variant="default"
                  onClick={() => router.push(`/health/records/${draftRecordId}`)}
                  className="w-full sm:w-auto"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  {t("records.wizard.viewRecord")}
                </Button>
              )}
              <Button variant="outline" onClick={handleGoToList} className="w-full sm:w-auto">
                <Eye className="mr-2 h-4 w-4" />
                {t("records.wizard.viewAll")}
              </Button>
              <Button variant="outline" onClick={handleViewDrafts} className="w-full sm:w-auto">
                <FileStack className="mr-2 h-4 w-4" />
                {t("records.wizard.viewDrafts")}
              </Button>
              <Button variant="outline" onClick={handleAddAnother} className="w-full sm:w-auto">
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
            <AlertDialogDescription>{t("records.confirm.discardMessage")}</AlertDialogDescription>
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

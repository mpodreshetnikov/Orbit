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
  useHardDeleteRecord,
  useBackgroundOCR,
  useUpdateMedicalRecord,
  useStructureExtraction,
} from "@/hooks";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
import { cn } from "@/lib/utils";

type InputMode = "upload" | "paste";

type WizardStep = 1 | 2 | 3;

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [draftRecordId, setDraftRecordId] = useState<string | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recordsStarted, setRecordsStarted] = useState(0);
  const [isSubmittingPaste, setIsSubmittingPaste] = useState(false);

  // Mutations and hooks
  const createMutation = useCreateMedicalRecord();
  const updateMutation = useUpdateMedicalRecord();
  const deleteMutation = useHardDeleteRecord();
  const { startBackgroundOCR } = useBackgroundOCR();
  const { extractStructure } = useStructureExtraction();

  // Processing queue state
  const getActiveJobs = useProcessingQueueStore((state) => state.getActiveJobs);
  const activeJobs = getActiveJobs();

  // Handle files selected
  const handleFilesSelected = useCallback((files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files]);
    setStartError(null);
  }, []);

  // Handle file removal
  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Navigate back
  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      if (selectedFiles.length > 0 || pastedText.trim().length > 0) {
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
  }, [currentStep, selectedFiles.length, pastedText, router]);

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
    setSelectedFiles([]);
    setPastedText("");
    setDraftRecordId(null);
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
      setStartError(
        error instanceof Error ? error.message : "Failed to create record"
      );
    } finally {
      setIsSubmittingPaste(false);
    }
  }, [pastedText, personId, t, createMutation, updateMutation, extractStructure, router]);

  // Start processing (Step 1 -> Step 2 -> Step 3)
  const startProcessing = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setCurrentStep(2);
    setStartError(null);

    try {
      // Step 1: Create draft record
      const record = await createMutation.mutateAsync({
        person_id: personId,
        title: t("processing.processing"),
        record_type: "other",
        record_date: format(new Date(), "yyyy-MM-dd"),
        status: "draft",
      });
      setDraftRecordId(record.id);

      // Step 2: Start background OCR (doesn't wait for completion)
      startBackgroundOCR({
        recordId: record.id,
        personId: personId,
        personName: personName,
        files: selectedFiles,
      });

      // Move to queued step
      setRecordsStarted((prev) => prev + 1);
      setCurrentStep(3);
    } catch (error) {
      console.error("Start processing error:", error);
      setStartError(
        error instanceof Error ? error.message : "Failed to start processing"
      );
      setCurrentStep(1);
    }
  }, [
    selectedFiles,
    personId,
    personName,
    t,
    createMutation,
    startBackgroundOCR,
  ]);

  // Add another record (reset wizard)
  const handleAddAnother = useCallback(() => {
    setSelectedFiles([]);
    setPastedText("");
    setDraftRecordId(null);
    setStartError(null);
    setCurrentStep(1);
  }, []);

  // Go to records list
  const handleGoToList = useCallback(() => {
    router.push("/health");
  }, [router]);

  // View drafts
  const handleViewDrafts = useCallback(() => {
    router.push("/health?showDrafts=true");
  }, [router]);

  return (
    <div className="space-y-6">
      {/* Header with step indicator */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          disabled={currentStep === 2}
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
        {/* Active processing badge */}
        {activeJobs.length > 0 && (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {activeJobs.length} {t("processing.inProgress")}
          </Badge>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as WizardStep[]).map((step) => (
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
                  isUploading={false}
                  maxFiles={10}
                  showCamera={true}
                />

                <div className="flex items-center justify-between">
                  {recordsStarted > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("records.wizard.recordsQueued", { count: recordsStarted })}
                    </p>
                  )}
                  <div className="flex-1" />
                  <Button
                    onClick={startProcessing}
                    disabled={selectedFiles.length === 0}
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
                    {isSubmittingPaste ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
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
              <h3 className="text-xl font-semibold">
                {t("records.wizard.recordQueued")}
              </h3>
              <p className="mt-2 text-muted-foreground">
                {t("records.wizard.queuedDescription")}
              </p>
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

            <div className="flex flex-wrap justify-center gap-3">
              {draftRecordId && (
                <Button
                  variant="default"
                  onClick={() => router.push(`/health/records/${draftRecordId}`)}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  {t("records.wizard.viewRecord")}
                </Button>
              )}
              <Button variant="outline" onClick={handleGoToList}>
                <Eye className="mr-2 h-4 w-4" />
                {t("records.wizard.viewAll")}
              </Button>
              <Button variant="outline" onClick={handleViewDrafts}>
                <FileStack className="mr-2 h-4 w-4" />
                {t("records.wizard.viewDrafts")}
              </Button>
              <Button variant="outline" onClick={handleAddAnother}>
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

"use client";

import React from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Save, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { FileDropzone } from "./file-dropzone";
import {
  useCreateMedicalRecord,
  useUpdateMedicalRecord,
  useUploadMultipleAttachments,
  useHardDeleteRecord,
} from "@/hooks";
import { RECORD_TYPES, type RecordType } from "@/types";

interface AddRecordFormProps {
  personId: string;
  personName: string;
}

export function AddRecordForm({ personId, personName }: AddRecordFormProps) {
  const t = useTranslations();
  const router = useRouter();

  // Form state - default date is today
  const [title, setTitle] = useState("");
  const [recordType, setRecordType] = useState<RecordType>("other");
  const [recordDate, setRecordDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // UI state
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null);

  // Mutations
  const createMutation = useCreateMedicalRecord();
  const updateMutation = useUpdateMedicalRecord();
  const uploadMutation = useUploadMultipleAttachments();
  const deleteMutation = useHardDeleteRecord();

  const isLoading =
    createMutation.isPending || updateMutation.isPending || uploadMutation.isPending;

  const hasChanges = title || notes || selectedFiles.length > 0;

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files]);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBack = () => {
    if (hasChanges) {
      setShowDiscardDialog(true);
    } else {
      router.back();
    }
  };

  const handleDiscard = async () => {
    // If we already created a draft record, delete it
    if (createdRecordId) {
      await deleteMutation.mutateAsync(createdRecordId);
    }
    router.back();
  };

  const handleSave = async (activateRecord: boolean) => {
    if (!title.trim()) {
      return;
    }

    try {
      // Step 1: Create the draft record
      const record = await createMutation.mutateAsync({
        person_id: personId,
        title: title.trim(),
        record_type: recordType,
        record_date: recordDate || null,
        notes: notes.trim() || null,
        status: "draft",
      });

      setCreatedRecordId(record.id);

      // Step 2: Upload attachments if any
      if (selectedFiles.length > 0) {
        await uploadMutation.mutateAsync({
          recordId: record.id,
          personId: personId,
          files: selectedFiles,
        });
      }

      // Step 3: If activating, update status to active
      if (activateRecord) {
        await updateMutation.mutateAsync({
          id: record.id,
          updates: { status: "active" },
        });
      }

      // Navigate to record detail or back to list
      if (activateRecord) {
        router.push("/health");
      } else {
        router.push(`/health/records/${record.id}`);
      }
    } catch (error) {
      console.error("Failed to save record:", error);
      // If record was created but upload failed, we keep it as draft
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("records.add.title")}</h1>
          <p className="text-muted-foreground">
            {t("records.add.subtitle")} — {personName}
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: File upload */}
        <div className="space-y-4">
          <FileDropzone
            onFilesSelected={handleFilesSelected}
            selectedFiles={selectedFiles}
            onRemoveFile={handleRemoveFile}
            isUploading={uploadMutation.isPending}
          />
        </div>

        {/* Right column: Form fields */}
        <div className="space-y-4">
          {/* Record Type */}
          <div className="space-y-2">
            <Label htmlFor="recordType">{t("records.add.recordType")}</Label>
            <Select
              value={recordType}
              onValueChange={(value) => setRecordType(value as RecordType)}
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
              value={recordDate}
              onChange={(e) => setRecordDate(e.target.value)}
            />
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">{t("records.add.recordTitle")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("records.add.recordTitlePlaceholder")}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t("records.add.notes")}</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("records.add.notesPlaceholder")}
              rows={4}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t pt-6">
        <Button variant="outline" onClick={handleBack} disabled={isLoading}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleSave(false)}
          disabled={!title.trim() || isLoading}
        >
          <Save className="mr-2 h-4 w-4" />
          {t("records.add.saveDraft")}
        </Button>
        <Button onClick={() => handleSave(true)} disabled={!title.trim() || isLoading}>
          <FileCheck className="mr-2 h-4 w-4" />
          {t("records.add.saveAndActivate")}
        </Button>
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

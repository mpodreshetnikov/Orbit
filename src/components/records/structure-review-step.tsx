"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Save,
  FileCheck,
  Loader2,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
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
import { useUpdateMedicalRecord } from "@/hooks";
import { RECORD_TYPES, type RecordType, type MedicalRecordWithAttachments } from "@/types";
import { cn } from "@/lib/utils";

interface StructureReviewStepProps {
  record: MedicalRecordWithAttachments;
  onComplete: () => void;
}

export function StructureReviewStep({ record, onComplete }: StructureReviewStepProps) {
  const t = useTranslations();
  const router = useRouter();
  
  // Form state
  const [title, setTitle] = useState(record.title);
  const [recordType, setRecordType] = useState<RecordType>(record.record_type);
  const [recordDate, setRecordDate] = useState(record.record_date || "");
  const [notes, setNotes] = useState(record.notes || "");
  const [keywords, setKeywords] = useState<string[]>(record.llm_keywords || []);
  const [newKeyword, setNewKeyword] = useState("");
  const [showOcrText, setShowOcrText] = useState(false);

  const updateMutation = useUpdateMedicalRecord();

  const isProcessing = updateMutation.isPending;

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords((prev) => [...prev, trimmed]);
      setNewKeyword("");
    }
  };

  const removeKeyword = (keywordToRemove: string) => {
    setKeywords((prev) => prev.filter((k) => k !== keywordToRemove));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  };

  const handleSave = async (activate: boolean) => {
    if (!title.trim()) return;

    await updateMutation.mutateAsync({
      id: record.id,
      updates: {
        title: title.trim(),
        record_type: recordType,
        record_date: recordDate || null,
        notes: notes.trim() || null,
        llm_keywords: keywords.length > 0 ? keywords : null,
        status: activate ? "active" : "draft",
      },
    });

    if (activate) {
      router.push("/health");
    } else {
      onComplete();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("records.structure.reviewTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("records.structure.reviewDescription")}
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: Main fields */}
        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">{t("records.add.recordTitle")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("records.add.recordTitlePlaceholder")}
              disabled={isProcessing}
            />
          </div>

          {/* Record Type */}
          <div className="space-y-2">
            <Label htmlFor="recordType">{t("records.add.recordType")}</Label>
            <Select
              value={recordType}
              onValueChange={(value) => setRecordType(value as RecordType)}
              disabled={isProcessing}
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
              disabled={isProcessing}
            />
          </div>

          {/* Summary/Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t("records.add.notes")}</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("records.add.notesPlaceholder")}
              rows={4}
              disabled={isProcessing}
            />
          </div>
        </div>

        {/* Right column: Keywords and OCR text */}
        <div className="space-y-4">
          {/* Keywords */}
          <div className="space-y-2">
            <Label>{t("records.detail.keywords")}</Label>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {keywords.map((keyword, index) => (
                  <Badge key={index} variant="secondary" className="gap-1 pr-1">
                    {keyword}
                    <button
                      type="button"
                      onClick={() => removeKeyword(keyword)}
                      className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {keywords.length === 0 && (
                  <span className="text-sm text-muted-foreground italic">
                    {t("records.structure.noKeywords")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={handleKeywordKeyDown}
                  placeholder={t("records.wizard.addKeyword")}
                  disabled={isProcessing}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addKeyword}
                  disabled={!newKeyword.trim() || isProcessing}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* OCR Text (collapsible reference) */}
          {record.ocr_text && (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3">
              <button
                type="button"
                onClick={() => setShowOcrText(!showOcrText)}
                className="flex w-full items-center justify-between text-left"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span>
                    {t("records.detail.ocrText")} ({record.ocr_text.length} {t("records.wizard.chars")})
                  </span>
                </div>
                {showOcrText ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {showOcrText && (
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">
                  {record.ocr_text}
                </pre>
              )}
            </div>
          )}

          {/* Attachment count */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>
                {t("records.detail.attachments")}: {record.attachments.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t pt-6">
        <Button
          variant="secondary"
          onClick={() => handleSave(false)}
          disabled={!title.trim() || isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {t("records.add.saveDraft")}
        </Button>
        <Button
          onClick={() => handleSave(true)}
          disabled={!title.trim() || isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileCheck className="mr-2 h-4 w-4" />
          )}
          {t("records.add.saveAndActivate")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  ArrowRight,
  Loader2,
  FileText,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAttachmentUrl, useStructureExtraction, useUpdateMedicalRecord } from "@/hooks";
import type { RecordAttachment } from "@/types";
import { cn } from "@/lib/utils";

interface OcrReviewStepProps {
  recordId: string;
  ocrText: string;
  attachments: RecordAttachment[];
  onComplete: () => void;
}

// Image carousel for viewing attachments
function ImageCarousel({ attachments }: { attachments: RecordAttachment[] }) {
  const t = useTranslations();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  
  const currentAttachment = attachments[currentIndex];
  const { data: url, isLoading } = useAttachmentUrl(currentAttachment?.storage_path || "");

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : attachments.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < attachments.length - 1 ? prev + 1 : 0));
  };

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.5, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.5, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  const handleLightboxClose = useCallback((open: boolean) => {
    setIsLightboxOpen(open);
    if (!open) {
      setZoom(1);
    }
  }, []);

  if (attachments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full rounded-lg border border-dashed bg-muted/30">
        <div className="text-center p-4">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            {t("records.detail.noAttachments")}
          </p>
        </div>
      </div>
    );
  }

  const isImage = currentAttachment?.mime_type?.startsWith("image/");

  return (
    <>
      <div className="relative h-full min-h-[400px] rounded-lg border bg-muted/30 overflow-hidden">
        {/* Image display */}
        <div
          className="relative h-full cursor-pointer"
          onClick={() => isImage && setIsLightboxOpen(true)}
        >
          {isLoading ? (
            <Skeleton className="absolute inset-0" />
          ) : isImage && url ? (
            <Image
              src={url}
              alt={currentAttachment.original_filename}
              fill
              className="object-contain p-2"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FileText className="mx-auto h-16 w-16 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">
                  {currentAttachment?.original_filename}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Navigation controls */}
        {attachments.length > 1 && (
          <>
            <Button
              variant="secondary"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}

        {/* Page indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded-full">
          <p className="text-xs text-white">
            {currentIndex + 1} / {attachments.length}
          </p>
        </div>

        {/* Filename */}
        <div className="absolute top-2 left-2 right-2 bg-black/60 px-3 py-1 rounded">
          <p className="text-xs text-white truncate">
            {currentAttachment?.original_filename}
          </p>
        </div>
      </div>

      {/* Lightbox for images with zoom */}
      {isImage && (
        <Dialog open={isLightboxOpen} onOpenChange={handleLightboxClose}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
            <DialogHeader className="absolute top-0 left-0 right-0 z-10 flex flex-row items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
              <DialogTitle className="text-white truncate max-w-[40%]">
                {currentAttachment?.original_filename}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleZoomOut} disabled={zoom <= 0.5}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-white text-sm min-w-[4rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button size="sm" variant="secondary" onClick={handleZoomIn} disabled={zoom >= 5}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="secondary" onClick={handleResetZoom}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>
            {url && (
              <div
                className="relative min-h-[50vh] h-[85vh] overflow-hidden bg-black/90 cursor-zoom-in"
                onClick={() => zoom === 1 && handleZoomIn()}
              >
                <div
                  className="absolute inset-0 flex items-center justify-center transition-transform duration-100"
                  style={{ transform: `scale(${zoom})` }}
                >
                  <Image
                    src={url}
                    alt={currentAttachment?.original_filename || ""}
                    fill
                    className="object-contain pointer-events-none"
                    sizes="100vw"
                    priority
                    draggable={false}
                  />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function OcrReviewStep({
  recordId,
  ocrText: initialOcrText,
  attachments,
  onComplete,
}: OcrReviewStepProps) {
  const t = useTranslations();
  const [editedOcrText, setEditedOcrText] = useState(initialOcrText);
  const [isSaving, setIsSaving] = useState(false);
  
  const { extractStructure, isExtracting } = useStructureExtraction();
  const updateMutation = useUpdateMedicalRecord();

  const hasChanges = editedOcrText !== initialOcrText;
  const isProcessing = isSaving || isExtracting || updateMutation.isPending;

  const handleConfirmAndExtract = async () => {
    setIsSaving(true);
    
    try {
      // If OCR text was edited, save it first
      if (hasChanges) {
        await updateMutation.mutateAsync({
          id: recordId,
          updates: { ocr_text: editedOcrText },
        });
      }

      // Then extract structure
      const result = await extractStructure({ recordId });
      
      if (result.success) {
        onComplete();
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("records.ocr.reviewTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("records.ocr.reviewDescription")}
          </p>
        </div>
        <Button
          onClick={handleConfirmAndExtract}
          disabled={isProcessing || !editedOcrText.trim()}
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 h-4 w-4" />
          )}
          {t("records.ocr.confirmAndExtract")}
        </Button>
      </div>

      {/* Side-by-side view */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Image carousel */}
        <div className="order-2 lg:order-1">
          <div className="mb-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("records.ocr.originalImages")} ({attachments.length})
            </h3>
          </div>
          <ImageCarousel attachments={attachments} />
        </div>

        {/* Right: OCR text editor */}
        <div className="order-1 lg:order-2 flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("records.ocr.extractedText")}
            </h3>
            <span className="text-xs text-muted-foreground">
              {editedOcrText.length} {t("records.wizard.chars")}
              {hasChanges && (
                <span className="ml-2 text-amber-600">
                  ({t("common.modified")})
                </span>
              )}
            </span>
          </div>
          <Textarea
            value={editedOcrText}
            onChange={(e) => setEditedOcrText(e.target.value)}
            placeholder={t("records.ocr.noTextExtracted")}
            className={cn(
              "flex-1 min-h-[400px] font-mono text-sm resize-none",
              hasChanges && "border-amber-500"
            )}
            disabled={isProcessing}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("records.ocr.editHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

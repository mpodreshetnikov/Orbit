"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Download from "yet-another-react-lightbox/plugins/download";
import "yet-another-react-lightbox/styles.css";
import { ArrowRight, Loader2, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAttachmentUrls, useStructureExtraction, useUpdateMedicalRecord } from "@/hooks";
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

  const { data: urlsById, isLoading } = useAttachmentUrls(attachments);
  const currentAttachment = attachments[currentIndex];
  const currentUrl = currentAttachment ? urlsById?.[currentAttachment.id] : undefined;

  const imageAttachments = attachments.filter((a) => a.mime_type?.startsWith("image/"));
  const slides =
    urlsById && imageAttachments.length > 0
      ? imageAttachments
          .map((a) => ({
            src: urlsById[a.id],
            alt: a.original_filename,
            download: urlsById[a.id],
          }))
          .filter((s) => s.src)
      : [];
  const lightboxIndex = currentAttachment
    ? imageAttachments.findIndex((a) => a.id === currentAttachment.id)
    : 0;
  const openIndex = lightboxIndex >= 0 ? lightboxIndex : 0;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : attachments.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < attachments.length - 1 ? prev + 1 : 0));
  };

  if (attachments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full rounded-lg border border-dashed bg-muted/30">
        <div className="text-center p-4">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">{t("records.detail.noAttachments")}</p>
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
          className="tap-target relative h-full cursor-pointer"
          onClick={() => isImage && slides.length > 0 && setIsLightboxOpen(true)}
        >
          {isLoading ? (
            <Skeleton className="absolute inset-0" />
          ) : isImage && currentUrl ? (
            <Image
              src={currentUrl}
              alt={currentAttachment.original_filename}
              fill
              className="object-contain p-2"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FileText className="mx-auto h-16 w-16 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">{currentAttachment?.original_filename}</p>
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
          <p className="text-xs text-white truncate">{currentAttachment?.original_filename}</p>
        </div>
      </div>

      {slides.length > 0 && (
        <Lightbox
          open={isLightboxOpen}
          close={() => setIsLightboxOpen(false)}
          slides={slides}
          index={openIndex}
          plugins={[Zoom, Download]}
        />
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
  const [isFullscreenTextOpen, setIsFullscreenTextOpen] = useState(false);

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
    <div className="space-y-4 md:pb-24">
      <p className="text-sm text-muted-foreground">{t("records.ocr.reviewDescription")}</p>

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
              {hasChanges && <span className="ml-2 text-amber-600">({t("common.modified")})</span>}
            </span>
          </div>

          {/* Mobile: check text + confirm buttons at top (no inline textarea) */}
          <div className="lg:hidden flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
              <Button
                variant="default"
                onClick={() => setIsFullscreenTextOpen(true)}
                className="flex-1"
              >
                <FileText className="mr-2 h-4 w-4" />
                {t("records.ocr.openText")}
              </Button>
              <Button
                onClick={handleConfirmAndExtract}
                disabled={isProcessing || !editedOcrText.trim()}
                className="flex-1"
              >
                {isProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                {t("records.ocr.confirmAndExtract")}
              </Button>
            </div>
          </div>

          {/* Desktop: inline textarea + optional fullscreen link */}
          <div className="hidden lg:flex flex-col flex-1">
            <Textarea
              value={editedOcrText}
              onChange={(e) => setEditedOcrText(e.target.value)}
              placeholder={t("records.ocr.noTextExtracted")}
              className={cn(
                "flex-1 min-h-[400px] font-mono text-sm resize-none",
                hasChanges && "border-amber-500",
              )}
              disabled={isProcessing}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("records.ocr.editHint")}</p>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => setIsFullscreenTextOpen(true)}
              >
                {t("records.ocr.openText")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen text view for comparison with paper (mobile) or optional on desktop */}
      <Dialog open={isFullscreenTextOpen} onOpenChange={setIsFullscreenTextOpen}>
        <DialogContent
          className="inset-0 left-0 top-0 translate-x-0 translate-y-0 max-w-none w-full h-full max-h-[100dvh] rounded-none p-0 flex flex-col gap-0 border-0"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{t("records.ocr.openText")}</DialogTitle>
          <div className="flex-1 min-h-0 flex flex-col pt-14 px-4 pb-4">
            <Textarea
              id="fullscreen-ocr-text"
              value={editedOcrText}
              onChange={(e) => setEditedOcrText(e.target.value)}
              placeholder={t("records.ocr.noTextExtracted")}
              className={cn(
                "flex-1 min-h-0 font-mono text-sm resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0",
                hasChanges && "border-amber-500",
              )}
              disabled={isProcessing}
            />
            <div className="mt-4 pt-4 border-t flex justify-end">
              <Button onClick={() => setIsFullscreenTextOpen(false)}>
                {t("records.ocr.saveAndClose")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sticky confirmation bar on desktop only; on mobile confirm is at top near Check text */}
      <div className="hidden md:block sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-background border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] lg:mx-0 lg:rounded-none">
        <Button
          onClick={handleConfirmAndExtract}
          disabled={isProcessing || !editedOcrText.trim()}
          className="w-full"
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 h-4 w-4" />
          )}
          {t("records.ocr.confirmAndExtract")}
        </Button>
      </div>
    </div>
  );
}

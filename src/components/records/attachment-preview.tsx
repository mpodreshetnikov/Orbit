"use client";

import React from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Download from "yet-another-react-lightbox/plugins/download";
import "yet-another-react-lightbox/styles.css";
import { FileText, Download as DownloadIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttachmentUrl } from "@/hooks";
import type { RecordAttachment } from "@/types";
import { cn } from "@/lib/utils";

interface AttachmentPreviewProps {
  attachment: RecordAttachment;
  showActions?: boolean;
}

export function AttachmentPreview({ attachment, showActions = true }: AttachmentPreviewProps) {
  const t = useTranslations();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const { data: url, isLoading } = useAttachmentUrl(attachment.storage_path);

  const isImage = attachment.mime_type.startsWith("image/");
  const isPdf = attachment.mime_type === "application/pdf";

  const handleDownload = () => {
    if (url) {
      window.open(url, "_blank");
    }
  };

  const slides =
    url && isImage ? [{ src: url, alt: attachment.original_filename, download: url }] : [];

  if (isLoading) {
    return <Skeleton className="aspect-[4/3] w-full rounded-lg" />;
  }

  return (
    <>
      <div
        className={cn(
          "tap-target group relative overflow-hidden rounded-lg border bg-muted/50",
          isImage && "cursor-pointer",
        )}
        onClick={() => isImage && setIsLightboxOpen(true)}
      >
        {isImage && url ? (
          <div className="relative aspect-[4/3]">
            <Image
              src={url}
              alt={attachment.original_filename}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center p-4">
            <FileText className="h-12 w-12 text-red-500" />
            <p className="mt-2 text-sm font-medium text-center truncate max-w-full px-2">
              {attachment.original_filename}
            </p>
            {isPdf && <p className="text-xs text-muted-foreground">PDF Document</p>}
          </div>
        )}

        {/* Overlay with actions */}
        {showActions && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {isPdf && url && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url, "_blank");
                }}
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                {t("common.view")}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
            >
              <DownloadIcon className="mr-1 h-4 w-4" />
              {t("common.download")}
            </Button>
          </div>
        )}

        {/* Filename badge */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
          <p className="text-xs text-white truncate">{attachment.original_filename}</p>
        </div>
      </div>

      {isImage && (
        <Lightbox
          open={isLightboxOpen}
          close={() => setIsLightboxOpen(false)}
          slides={slides}
          plugins={[Zoom, Download]}
        />
      )}
    </>
  );
}

interface AttachmentGridProps {
  attachments: RecordAttachment[];
  isLoading?: boolean;
}

export function AttachmentGrid({ attachments, isLoading }: AttachmentGridProps) {
  const t = useTranslations();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3]" />
        ))}
      </div>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">{t("records.detail.noAttachments")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {attachments.map((attachment) => (
        <AttachmentPreview key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

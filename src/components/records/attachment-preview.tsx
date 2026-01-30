"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { FileText, Download, ExternalLink, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAttachmentUrl } from "@/hooks";
import type { RecordAttachment } from "@/types";
import { cn } from "@/lib/utils";

function getTouchDistance(touches: React.TouchList): number {
  if (touches.length < 2) return 0;
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function getTouchCenter(touches: React.TouchList): { x: number; y: number } {
  if (touches.length < 2) return { x: 0, y: 0 };
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

interface AttachmentPreviewProps {
  attachment: RecordAttachment;
  showActions?: boolean;
}

export function AttachmentPreview({
  attachment,
  showActions = true,
}: AttachmentPreviewProps) {
  const t = useTranslations();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const pinchStart = useRef<{ distance: number; zoom: number; center: { x: number; y: number } } | null>(null);
  const touchPanStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const { data: url, isLoading } = useAttachmentUrl(attachment.storage_path);

  const isImage = attachment.mime_type.startsWith("image/");
  const isPdf = attachment.mime_type === "application/pdf";

  const handleDownload = () => {
    if (url) {
      window.open(url, "_blank");
    }
  };

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.5, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.5, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    }
  }, [zoom, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    }
  }, [isDragging, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.5), 5));
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStart.current = {
          distance: getTouchDistance(e.touches),
          zoom,
          center: getTouchCenter(e.touches),
        };
        touchPanStart.current = null;
      } else if (e.touches.length === 1 && zoom > 1) {
        touchPanStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          posX: position.x,
          posY: position.y,
        };
        pinchStart.current = null;
      }
    },
    [zoom, position]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchStart.current) {
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        if (pinchStart.current.distance > 0) {
          const scale = distance / pinchStart.current.distance;
          setZoom((prev) =>
            Math.min(Math.max(pinchStart.current!.zoom * scale, 0.5), 5)
          );
        }
        pinchStart.current = { ...pinchStart.current, distance };
      } else if (e.touches.length === 1 && touchPanStart.current && zoom > 1) {
        e.preventDefault();
        setPosition({
          x: touchPanStart.current.posX + e.touches[0].clientX - touchPanStart.current.x,
          y: touchPanStart.current.posY + e.touches[0].clientY - touchPanStart.current.y,
        });
      }
    },
    [zoom]
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchStart.current = null;
    if (e.touches.length < 1) touchPanStart.current = null;
  }, []);

  const handleLightboxClose = useCallback((open: boolean) => {
    setIsLightboxOpen(open);
    if (!open) {
      setZoom(1);
      setPosition({ x: 0, y: 0 });
    }
  }, []);

  if (isLoading) {
    return <Skeleton className="aspect-[4/3] w-full rounded-lg" />;
  }

  return (
    <>
      <div
        className={cn(
          "group relative overflow-hidden rounded-lg border bg-muted/50",
          isImage && "cursor-pointer"
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
            {isPdf && (
              <p className="text-xs text-muted-foreground">PDF Document</p>
            )}
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
              <Download className="mr-1 h-4 w-4" />
              {t("common.download")}
            </Button>
          </div>
        )}

        {/* Filename badge */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
          <p className="text-xs text-white truncate">
            {attachment.original_filename}
          </p>
        </div>
      </div>

      {/* Lightbox for images with zoom */}
      {isImage && (
        <Dialog open={isLightboxOpen} onOpenChange={handleLightboxClose}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
            <DialogHeader className="absolute top-0 left-0 right-0 z-10 flex flex-row items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
              <DialogTitle className="text-white truncate max-w-[40%]">
                {attachment.original_filename}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleZoomOut}
                  disabled={zoom <= 0.5}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-white text-sm min-w-[4rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleZoomIn}
                  disabled={zoom >= 5}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleResetZoom}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>
            {url && (
              <div
                className={cn(
                  "relative min-h-[50vh] h-[85vh] overflow-hidden bg-black/90 touch-none",
                  zoom > 1 ? "cursor-grab" : "cursor-zoom-in",
                  isDragging && "cursor-grabbing"
                )}
                style={{ touchAction: "none" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onWheel={handleWheel}
                onClick={() => zoom === 1 && handleZoomIn()}
              >
                <div
                  className="absolute inset-0 flex items-center justify-center transition-transform duration-100"
                  style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  }}
                >
                  <Image
                    src={url}
                    alt={attachment.original_filename}
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
        <p className="mt-2 text-sm text-muted-foreground">
          {t("records.detail.noAttachments")}
        </p>
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

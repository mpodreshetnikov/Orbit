"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload, X, FileText, Image as ImageIcon, Loader2, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "./camera-capture";

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  selectedFiles: File[];
  onRemoveFile: (index: number) => void;
  isUploading?: boolean;
  accept?: string;
  maxSizeMB?: number;
  maxFiles?: number;
  showCamera?: boolean;
}

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
];

export function FileDropzone({
  onFilesSelected,
  selectedFiles,
  onRemoveFile,
  isUploading = false,
  accept = "image/*,application/pdf",
  maxSizeMB = 20,
  maxFiles = 10,
  showCamera = true,
}: FileDropzoneProps) {
  const t = useTranslations();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const remainingSlots = maxFiles - selectedFiles.length;
  const canAddMore = remainingSlots > 0;

  const validateFiles = useCallback(
    (files: File[]): File[] => {
      const validFiles: File[] = [];
      const maxSize = maxSizeMB * 1024 * 1024;

      // Check how many files we can still add
      const slotsAvailable = maxFiles - selectedFiles.length;
      if (slotsAvailable <= 0) {
        setError(t("records.add.maxFilesReached", { max: maxFiles }));
        return [];
      }

      for (const file of files) {
        if (validFiles.length >= slotsAvailable) {
          setError(t("records.add.maxFilesReached", { max: maxFiles }));
          break;
        }
        if (!ACCEPTED_TYPES.includes(file.type)) {
          setError(`Invalid file type: ${file.name}`);
          continue;
        }
        if (file.size > maxSize) {
          setError(`File too large: ${file.name} (max ${maxSizeMB}MB)`);
          continue;
        }
        validFiles.push(file);
      }

      return validFiles;
    },
    [maxSizeMB, maxFiles, selectedFiles.length, t]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      setError(null);

      if (!canAddMore) {
        setError(t("records.add.maxFilesReached", { max: maxFiles }));
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
    },
    [onFilesSelected, validateFiles, canAddMore, maxFiles, t]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const files = e.target.files ? Array.from(e.target.files) : [];
      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
      // Reset input so same file can be selected again
      e.target.value = "";
    },
    [onFilesSelected, validateFiles]
  );

  const handleCameraCapture = useCallback(
    (file: File) => {
      setError(null);
      if (!canAddMore) {
        setError(t("records.add.maxFilesReached", { max: maxFiles }));
        return;
      }
      onFilesSelected([file]);
    },
    [onFilesSelected, canAddMore, maxFiles, t]
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) {
      return <ImageIcon className="h-8 w-8 text-blue-500" />;
    }
    return <FileText className="h-8 w-8 text-red-500" />;
  };

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50",
          (isUploading || !canAddMore) && "pointer-events-none opacity-50"
        )}
      >
        <input
          type="file"
          accept={accept}
          multiple
          onChange={handleFileInput}
          className="absolute inset-0 cursor-pointer opacity-0"
          disabled={isUploading || !canAddMore}
        />

        {isUploading ? (
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-10 w-10 text-muted-foreground" />
        )}

        <p className="mt-4 text-sm font-medium">
          {isUploading ? t("records.add.uploading") : t("records.add.dropzone")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("records.add.dropzoneHint")}
        </p>
        {maxFiles > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("records.add.remainingSlots", { count: remainingSlots, max: maxFiles })}
          </p>
        )}
      </div>

      {/* Camera button */}
      {showCamera && canAddMore && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => setCameraOpen(true)}
          disabled={isUploading}
        >
          <Camera className="mr-2 h-4 w-4" />
          {t("records.camera.takePhoto")}
        </Button>
      )}

      {/* Error message */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Selected files preview */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t("records.add.filesSelected", { count: selectedFiles.length })}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {selectedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3"
              >
                {getFileIcon(file.type)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onRemoveFile(index)}
                  disabled={isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Camera capture dialog */}
      <CameraCapture
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={handleCameraCapture}
      />
    </div>
  );
}

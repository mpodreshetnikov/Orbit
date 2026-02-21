"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Camera, X, RotateCcw, Check, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CameraCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
}

export function CameraCapture({ open, onOpenChange, onCapture }: CameraCaptureProps) {
  const t = useTranslations();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError(err instanceof Error ? err.message : t("records.camera.errorAccessing"));
      setIsStreaming(false);
    }
  }, [facingMode, t]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedImage(dataUrl);
      stopCamera();
    }
  }, [stopCamera]);

  const retakePhoto = useCallback(() => {
    setCapturedImage(null);
    startCamera();
  }, [startCamera]);

  const handleClose = useCallback(() => {
    stopCamera();
    setCapturedImage(null);
    setError(null);
    onOpenChange(false);
  }, [stopCamera, onOpenChange]);

  const confirmPhoto = useCallback(() => {
    if (!capturedImage || !canvasRef.current) return;

    // Convert data URL to File
    canvasRef.current.toBlob(
      (blob) => {
        if (blob) {
          const timestamp = Date.now();
          const file = new File([blob], `photo_${timestamp}.jpg`, {
            type: "image/jpeg",
          });
          onCapture(file);
          handleClose();
        }
      },
      "image/jpeg",
      0.9,
    );
  }, [capturedImage, onCapture, handleClose]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  // Start camera when dialog opens
  useEffect(() => {
    if (open && !capturedImage) {
      startCamera();
    }
    return () => {
      if (!open) {
        stopCamera();
      }
    };
  }, [open, startCamera, stopCamera, capturedImage]);

  // Restart camera when facing mode changes
  useEffect(() => {
    if (isStreaming) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>{t("records.camera.title")}</DialogTitle>
        </DialogHeader>

        <div className="relative bg-black aspect-[4/3]">
          {/* Video preview */}
          <video
            ref={videoRef}
            className={`w-full h-full object-cover ${capturedImage ? "hidden" : ""}`}
            autoPlay
            playsInline
            muted
          />

          {/* Captured image preview */}
          {capturedImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
          )}

          {/* Error state */}
          {error && !capturedImage && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center text-white p-4">
                <Camera className="mx-auto h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">{error}</p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={startCamera}>
                  {t("common.retry")}
                </Button>
              </div>
            </div>
          )}

          {/* Loading state */}
          {!isStreaming && !capturedImage && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <Camera className="h-12 w-12 text-white/50 animate-pulse" />
            </div>
          )}

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Controls */}
        <div className="p-4 flex items-center justify-center gap-4">
          {!capturedImage ? (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={handleClose}
                className="h-12 w-12 rounded-full"
              >
                <X className="h-6 w-6" />
              </Button>

              <Button
                size="icon"
                onClick={capturePhoto}
                disabled={!isStreaming}
                className="h-16 w-16 rounded-full bg-white hover:bg-gray-100 text-black"
              >
                <Camera className="h-8 w-8" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={switchCamera}
                disabled={!isStreaming}
                className="h-12 w-12 rounded-full"
              >
                <SwitchCamera className="h-6 w-6" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={retakePhoto}
                className="h-12 w-12 rounded-full"
              >
                <RotateCcw className="h-6 w-6" />
              </Button>

              <Button
                size="icon"
                onClick={confirmPhoto}
                className="h-16 w-16 rounded-full bg-green-500 hover:bg-green-600"
              >
                <Check className="h-8 w-8" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={handleClose}
                className="h-12 w-12 rounded-full"
              >
                <X className="h-6 w-6" />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

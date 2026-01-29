"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, XCircle, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  useProcessingQueueStore,
  type ProcessingJob,
} from "@/stores/processing-queue-store";
import { cn } from "@/lib/utils";

export function ProcessingIndicator() {
  const t = useTranslations();
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(true);

  const jobs = useProcessingQueueStore((state) => state.jobs);
  const removeJob = useProcessingQueueStore((state) => state.removeJob);

  const jobList = Object.values(jobs);
  const activeJobs = jobList.filter(
    (j) => j.stage === "uploading" || j.stage === "processing"
  );

  // Don't render if no jobs
  if (jobList.length === 0) {
    return null;
  }

  const handleViewRecord = (jobId: string, recordId: string) => {
    // Remove the job from the list when viewing
    removeJob(jobId);
    router.push(`/health/records/${recordId}`);
  };

  const handleDismissJob = (jobId: string) => {
    removeJob(jobId);
  };

  const getJobIcon = (job: ProcessingJob) => {
    switch (job.stage) {
      case "uploading":
      case "processing":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getJobStatus = (job: ProcessingJob) => {
    switch (job.stage) {
      case "uploading":
        return t("processing.uploading");
      case "processing":
        return t("processing.analyzing");
      case "completed":
        return t("processing.completed");
      case "failed":
        return t("processing.failed");
    }
  };

  // On mobile/PWA: do not show the permanent panel; users only see toasts when processing finishes
  return (
    <div className="fixed bottom-4 right-4 z-50 hidden w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-lg md:bottom-6 md:right-6 md:block">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          {activeJobs.length > 0 && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <span className="font-medium text-sm">
            {t("processing.title")}
          </span>
          {activeJobs.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {activeJobs.length}
            </Badge>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Jobs list */}
      {isExpanded && (
        <div className="max-h-64 overflow-auto border-t">
          {jobList.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {t("processing.noJobs")}
            </p>
          ) : (
            <div className="divide-y">
              {jobList.map((job) => (
                <div
                  key={job.id}
                  className={cn(
                    "p-3 space-y-2",
                    job.stage === "completed" && "bg-green-50/50 dark:bg-green-950/20",
                    job.stage === "failed" && "bg-red-50/50 dark:bg-red-950/20"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {getJobIcon(job)}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {job.title || t("processing.processing")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {job.personName} · {getJobStatus(job)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => handleDismissJob(job.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Progress bar for active jobs */}
                  {(job.stage === "uploading" || job.stage === "processing") && (
                    <Progress value={job.progress} className="h-1" />
                  )}

                  {/* Error message */}
                  {job.stage === "failed" && job.error && (
                    <p className="text-xs text-destructive truncate">
                      {job.error}
                    </p>
                  )}

                  {/* Action buttons for completed/failed */}
                  {(job.stage === "completed" || job.stage === "failed") && (
                    <div className="flex gap-2">
                      {job.stage === "completed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleViewRecord(job.id, job.recordId)}
                        >
                          {t("processing.viewRecord")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

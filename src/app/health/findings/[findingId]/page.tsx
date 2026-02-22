"use client";

import React from "react";
import { use, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import {
  ArrowLeft,
  Calendar,
  Ruler,
  FileText,
  AlertTriangle,
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSingleFindingHistory, useMarkFindingResolved } from "@/hooks";
import { useMedicalRecords } from "@/hooks/use-medical-records";
import { useUIStore } from "@/stores/ui-store";
import type { FindingSeverity, FindingHistoryPoint } from "@/types";

interface FindingDetailPageProps {
  params: Promise<{ findingId: string }>;
}

// Severity badge
function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const t = useTranslations();

  const config: Record<FindingSeverity, { color: string }> = {
    mild: { color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20" },
    moderate: {
      color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
    },
    severe: { color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20" },
    unknown: { color: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20" },
  };

  const { color } = config[severity] || config.unknown;

  return (
    <Badge variant="outline" className={color}>
      {t(`findings.severityOptions.${severity}`)}
    </Badge>
  );
}

// Size trend indicator
// History is sorted with newest first, so [0] is latest and [1] is previous
function SizeTrendIndicator({ history }: { history: FindingHistoryPoint[] }) {
  if (history.length < 2) return <Minus className="h-4 w-4 text-muted-foreground" />;

  const sizesWithData = history.filter((h) => h.size_mm !== null);
  if (sizesWithData.length < 2) return <Minus className="h-4 w-4 text-muted-foreground" />;

  // [0] is latest (newest), [1] is previous
  const latest = sizesWithData[0].size_mm!;
  const previous = sizesWithData[1].size_mm!;

  // For findings (polyps, cysts, etc.), smaller is better (green), larger is worse (red)
  if (latest > previous) {
    return <TrendingUp className="h-4 w-4 text-red-500" />;
  } else if (latest < previous) {
    return <TrendingDown className="h-4 w-4 text-green-500" />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function FindingDetailContent({ findingId }: { findingId: string }) {
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();
  const searchParams = useSearchParams();
  const siteCode = searchParams.get("site") || undefined;
  const { selectedPersonId } = useUIStore();
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");

  const { data: finding, isLoading } = useSingleFindingHistory(
    selectedPersonId,
    decodeURIComponent(findingId),
    siteCode ? decodeURIComponent(siteCode) : undefined,
  );

  // Fetch recent active records for the "attach to record" selector
  const { data: records } = useMedicalRecords({
    person_id: selectedPersonId || undefined,
    status: "active",
  });

  const markResolvedMutation = useMarkFindingResolved();

  const handleMarkResolved = async () => {
    if (!finding || !selectedPersonId || !selectedRecordId) return;

    await markResolvedMutation.mutateAsync({
      personId: selectedPersonId,
      recordId: selectedRecordId,
      finding,
    });

    setShowResolveDialog(false);
    setSelectedRecordId("");
  };

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 sm:space-y-6">
        <Skeleton className="h-8 w-48 sm:w-64" />
        <Skeleton className="h-32 sm:h-48" />
        <Skeleton className="h-48 sm:h-64" />
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="space-y-3 sm:space-y-6">
        <Link href="/health/findings">
          <Button variant="ghost" size="sm" className="h-8 sm:h-9 gap-1.5">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{t("common.back")}</span>
          </Button>
        </Link>
        <div className="flex items-center justify-center h-48 sm:h-64 text-muted-foreground text-sm sm:text-base">
          <p>{t("findings.notFound")}</p>
        </div>
      </div>
    );
  }

  const findingName = finding.catalog_finding_name_ru || finding.finding_type_text;
  const siteName = finding.catalog_site_name_ru || finding.body_site_text;
  const isSevere = finding.latest_severity === "severe" || finding.latest_severity === "moderate";
  const isResolved = finding.is_resolved;

  return (
    <div className="space-y-3 sm:space-y-6">
      {/* Back button */}
      <Link href="/health/findings">
        <Button variant="ghost" size="sm" className="h-8 sm:h-9 gap-1.5">
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">{t("common.back")}</span>
        </Button>
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h1 className="text-lg sm:text-2xl font-bold truncate">{findingName}</h1>
            {isResolved ? (
              <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-green-500 shrink-0" />
            ) : isSevere ? (
              <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500 shrink-0" />
            ) : null}
          </div>
          {finding.finding_code && (
            <code className="text-xs sm:text-sm text-muted-foreground block mt-0.5 truncate">
              {finding.finding_code}
            </code>
          )}
          {siteName && (
            <div className="flex items-center gap-1 mt-1.5 sm:mt-2 text-muted-foreground text-sm">
              <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span className="truncate">{siteName}</span>
              {finding.site_code && (
                <code className="text-xs ml-1 shrink-0">({finding.site_code})</code>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          {!isResolved && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 sm:h-9 text-xs sm:text-sm gap-1.5"
              onClick={() => setShowResolveDialog(true)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t("findings.markAsResolved")}
            </Button>
          )}
          {isResolved ? (
            <Badge
              variant="outline"
              className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-xs"
            >
              {t("findings.resolved")}
            </Badge>
          ) : (
            <SeverityBadge severity={finding.latest_severity} />
          )}
        </div>
      </div>

      {/* Mark as Resolved Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("findings.markAsResolved")}</DialogTitle>
            <DialogDescription>{t("findings.markAsResolvedDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("findings.attachToRecord")}</Label>
              <Select value={selectedRecordId} onValueChange={setSelectedRecordId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("findings.selectRecord")} />
                </SelectTrigger>
                <SelectContent>
                  {records?.map((record) => (
                    <SelectItem key={record.id} value={record.id}>
                      {record.title}{" "}
                      {record.record_date &&
                        `(${format(new Date(record.record_date), "dd.MM.yyyy", { locale: dateLocale })})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolveDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleMarkResolved}
              disabled={!selectedRecordId || markResolvedMutation.isPending}
            >
              {markResolvedMutation.isPending ? t("common.saving") : t("findings.markAsResolved")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4">
        {/* Latest Size */}
        <Card className="overflow-hidden">
          <CardHeader className="p-3 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              {t("findings.latestSize")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Ruler className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              {finding.latest_size_mm !== null ? (
                <>
                  <span className="text-lg sm:text-2xl font-bold">{finding.latest_size_mm}</span>
                  <span className="text-muted-foreground text-xs sm:text-sm">
                    {t("findings.mm")}
                  </span>
                  <SizeTrendIndicator history={finding.history} />
                </>
              ) : (
                <span className="text-muted-foreground text-sm">{t("findings.noSize")}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Occurrences */}
        <Card className="overflow-hidden">
          <CardHeader className="p-3 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              {t("findings.totalOccurrences")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-lg sm:text-2xl font-bold">{finding.occurrence_count}</span>
              <span className="text-muted-foreground text-xs sm:text-sm">
                {t("findings.records")}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Laterality */}
        <Card className="overflow-hidden md:col-span-1">
          <CardHeader className="p-3 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              {t("findings.laterality")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <span className="text-sm sm:text-xl font-semibold">
              {finding.latest_laterality !== "none"
                ? t(`findings.lateralityOptions.${finding.latest_laterality}`)
                : t("findings.lateralityOptions.none")}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* History Timeline */}
      <Card>
        <CardHeader className="p-3 sm:p-6">
          <CardTitle className="text-sm sm:text-base">{t("findings.history")}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          <div className="space-y-3 sm:space-y-4">
            {finding.history.map((point) => (
              <div
                key={point.id}
                className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 border-b pb-3 sm:pb-4 last:border-b-0 last:pb-0"
              >
                {/* Date */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 sm:w-32 text-xs sm:text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  {point.record_date
                    ? format(new Date(point.record_date), "dd.MM.yyyy", { locale: dateLocale })
                    : format(new Date(point.created_at), "dd.MM.yyyy", { locale: dateLocale })}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    {point.size_mm !== null && (
                      <div className="flex items-center gap-1">
                        <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm sm:text-base">{point.size_mm}</span>
                        <span className="text-xs text-muted-foreground">{t("findings.mm")}</span>
                      </div>
                    )}
                    {point.count !== null && point.count > 1 && (
                      <span className="text-xs sm:text-sm text-muted-foreground">
                        x{point.count}
                      </span>
                    )}
                    <SeverityBadge severity={point.severity} />
                    {point.laterality !== "none" && (
                      <Badge variant="secondary" className="text-xs">
                        {t(`findings.lateralityOptions.${point.laterality}`)}
                      </Badge>
                    )}
                  </div>

                  {/* Description or morphology */}
                  {(point.description || point.morphology) && (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 sm:line-clamp-none">
                      {point.description || point.morphology}
                    </p>
                  )}

                  {/* Source anchor */}
                  {point.source_anchor && (
                    <blockquote className="text-xs text-muted-foreground italic border-l-2 pl-2 mt-1.5 sm:mt-2 line-clamp-2">
                      &ldquo;{point.source_anchor}&rdquo;
                    </blockquote>
                  )}

                  {/* Link to record */}
                  <Link href={`/health/records/${point.record_id}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 sm:h-7 mt-1.5 sm:mt-2 text-xs gap-1"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      {t("findings.viewRecord")}
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FindingDetailPage({ params }: FindingDetailPageProps) {
  const resolvedParams = use(params);

  return <FindingDetailContent findingId={resolvedParams.findingId} />;
}

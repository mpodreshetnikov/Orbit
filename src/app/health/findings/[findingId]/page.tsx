"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Calendar, Ruler, FileText, AlertTriangle, MapPin, TrendingUp, TrendingDown, Minus, CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSingleFindingHistory, useMarkFindingResolved } from "@/hooks";
import { useMedicalRecords } from "@/hooks/use-medical-records";
import { useUIStore } from "@/stores/ui-store";
import type { FindingSeverity, FindingLaterality, FindingHistoryPoint } from "@/types";

interface FindingDetailPageProps {
  params: Promise<{ findingId: string }>;
}

// Severity badge
function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const t = useTranslations();
  
  const config: Record<FindingSeverity, { color: string }> = {
    mild: { color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20" },
    moderate: { color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20" },
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
  
  const sizesWithData = history.filter(h => h.size_mm !== null);
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
  const searchParams = useSearchParams();
  const siteCode = searchParams.get("site") || undefined;
  const { selectedPersonId } = useUIStore();
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");

  const { data: finding, isLoading } = useSingleFindingHistory(
    selectedPersonId, 
    decodeURIComponent(findingId),
    siteCode ? decodeURIComponent(siteCode) : undefined
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
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="space-y-6">
        <Link href="/health/findings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("common.back")}
          </Button>
        </Link>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
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
    <div className="space-y-6">
      {/* Back button */}
      <Link href="/health/findings">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{findingName}</h1>
            {isResolved ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : isSevere ? (
              <AlertTriangle className="h-5 w-5 text-orange-500" />
            ) : null}
          </div>
          {finding.finding_code && (
            <code className="text-sm text-muted-foreground">{finding.finding_code}</code>
          )}
          {siteName && (
            <div className="flex items-center gap-1 mt-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{siteName}</span>
              {finding.site_code && (
                <code className="text-xs ml-1">({finding.site_code})</code>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isResolved && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowResolveDialog(true)}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {t("findings.markAsResolved")}
            </Button>
          )}
          {isResolved ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
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
            <DialogDescription>
              {t("findings.markAsResolvedDescription")}
            </DialogDescription>
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
                      {record.title} {record.record_date && `(${format(new Date(record.record_date), "dd.MM.yyyy")})`}
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
      <div className="grid gap-4 md:grid-cols-3">
        {/* Latest Size */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("findings.latestSize")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-muted-foreground" />
              {finding.latest_size_mm !== null ? (
                <>
                  <span className="text-2xl font-bold">{finding.latest_size_mm}</span>
                  <span className="text-muted-foreground">{t("findings.mm")}</span>
                  <SizeTrendIndicator history={finding.history} />
                </>
              ) : (
                <span className="text-muted-foreground">{t("findings.noSize")}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Occurrences */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("findings.totalOccurrences")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{finding.occurrence_count}</span>
              <span className="text-muted-foreground">{t("findings.records")}</span>
            </div>
          </CardContent>
        </Card>

        {/* Laterality */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("findings.laterality")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-xl font-semibold">
              {finding.latest_laterality !== "none" 
                ? t(`findings.lateralityOptions.${finding.latest_laterality}`)
                : t("findings.lateralityOptions.none")
              }
            </span>
          </CardContent>
        </Card>
      </div>

      {/* History Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>{t("findings.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {finding.history.map((point) => (
              <div key={point.id} className="flex items-start gap-4 border-b pb-4 last:border-b-0 last:pb-0">
                {/* Date */}
                <div className="flex items-center gap-2 shrink-0 w-32 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {point.record_date 
                    ? format(new Date(point.record_date), "dd.MM.yyyy")
                    : format(new Date(point.created_at), "dd.MM.yyyy")
                  }
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    {point.size_mm !== null && (
                      <div className="flex items-center gap-1">
                        <Ruler className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{point.size_mm}</span>
                        <span className="text-xs text-muted-foreground">{t("findings.mm")}</span>
                      </div>
                    )}
                    {point.count !== null && point.count > 1 && (
                      <span className="text-sm text-muted-foreground">x{point.count}</span>
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
                    <p className="text-sm text-muted-foreground">
                      {point.description || point.morphology}
                    </p>
                  )}

                  {/* Source anchor */}
                  {point.source_anchor && (
                    <blockquote className="text-xs text-muted-foreground italic border-l-2 pl-2 mt-2">
                      &ldquo;{point.source_anchor}&rdquo;
                    </blockquote>
                  )}

                  {/* Link to record */}
                  <Link href={`/health/records/${point.record_id}`}>
                    <Button variant="outline" size="sm" className="h-7 mt-2">
                      <FileText className="h-3 w-3 mr-1" />
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
  
  return (
    <AppShell>
      <FindingDetailContent findingId={resolvedParams.findingId} />
    </AppShell>
  );
}

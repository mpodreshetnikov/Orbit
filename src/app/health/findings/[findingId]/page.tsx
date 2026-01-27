"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Calendar, Ruler, FileText, AlertTriangle, MapPin, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { AppShell } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSingleFindingHistory } from "@/hooks";
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
function SizeTrendIndicator({ history }: { history: FindingHistoryPoint[] }) {
  if (history.length < 2) return <Minus className="h-4 w-4 text-muted-foreground" />;
  
  const sizesWithData = history.filter(h => h.size_mm !== null);
  if (sizesWithData.length < 2) return <Minus className="h-4 w-4 text-muted-foreground" />;

  const latest = sizesWithData[sizesWithData.length - 1].size_mm!;
  const previous = sizesWithData[sizesWithData.length - 2].size_mm!;
  
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

  const { data: finding, isLoading } = useSingleFindingHistory(
    selectedPersonId, 
    decodeURIComponent(findingId),
    siteCode ? decodeURIComponent(siteCode) : undefined
  );

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("common.selectPerson")}</p>
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
            {isSevere && <AlertTriangle className="h-5 w-5 text-orange-500" />}
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
        <SeverityBadge severity={finding.latest_severity} />
      </div>

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
                  <Link 
                    href={`/health/records/${point.record_id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("findings.viewRecord")}
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

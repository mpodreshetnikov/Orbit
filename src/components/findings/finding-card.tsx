"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import { AlertTriangle, MapPin, Ruler, Calendar, FileText, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FindingSummary, FindingSeverity, FindingLaterality } from "@/types";

interface FindingCardProps {
  finding: FindingSummary;
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
    <Badge variant="outline" className={cn("text-xs", color)}>
      {t(`findings.severityOptions.${severity}`)}
    </Badge>
  );
}

// Laterality text
function getLateralityText(laterality: FindingLaterality, t: ReturnType<typeof useTranslations>) {
  if (laterality === "none") return null;
  return t(`findings.lateralityOptions.${laterality}`);
}

export function FindingCard({ finding }: FindingCardProps) {
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();

  const findingName = finding.catalog_finding_name_ru || finding.finding_type_text;
  const siteName = finding.catalog_site_name_ru || finding.body_site_text;
  const lateralityText = getLateralityText(finding.latest_laterality, t);

  const isSevere = finding.latest_severity === "severe" || finding.latest_severity === "moderate";
  const isResolved = finding.is_resolved;

  // Build link - use finding_code if available, otherwise finding_type_text
  const findingKey = finding.finding_code || encodeURIComponent(finding.finding_type_text);
  const siteKey =
    finding.site_code || (finding.body_site_text ? encodeURIComponent(finding.body_site_text) : "");
  const href = `/health/findings/${findingKey}${siteKey ? `?site=${siteKey}` : ""}`;

  return (
    <Link href={href} className="tap-target min-w-0 w-full block overflow-hidden select-none">
      <Card
        className={cn(
          "hover:shadow-md transition-shadow cursor-pointer h-full min-w-0 w-full overflow-hidden",
          isSevere && !isResolved && "border-orange-300 dark:border-orange-700",
          isResolved && "border-green-300 dark:border-green-700",
        )}
      >
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium truncate">{findingName}</h3>
                {isResolved ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                ) : isSevere ? (
                  <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                ) : null}
              </div>
              {finding.finding_code && (
                <code className="text-xs text-muted-foreground">{finding.finding_code}</code>
              )}
            </div>
            {isResolved ? (
              <Badge
                variant="outline"
                className="text-xs bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
              >
                {t("findings.resolved")}
              </Badge>
            ) : (
              <SeverityBadge severity={finding.latest_severity} />
            )}
          </div>

          {/* Body site */}
          {siteName && (
            <div className="flex items-center gap-1 mt-2 text-sm text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {lateralityText && `${lateralityText} `}
                {siteName}
              </span>
            </div>
          )}

          {/* Details */}
          <div className="mt-3 flex items-end justify-between">
            <div className="space-y-1">
              {/* Size */}
              {finding.latest_size_mm !== null && (
                <div className="flex items-center gap-1 text-sm">
                  <Ruler className="h-3 w-3 text-muted-foreground" />
                  <span className="font-semibold">{finding.latest_size_mm}</span>
                  <span className="text-muted-foreground">{t("findings.mm")}</span>
                </div>
              )}

              {/* Count */}
              {finding.latest_count !== null && finding.latest_count > 1 && (
                <div className="text-sm text-muted-foreground">
                  {t("findings.countValue", { count: finding.latest_count })}
                </div>
              )}

              {/* Date */}
              {finding.latest_date && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(finding.latest_date), "dd.MM.yyyy", { locale: dateLocale })}
                </div>
              )}
            </div>

            {/* Occurrence count */}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              {finding.occurrence_count} {t("findings.occurrences")}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

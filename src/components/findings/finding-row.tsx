"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Pencil,
  Trash2,
  AlertTriangle,
  MapPin,
  Ruler,
  TrendingUp,
  TrendingDown,
  Minus,
  CircleDot,
  History,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecordFindingWithCatalog, FindingSeverity, FindingLaterality } from "@/types";

// Comparison data to show change from previous occurrence
export interface FindingComparison {
  isNew: boolean; // true if this finding type+site has never been seen before
  previousOccurrences: number; // how many times this finding was seen before
  previousSize: number | null; // size from the most recent previous occurrence
  previousCount: number | null; // count from the most recent previous occurrence
  previousDate: string | null; // date of the most recent previous occurrence
}

interface FindingRowProps {
  finding: RecordFindingWithCatalog;
  comparison?: FindingComparison | null; // optional comparison data
  onEdit?: () => void;
  onDelete?: () => void;
  isProcessing?: boolean;
  showActions?: boolean;
}

// Severity badge component
function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const t = useTranslations();

  const config: Record<FindingSeverity, { color: string; label: string }> = {
    mild: {
      color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
      label: t("findings.severityOptions.mild"),
    },
    moderate: {
      color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
      label: t("findings.severityOptions.moderate"),
    },
    severe: {
      color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
      label: t("findings.severityOptions.severe"),
    },
    unknown: {
      color: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
      label: t("findings.severityOptions.unknown"),
    },
  };

  const { color, label } = config[severity] || config.unknown;

  return (
    <Badge variant="outline" className={cn("text-xs", color)}>
      {label}
    </Badge>
  );
}

// Laterality badge component
function LateralityBadge({ laterality }: { laterality: FindingLaterality }) {
  const t = useTranslations();

  if (laterality === "none") return null;

  const labels: Record<FindingLaterality, string> = {
    left: t("findings.lateralityOptions.left"),
    right: t("findings.lateralityOptions.right"),
    bilateral: t("findings.lateralityOptions.bilateral"),
    none: "",
  };

  return (
    <Badge variant="secondary" className="text-xs">
      {labels[laterality]}
    </Badge>
  );
}

// Size change indicator component
function SizeChangeIndicator({
  currentSize,
  previousSize,
}: {
  currentSize: number | null;
  previousSize: number | null;
}) {
  const t = useTranslations();

  if (currentSize === null || previousSize === null) return null;

  // Round to 1 decimal place to avoid floating point precision issues (e.g., 3.8 - 3.7 = 0.09999...)
  const change = Math.round((currentSize - previousSize) * 10) / 10;

  if (change === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        <span>{t("findings.comparison.unchanged")}</span>
      </span>
    );
  }

  const isIncrease = change > 0;
  const changeText = isIncrease ? `+${change}` : `${change}`;

  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-xs font-medium",
        isIncrease ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400",
      )}
    >
      {isIncrease ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      <span>{t("findings.comparison.sizeChange", { change: changeText })}</span>
    </span>
  );
}

// New/Known badge component
function ComparisonBadge({ comparison }: { comparison: FindingComparison }) {
  const t = useTranslations();

  if (comparison.isNew) {
    return (
      <Badge
        variant="outline"
        className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1"
      >
        <CircleDot className="h-3 w-3" />
        {t("findings.comparison.new")}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="text-xs bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20 gap-1"
      title={`${comparison.previousOccurrences} ${t("findings.occurrences")}`}
    >
      <History className="h-3 w-3" />
      {t("findings.comparison.known")} ({comparison.previousOccurrences})
    </Badge>
  );
}

export function FindingRow({
  finding,
  comparison,
  onEdit,
  onDelete,
  isProcessing = false,
  showActions = true,
}: FindingRowProps) {
  const t = useTranslations();

  // History page: /health/findings/[findingId]?site=...
  const viewHref =
    `/health/findings/${encodeURIComponent(finding.finding_code ?? finding.finding_type_text)}` +
    (finding.site_code ? `?site=${encodeURIComponent(finding.site_code)}` : "");

  // Get display names
  const findingName = finding.catalog_finding_name_ru || finding.finding_type_text;
  const siteName = finding.catalog_site_name_ru || finding.body_site_text;

  const isSevere = finding.severity === "severe" || finding.severity === "moderate";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        isSevere && "border-orange-500/30 bg-orange-500/5",
        comparison?.isNew && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="min-w-0 flex-1">
        {/* Finding type and code */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{findingName}</span>
          {finding.finding_code && (
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{finding.finding_code}</code>
          )}
          {isSevere && <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />}
        </div>

        {/* Body site */}
        {siteName && (
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span>{siteName}</span>
            {finding.site_code && (
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{finding.site_code}</code>
            )}
          </div>
        )}

        {/* Size and count with comparison */}
        <div className="flex items-center gap-3 mt-1 text-sm flex-wrap">
          {finding.size_mm !== null && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Ruler className="h-3 w-3" />
                <span>
                  {finding.size_mm} {t("findings.mm")}
                </span>
              </div>
              {/* Show previous size and change if available */}
              {comparison && !comparison.isNew && comparison.previousSize !== null && (
                <>
                  <span className="text-muted-foreground/50">←</span>
                  <span className="text-xs text-muted-foreground">
                    {t("findings.comparison.previousSize", { size: comparison.previousSize })}
                  </span>
                  <SizeChangeIndicator
                    currentSize={finding.size_mm}
                    previousSize={comparison.previousSize}
                  />
                </>
              )}
            </div>
          )}
          {finding.count !== null && finding.count > 1 && (
            <span className="text-muted-foreground">x{finding.count}</span>
          )}
        </div>
      </div>

      {/* Badges and actions - wrap on mobile */}
      <div className="flex flex-wrap items-center gap-2 shrink-0 sm:flex-nowrap">
        {/* Show new/known badge if comparison data is available */}
        {comparison && <ComparisonBadge comparison={comparison} />}

        <SeverityBadge severity={finding.severity} />
        <LateralityBadge laterality={finding.laterality} />

        {/* Confidence indicator */}
        {finding.confidence !== null && finding.confidence < 0.8 && (
          <span title={t("findings.lowConfidence")}>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </span>
        )}

        {showActions && (
          <div className="flex items-center gap-0.5 ms-auto sm:ms-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
              title={t("findings.openHistory")}
            >
              <Link href={viewHref}>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onEdit}
                disabled={isProcessing}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={onDelete}
                disabled={isProcessing}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

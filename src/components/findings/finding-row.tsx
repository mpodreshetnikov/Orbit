"use client";

import { useTranslations } from "next-intl";
import { Pencil, Trash2, AlertTriangle, MapPin, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecordFindingWithCatalog, FindingSeverity, FindingLaterality } from "@/types";

interface FindingRowProps {
  finding: RecordFindingWithCatalog;
  onEdit?: () => void;
  onDelete?: () => void;
  isProcessing?: boolean;
  showActions?: boolean;
}

// Severity badge component
function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const t = useTranslations();
  
  const config: Record<FindingSeverity, { color: string; label: string }> = {
    mild: { color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20", label: t("findings.severityOptions.mild") },
    moderate: { color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20", label: t("findings.severityOptions.moderate") },
    severe: { color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20", label: t("findings.severityOptions.severe") },
    unknown: { color: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20", label: t("findings.severityOptions.unknown") },
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

export function FindingRow({ 
  finding, 
  onEdit, 
  onDelete, 
  isProcessing = false,
  showActions = true,
}: FindingRowProps) {
  const t = useTranslations();
  
  // Get display names
  const findingName = finding.catalog_finding_name_ru || finding.finding_type_text;
  const siteName = finding.catalog_site_name_ru || finding.body_site_text;

  const isSevere = finding.severity === "severe" || finding.severity === "moderate";

  return (
    <div className={cn(
      "flex items-center justify-between gap-4 rounded-lg border p-3",
      isSevere && "border-orange-500/30 bg-orange-500/5"
    )}>
      <div className="min-w-0 flex-1">
        {/* Finding type and code */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{findingName}</span>
          {finding.finding_code && (
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {finding.finding_code}
            </code>
          )}
          {isSevere && <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />}
        </div>
        
        {/* Body site */}
        {siteName && (
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span>{siteName}</span>
            {finding.site_code && (
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {finding.site_code}
              </code>
            )}
          </div>
        )}

        {/* Size and count */}
        <div className="flex items-center gap-3 mt-1 text-sm">
          {finding.size_mm !== null && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Ruler className="h-3 w-3" />
              <span>{finding.size_mm} {t("findings.mm")}</span>
            </div>
          )}
          {finding.count !== null && finding.count > 1 && (
            <span className="text-muted-foreground">
              x{finding.count}
            </span>
          )}
        </div>
      </div>

      {/* Badges and actions */}
      <div className="flex items-center gap-2 shrink-0">
        <SeverityBadge severity={finding.severity} />
        <LateralityBadge laterality={finding.laterality} />
        
        {/* Confidence indicator */}
        {finding.confidence !== null && finding.confidence < 0.8 && (
          <span title={t("findings.lowConfidence")}>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </span>
        )}

        {showActions && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

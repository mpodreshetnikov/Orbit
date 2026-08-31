"use client";

import React from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Pencil,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Quote,
  ArrowRight,
  CircleDot,
  History,
  CirclePlus,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ConditionStatusBadge } from "./condition-status-badge";
import { getConditionIcdName } from "@/hooks";
import type { ConditionRecordWithDetails } from "@/types";

/** Comparison data: is this condition new or an existing one (update)? */
export interface ConditionComparison {
  isNew: boolean;
  previousOccurrences: number;
}

interface ConditionRecordRowProps {
  conditionRecord: ConditionRecordWithDetails;
  comparison?: ConditionComparison | null;
  onEdit?: () => void;
  onAddHistory?: () => void;
  onDelete?: () => void;
  isProcessing?: boolean;
  showActions?: boolean;
}

function ConditionComparisonBadge({ comparison }: { comparison: ConditionComparison }) {
  const t = useTranslations();
  if (comparison.isNew) {
    return (
      <Badge
        variant="outline"
        className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1"
      >
        <CircleDot className="h-3 w-3" />
        {t("conditions.comparison.new")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20 gap-1"
      title={t("conditions.comparison.knownTitle", { count: comparison.previousOccurrences })}
    >
      <History className="h-3 w-3" />
      {t("conditions.comparison.known", { count: comparison.previousOccurrences })}
    </Badge>
  );
}

export function ConditionRecordRow({
  conditionRecord,
  comparison,
  onEdit,
  onAddHistory,
  onDelete,
  isProcessing = false,
  showActions = true,
}: ConditionRecordRowProps) {
  const t = useTranslations();
  const [showAnchor, setShowAnchor] = useState(false);

  const hasStatusChange =
    conditionRecord.status_in_record !== conditionRecord.condition_current_status;
  const isActiveOrSuspected =
    conditionRecord.status_in_record === "active" ||
    conditionRecord.status_in_record === "suspected";

  // ICD name (English only for ICD-10), if present
  const icdName = getConditionIcdName(conditionRecord.condition_icd_name_en);
  // Display: ICD name or original name
  const displayName = icdName || conditionRecord.condition_name;

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        isActiveOrSuspected && "border-orange-500/30 bg-orange-500/5",
        comparison?.isNew && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          {/* Condition name with ICD code */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{displayName}</span>
            {conditionRecord.condition_code ? (
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {conditionRecord.condition_code}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground/60 italic">
                ({t("conditions.noIcdCode")})
              </span>
            )}
          </div>

          {/* Show original name if different from ICD name */}
          {icdName && icdName !== conditionRecord.condition_name && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {conditionRecord.condition_name}
            </div>
          )}

          {/* Status change indicator */}
          {hasStatusChange && (
            <div className="flex items-center gap-2 mt-1 text-sm flex-wrap">
              <ConditionStatusBadge status={conditionRecord.condition_current_status} />
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <ConditionStatusBadge status={conditionRecord.status_in_record} />
              <span className="text-xs text-muted-foreground">
                ({t("conditions.statusChange")})
              </span>
            </div>
          )}

          {/* Source anchor toggle */}
          {conditionRecord.source_anchor && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAnchor(!showAnchor)}
              className="tap-target h-auto p-0 mt-1 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-transparent"
            >
              <Quote className="h-3 w-3 shrink-0" />
              <span>{t("conditions.showSource")}</span>
              {showAnchor ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
        </div>

        {/* Badges and actions - wrap on mobile, row on desktop */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 sm:flex-nowrap">
          {conditionRecord.is_proposal && (
            <Badge
              variant="outline"
              className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 gap-1"
              title={t("conditions.proposalTitle")}
            >
              <CircleDot className="h-3 w-3" />
              {t("conditions.proposal")}
            </Badge>
          )}
          {comparison && <ConditionComparisonBadge comparison={comparison} />}
          {!hasStatusChange && <ConditionStatusBadge status={conditionRecord.status_in_record} />}

          {/* Confidence indicator */}
          {conditionRecord.confidence !== null && conditionRecord.confidence < 0.8 && (
            <span title={t("conditions.lowConfidence")}>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </span>
          )}

          {showActions && (
            <div className="flex items-center gap-0.5 ms-auto sm:ms-0">
              {/* A proposal has no condition page to open yet: it is created on activation. */}
              {conditionRecord.condition_id && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  asChild
                  title={t("conditions.openDetails")}
                >
                  <Link href={`/health/conditions/${conditionRecord.condition_id}`}>
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onEdit}
                  disabled={isProcessing}
                  title={t("conditions.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {onAddHistory && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onAddHistory}
                  disabled={isProcessing}
                  title={t("conditions.changeStatus")}
                >
                  <CirclePlus className="h-4 w-4" />
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

      {/* Source anchor quote (collapsible) */}
      {showAnchor && conditionRecord.source_anchor && (
        <div className="mt-2 p-2 rounded bg-muted/50 border-l-2 border-muted-foreground/30">
          <p className="text-xs italic text-muted-foreground">
            &ldquo;{conditionRecord.source_anchor}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}

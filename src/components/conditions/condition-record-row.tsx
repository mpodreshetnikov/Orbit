"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, AlertTriangle, ChevronDown, ChevronUp, Quote, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ConditionStatusBadge } from "./condition-status-badge";
import { getConditionIcdName } from "@/hooks";
import type { ConditionRecordWithDetails } from "@/types";

interface ConditionRecordRowProps {
  conditionRecord: ConditionRecordWithDetails;
  onEdit?: () => void;
  onDelete?: () => void;
  isProcessing?: boolean;
  showActions?: boolean;
}

export function ConditionRecordRow({
  conditionRecord,
  onEdit,
  onDelete,
  isProcessing = false,
  showActions = true,
}: ConditionRecordRowProps) {
  const t = useTranslations();
  const [showAnchor, setShowAnchor] = useState(false);

  const hasStatusChange = conditionRecord.status_in_record !== conditionRecord.condition_current_status;
  const isActiveOrSuspected = conditionRecord.status_in_record === "active" || conditionRecord.status_in_record === "suspected";

  // ICD name (English only for ICD-10), if present
  const icdName = getConditionIcdName(conditionRecord.condition_icd_name_en);
  // Display: ICD name or original name
  const displayName = icdName || conditionRecord.condition_name;

  return (
    <div className={cn(
      "rounded-lg border p-3",
      isActiveOrSuspected && "border-orange-500/30 bg-orange-500/5"
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Condition name with ICD code */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{displayName}</span>
            {conditionRecord.condition_code ? (
              <Badge variant="outline" className="font-mono text-xs">
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
            <div className="flex items-center gap-2 mt-1 text-sm">
              <ConditionStatusBadge status={conditionRecord.condition_current_status} />
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <ConditionStatusBadge status={conditionRecord.status_in_record} />
              <span className="text-xs text-muted-foreground">
                ({t("conditions.statusChange")})
              </span>
            </div>
          )}

          {/* Source anchor toggle */}
          {conditionRecord.source_anchor && (
            <button
              type="button"
              onClick={() => setShowAnchor(!showAnchor)}
              className="flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Quote className="h-3 w-3" />
              <span>{t("conditions.showSource")}</span>
              {showAnchor ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}
        </div>

        {/* Badges and actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!hasStatusChange && (
            <ConditionStatusBadge status={conditionRecord.status_in_record} />
          )}

          {/* Confidence indicator */}
          {conditionRecord.confidence !== null && conditionRecord.confidence < 0.8 && (
            <span title={t("conditions.lowConfidence")}>
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

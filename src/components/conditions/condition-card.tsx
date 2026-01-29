"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import Link from "next/link";
import { 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle, 
  History, 
  Calendar, 
  FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConditionWithHistory, ConditionStatus } from "@/types";

interface ConditionCardProps {
  condition: ConditionWithHistory;
  onClick?: () => void;
}

// Status icon
function StatusIcon({ status }: { status: ConditionStatus }) {
  const icons: Record<ConditionStatus, React.ReactNode> = {
    active: <AlertCircle className="h-4 w-4 text-orange-500" />,
    suspected: <HelpCircle className="h-4 w-4 text-yellow-500" />,
    resolved: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    history: <History className="h-4 w-4 text-gray-500" />,
  };
  return icons[status] || null;
}

// Status badge
function StatusBadge({ status }: { status: ConditionStatus }) {
  const t = useTranslations();
  
  const config: Record<ConditionStatus, { color: string }> = {
    active: { color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20" },
    suspected: { color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20" },
    resolved: { color: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" },
    history: { color: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20" },
  };

  const { color } = config[status] || config.history;

  return (
    <Badge variant="outline" className={cn("text-xs", color)}>
      {t(`conditions.status.${status}`)}
    </Badge>
  );
}

export function ConditionCard({ condition, onClick }: ConditionCardProps) {
  const t = useTranslations();

  const isActive = condition.current_status === "active";
  const isSuspected = condition.current_status === "suspected";
  const isResolved = condition.current_status === "resolved";
  const isHistory = condition.current_status === "history";

  const cardContent = (
    <Card 
      className={cn(
        "hover:shadow-md transition-shadow h-full min-w-0 w-full overflow-hidden",
        (onClick || true) && "cursor-pointer",
        isActive && "border-orange-300 dark:border-orange-700",
        isSuspected && "border-yellow-300 dark:border-yellow-700",
        isResolved && "border-green-300 dark:border-green-700",
        isHistory && "opacity-70"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header: Name as title */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <StatusIcon status={condition.current_status} />
              <h3 className="font-medium truncate">{condition.name}</h3>
            </div>
            {/* ICD info line */}
            {condition.code ? (
              <div className="text-xs text-muted-foreground mt-1">
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="font-mono text-[10px] px-1 py-0">
                    {condition.code}
                  </Badge>
                  {condition.icd_name_en && (
                    <span className="truncate">{condition.icd_name_en}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground/60 mt-1 italic">
                {t("conditions.noIcdCode")}
              </div>
            )}
          </div>
          <StatusBadge status={condition.current_status} />
        </div>

        {/* Timeline */}
        <div className="mt-3 space-y-1">
          {condition.onset_date && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Calendar className="h-3 w-3 shrink-0" />
              <span>
                {t("conditions.onset")}: {format(new Date(condition.onset_date), "dd.MM.yyyy")}
              </span>
            </div>
          )}
          {condition.resolved_date && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
              <span>
                {t("conditions.resolvedOn")}: {format(new Date(condition.resolved_date), "dd.MM.yyyy")}
              </span>
            </div>
          )}
        </div>

        {/* Notes preview */}
        {condition.notes && (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
            {condition.notes}
          </p>
        )}

        {/* Footer: mention count and dates */}
        <div className="mt-3 flex items-end justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span>
              {condition.mention_count} {t("conditions.mentions")}
            </span>
          </div>
          
          {condition.first_mentioned_date && (
            <div className="flex items-center gap-1">
              <span>
                {format(new Date(condition.first_mentioned_date), "MM.yyyy")}
                {condition.last_mentioned_date && 
                  condition.first_mentioned_date !== condition.last_mentioned_date && (
                    <> — {format(new Date(condition.last_mentioned_date), "MM.yyyy")}</>
                  )}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Wrap in Link to condition detail page
  return (
    <Link href={`/health/conditions/${condition.id}`}>
      {cardContent}
    </Link>
  );
}

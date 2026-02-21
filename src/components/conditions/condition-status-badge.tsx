"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConditionStatus } from "@/types";

interface ConditionStatusBadgeProps {
  status: ConditionStatus;
  className?: string;
}

const statusColors: Record<ConditionStatus, string> = {
  active: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
  suspected: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 dark:text-yellow-400",
  resolved: "bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400",
  history: "bg-gray-500/10 text-gray-600 border-gray-500/20 dark:text-gray-400",
};

export function ConditionStatusBadge({ status, className }: ConditionStatusBadgeProps) {
  const t = useTranslations();

  return (
    <Badge variant="outline" className={cn(statusColors[status], className)}>
      {t(`conditions.status.${status}`)}
    </Badge>
  );
}

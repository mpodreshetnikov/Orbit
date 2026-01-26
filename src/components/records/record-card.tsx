"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Calendar, Paperclip, MoreVertical, Eye, Trash2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MedicalRecordListItem, RecordType } from "@/types";
import { cn } from "@/lib/utils";

interface RecordCardProps {
  record: MedicalRecordListItem;
  onView: (record: MedicalRecordListItem) => void;
  onRemove: (record: MedicalRecordListItem) => void;
  onRestore?: (record: MedicalRecordListItem) => void;
  onDelete?: (record: MedicalRecordListItem) => void;
}

const RECORD_TYPE_COLORS: Record<RecordType, string> = {
  lab: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  visit: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  imaging: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  prescription: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  vaccination: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  vet: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  other: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

export function RecordCard({
  record,
  onView,
  onRemove,
  onRestore,
  onDelete,
}: RecordCardProps) {
  const t = useTranslations();

  const isRemoved = record.status === "removed";
  const isDraft = record.status === "draft";

  return (
    <Card
      className={cn(
        "group cursor-pointer transition-all hover:shadow-md",
        isRemoved && "opacity-60"
      )}
      onClick={() => onView(record)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Type badge and status */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn("font-medium", RECORD_TYPE_COLORS[record.record_type])}
              >
                {t(`records.types.${record.record_type}`)}
              </Badge>
              {isDraft && (
                <Badge variant="secondary" className="text-xs">
                  {t("records.status.draft")}
                </Badge>
              )}
              {isRemoved && (
                <Badge variant="destructive" className="text-xs">
                  {t("records.status.removed")}
                </Badge>
              )}
            </div>

            {/* Title */}
            <h3 className="font-semibold text-base truncate">{record.title}</h3>

            {/* Meta info */}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  {record.record_date
                    ? format(new Date(record.record_date), "MMM d, yyyy")
                    : t("records.noDate")}
                </span>
              </div>
              {record.attachment_count > 0 && (
                <div className="flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{record.attachment_count}</span>
                </div>
              )}
            </div>

            {/* Notes preview */}
            {record.notes && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                {record.notes}
              </p>
            )}
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onView(record)}>
                <Eye className="mr-2 h-4 w-4" />
                {t("records.actions.view")}
              </DropdownMenuItem>
              
              {!isRemoved && (
                <DropdownMenuItem
                  onClick={() => onRemove(record)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("records.actions.remove")}
                </DropdownMenuItem>
              )}
              
              {isRemoved && onRestore && (
                <>
                  <DropdownMenuItem onClick={() => onRestore(record)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t("records.actions.restore")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={() => onDelete(record)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("records.actions.delete")}
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

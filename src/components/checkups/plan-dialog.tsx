"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateCheckupItem } from "@/hooks";
import type { CheckupItem } from "@/types";

interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single item or multiple items for batch plan */
  items: CheckupItem[];
  onSaved?: () => void;
}

export function PlanDialog({
  open,
  onOpenChange,
  items,
  onSaved,
}: PlanDialogProps) {
  const t = useTranslations();
  const [plannedOn, setPlannedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const updateMutation = useUpdateCheckupItem();

  useEffect(() => {
    if (open) {
      setPlannedOn(new Date().toISOString().slice(0, 10));
    }
  }, [open]);

  const handleSubmit = async () => {
    const dateValue = plannedOn?.trim().slice(0, 10);
    if (!dateValue) return;
    for (const item of items) {
      await updateMutation.mutateAsync({
        id: item.id,
        updates: { planned_on: dateValue },
      });
    }
    onSaved?.();
    onOpenChange(false);
  };

  const handleRemovePlan = async () => {
    for (const item of items) {
      await updateMutation.mutateAsync({
        id: item.id,
        updates: { planned_on: null },
      });
    }
    onSaved?.();
    onOpenChange(false);
  };

  if (items.length === 0) return null;

  const isBatch = items.length > 1;
  const hasAnyPlanned = items.some((i) => i.planned_on);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("checkups.planFor")}</DialogTitle>
          <DialogDescription>
            {isBatch
              ? t("checkups.planSelectedHint")
              : t("checkups.planForHint")}
            {!isBatch && items[0] && (
              <span className="block mt-1 font-medium text-foreground">{items[0].title}</span>
            )}
            {isBatch && (
              <span className="block mt-1 text-muted-foreground">
                {items.length} {t("checkups.navTitle").toLowerCase()}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="plan-date">{t("checkups.plannedOn")}</Label>
            <Input
              id="plan-date"
              type="date"
              value={plannedOn}
              onChange={(e) => setPlannedOn(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {hasAnyPlanned && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              onClick={handleRemovePlan}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {t("checkups.removePlannedDate")}
            </Button>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={updateMutation.isPending || !plannedOn?.trim()}>
              {updateMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MedDoseEvent, MedDoseEventWithRegimen } from "@/types/regimen";
import type { MedicationUnit } from "@/types";
import { getPlannedIntakeAmount, getPlannedIntakeUnit } from "@/types/regimen";
import { getUnitLabel } from "./medication-units";

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function fromDatetimeLocal(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

interface EditIntakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: MedDoseEvent | MedDoseEventWithRegimen | null;
  onSubmit: (params: {
    takenAt: string;
    amountTaken?: number;
    note?: string | null;
  }) => Promise<void>;
  isPending?: boolean;
}

export function EditIntakeDialog({
  open,
  onOpenChange,
  event,
  onSubmit,
  isPending = false,
}: EditIntakeDialogProps) {
  const t = useTranslations();
  const [takenAt, setTakenAt] = useState("");
  const [amountTaken, setAmountTaken] = useState("1");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open && event) {
      const at = event.taken_at || event.actual_at;
      setTakenAt(at ? toDatetimeLocal(at) : "");
      const amount = getPlannedIntakeAmount(event.planned_intake);
      setAmountTaken(String(amount));
      setNote(event.note ?? "");
    }
  }, [open, event]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    const at = fromDatetimeLocal(takenAt);
    if (!at) return;
    const amount =
      event.status === "taken" ? Math.max(1, Math.floor(Number(amountTaken)) || 1) : undefined;
    await onSubmit({
      takenAt: at,
      amountTaken: amount,
      note: note.trim() || undefined,
    });
    onOpenChange(false);
  };

  const unit = event ? getPlannedIntakeUnit(event.planned_intake) : "pill";
  const regimenName =
    event && "regimen" in event && event.regimen?.custom_name ? event.regimen.custom_name : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("medications.editIntake")}</DialogTitle>
          <DialogDescription>
            {regimenName && <span className="block truncate">{regimenName}</span>}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-intake-time">{t("medications.editIntakeTime")}</Label>
            <Input
              id="edit-intake-time"
              type="datetime-local"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              required
              className="w-full"
            />
          </div>
          {event?.status === "taken" && (
            <div className="space-y-2">
              <Label htmlFor="edit-intake-amount">{t("medications.editIntakeAmount")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="edit-intake-amount"
                  type="number"
                  min={1}
                  step={1}
                  value={amountTaken}
                  onChange={(e) => setAmountTaken(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {getUnitLabel(unit as MedicationUnit, t)}
                </span>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-intake-note">{t("medications.note")}</Label>
            <Textarea
              id="edit-intake-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("medications.notesPlaceholder")}
              rows={2}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

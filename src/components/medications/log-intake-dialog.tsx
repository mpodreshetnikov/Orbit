"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/number-input";
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
import type { MedRegimen } from "@/types/regimen";
import { getPlannedIntakeAmount, toPositiveAmount } from "@/types/regimen";
import { getUnitLabel } from "./medication-units";

export interface LogIntakeDialogSubmitInput {
  regimen_id: string;
  amount: number;
  skipped: boolean;
  note: string | null;
}

interface LogIntakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regimen: MedRegimen | null;
  onSubmit: (input: LogIntakeDialogSubmitInput) => Promise<void>;
}

export function LogIntakeDialog({ open, onOpenChange, regimen, onSubmit }: LogIntakeDialogProps) {
  const t = useTranslations();
  const defaultAmount = regimen
    ? toPositiveAmount(getPlannedIntakeAmount(regimen.dose_definition))
    : 1;
  const [amount, setAmount] = useState(() => defaultAmount);
  const [skipped, setSkipped] = useState(false);
  const [note, setNote] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open && regimen) {
      setAmount(toPositiveAmount(getPlannedIntakeAmount(regimen.dose_definition)));
    }
  }, [open, regimen]);

  const reset = () => {
    setAmount(regimen ? toPositiveAmount(getPlannedIntakeAmount(regimen.dose_definition)) : 1);
    setSkipped(false);
    setNote("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regimen) return;
    setIsPending(true);
    try {
      await onSubmit({
        regimen_id: regimen.id,
        amount: skipped ? 0 : amount,
        skipped,
        note: note.trim() || null,
      });
      handleOpenChange(false);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("medications.logIntake")}</DialogTitle>
          <DialogDescription>{regimen?.custom_name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="skipped"
              checked={skipped}
              onCheckedChange={(checked) => setSkipped(Boolean(checked))}
            />
            <Label htmlFor="skipped">{t("medications.logIntakeSkipped")}</Label>
          </div>
          {!skipped && (
            <div className="space-y-2">
              <Label htmlFor="amount">
                {t("medications.logIntakeAmount")}
                {regimen && (
                  <span className="text-muted-foreground font-normal ml-1">
                    ({getUnitLabel(regimen.intake_unit, t)})
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <NumberInput
                  id="amount"
                  value={amount}
                  onValueChange={(n) => {
                    if (n !== null) setAmount(n);
                  }}
                  className="w-24"
                />
                {regimen && (
                  <span className="text-sm text-muted-foreground">
                    {getUnitLabel(regimen.intake_unit, t)}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="note">{t("medications.note")}</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("medications.logIntakeNotePlaceholder")}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
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

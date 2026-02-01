"use client";

import { useState } from "react";
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
import type { MedRegimen } from "@/types/regimen";
import { getUnitLabel } from "./medication-units";

interface RefillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regimen: MedRegimen | null;
  /** Positive = refill, negative = remove (e.g. lost meds). */
  onSubmit: (amount: number) => Promise<void>;
}

export function RefillDialog({
  open,
  onOpenChange,
  regimen,
  onSubmit,
}: RefillDialogProps) {
  const t = useTranslations();
  const [amount, setAmount] = useState("1");
  const [isPending, setIsPending] = useState(false);

  const reset = () => {
    setAmount("1");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regimen) return;
    const num = Number(amount);
    if (Number.isNaN(num) || num === 0) return;
    setIsPending(true);
    try {
      await onSubmit(num);
      handleOpenChange(false);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("medications.refillButton")}</DialogTitle>
          <DialogDescription>
            {regimen?.custom_name} — {t("medications.refillAmountDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="refillAmount">{t("medications.refillAmountLabel")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="refillAmount"
                type="number"
                step={1}
                placeholder="+5 or -3"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-24"
              />
              {regimen && (
                <span className="text-sm text-muted-foreground">
                  {getUnitLabel(regimen.intake_unit, t)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("medications.refillAmountHelp")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("medications.refillButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

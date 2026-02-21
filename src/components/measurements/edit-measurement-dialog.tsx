"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateMeasurement, useMeasurementCatalogItem } from "@/hooks";
import type { MeasurementHistoryPoint } from "@/types";

interface EditMeasurementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string | null;
  measurement: MeasurementHistoryPoint | null;
  catalogId?: string;
}

export function EditMeasurementDialog({
  open,
  onOpenChange,
  personId,
  measurement,
  catalogId,
}: EditMeasurementDialogProps) {
  const t = useTranslations();
  const [locale, setLocale] = useState("en");
  const [value, setValue] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");
  const [notes, setNotes] = useState("");

  // Get locale from document
  useEffect(() => {
    const htmlLang = document.documentElement.lang || "en";
    setLocale(htmlLang);
  }, []);

  // Populate form when measurement changes
  useEffect(() => {
    if (measurement) {
      setValue(measurement.value.toString());
      setMeasuredAt(format(new Date(measurement.measured_at), "yyyy-MM-dd'T'HH:mm"));
      setNotes(measurement.notes || "");
    }
  }, [measurement]);

  const { data: catalogItem } = useMeasurementCatalogItem(catalogId || null);
  const updateMutation = useUpdateMeasurement();

  const displayUnit = locale === "ru" ? catalogItem?.unit_ru : catalogItem?.unit_en;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!personId || !measurement || !value) return;

    try {
      await updateMutation.mutateAsync({
        id: measurement.id,
        personId,
        updates: {
          value: parseFloat(value),
          measured_at: new Date(measuredAt).toISOString(),
          notes: notes.trim() || null,
        },
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update measurement:", error);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("measurements.editMeasurement")}</DialogTitle>
          <DialogDescription>{t("measurements.editDescription")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Value input */}
          <div className="space-y-2">
            <Label htmlFor="edit-value">{t("measurements.value")}</Label>
            <div className="flex gap-2">
              <Input
                id="edit-value"
                type="number"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="flex-1"
                required
              />
              {displayUnit && (
                <div className="flex items-center px-3 bg-muted rounded-md text-sm text-muted-foreground">
                  {displayUnit}
                </div>
              )}
            </div>
          </div>

          {/* Date/time input */}
          <div className="space-y-2">
            <Label htmlFor="edit-measuredAt">{t("measurements.measuredAt")}</Label>
            <Input
              id="edit-measuredAt"
              type="datetime-local"
              value={measuredAt}
              onChange={(e) => setMeasuredAt(e.target.value)}
              required
            />
          </div>

          {/* Notes input */}
          <div className="space-y-2">
            <Label htmlFor="edit-notes">{t("measurements.notes")}</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("measurements.notesPlaceholder")}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!value || updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { MeasurementCategory, MeasurementSummary } from "@/types";
import { MEASUREMENT_CATEGORY_LABELS, MEASUREMENT_CATEGORIES } from "@/types";

interface MeasurementVisibilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurements: MeasurementSummary[];
  hiddenCodes: Set<string>;
  onToggle: (code: string) => void;
  locale: string;
}

/**
 * Picks which measurement types show up in the list.
 *
 * Only types the person has actually recorded are offered -- hiding a type with
 * no data would do nothing visible. Hiding is display-only: no measurement data
 * is affected and hidden types stay available in the Add Measurement dropdown.
 */
export function MeasurementVisibilityDialog({
  open,
  onOpenChange,
  measurements,
  hiddenCodes,
  onToggle,
  locale,
}: MeasurementVisibilityDialogProps) {
  const t = useTranslations();

  const grouped = MEASUREMENT_CATEGORIES.map((category) => ({
    category,
    items: measurements.filter((m) => m.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("measurements.visibilityTitle")}</DialogTitle>
          <DialogDescription>{t("measurements.visibilityDescription")}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto -mx-6 px-6 space-y-5">
          {grouped.map(({ category, items }) => {
            const categoryLabel = MEASUREMENT_CATEGORY_LABELS[category as MeasurementCategory];
            return (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {locale === "ru" ? categoryLabel.ru : categoryLabel.en}
                </h3>
                <div className="space-y-1">
                  {items.map((m) => {
                    const displayName = locale === "ru" ? m.name_ru : m.name_en;
                    const displayUnit = locale === "ru" ? m.unit_ru : m.unit_en;
                    const inputId = `visibility-${m.code}`;
                    return (
                      <div
                        key={m.code}
                        className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                      >
                        <Checkbox
                          id={inputId}
                          checked={!hiddenCodes.has(m.code)}
                          onCheckedChange={() => onToggle(m.code)}
                        />
                        <Label
                          htmlFor={inputId}
                          className="flex-1 cursor-pointer font-normal leading-tight"
                        >
                          {displayName}
                          {displayUnit && (
                            <span className="text-muted-foreground ml-1.5 text-xs">
                              {displayUnit}
                            </span>
                          )}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateMeasurementCatalogItem, useUpdateMeasurementCatalogItem } from "@/hooks";
import type { MeasurementCatalog, MeasurementCategory } from "@/types";
import { MEASUREMENT_CATEGORY_LABELS, MEASUREMENT_CATEGORIES } from "@/types";

interface MeasurementCatalogEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurement: MeasurementCatalog | null;
}

export function MeasurementCatalogEditDialog({
  open,
  onOpenChange,
  measurement,
}: MeasurementCatalogEditDialogProps) {
  const t = useTranslations();
  const [locale, setLocale] = useState("en");
  const isEditing = !!measurement;

  // Form state
  const [code, setCode] = useState("");
  const [nameRu, setNameRu] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [unitRu, setUnitRu] = useState("");
  const [unitEn, setUnitEn] = useState("");
  const [category, setCategory] = useState<MeasurementCategory>("body");
  const [sortOrder, setSortOrder] = useState("0");

  // Get locale from document
  useEffect(() => {
    const htmlLang = document.documentElement.lang || "en";
    setLocale(htmlLang);
  }, []);

  // Populate form when editing
  useEffect(() => {
    if (measurement) {
      setCode(measurement.code);
      setNameRu(measurement.name_ru);
      setNameEn(measurement.name_en);
      setUnitRu(measurement.unit_ru);
      setUnitEn(measurement.unit_en);
      setCategory(measurement.category);
      setSortOrder(measurement.sort_order.toString());
    } else {
      // Reset form for new measurement
      setCode("");
      setNameRu("");
      setNameEn("");
      setUnitRu("");
      setUnitEn("");
      setCategory("body");
      setSortOrder("0");
    }
  }, [measurement, open]);

  const createMutation = useCreateMeasurementCatalogItem();
  const updateMutation = useUpdateMeasurementCatalogItem();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      code: code.toLowerCase().trim(),
      name_ru: nameRu.trim(),
      name_en: nameEn.trim(),
      unit_ru: unitRu.trim(),
      unit_en: unitEn.trim(),
      category,
      sort_order: parseInt(sortOrder) || 0,
    };

    try {
      if (isEditing && measurement) {
        await updateMutation.mutateAsync({
          id: measurement.id,
          updates: data,
        });
      } else {
        await createMutation.mutateAsync(data);
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save measurement:", error);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("catalogs.editMeasurement") : t("catalogs.addMeasurement")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("catalogs.editMeasurementDescription")
              : t("catalogs.addMeasurementDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="code">{t("catalogs.measurementCode")}</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g., chest, bicep_left"
              required
              disabled={isEditing}
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">{t("catalogs.category")}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as MeasurementCategory)}>
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEASUREMENT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {locale === "ru"
                      ? MEASUREMENT_CATEGORY_LABELS[cat].ru
                      : MEASUREMENT_CATEGORY_LABELS[cat].en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Names */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nameEn">{t("catalogs.nameEn")}</Label>
              <Input
                id="nameEn"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Height"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameRu">{t("catalogs.nameRu")}</Label>
              <Input
                id="nameRu"
                value={nameRu}
                onChange={(e) => setNameRu(e.target.value)}
                placeholder="Рост"
                required
              />
            </div>
          </div>

          {/* Units */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unitEn">{t("catalogs.unitEn")}</Label>
              <Input
                id="unitEn"
                value={unitEn}
                onChange={(e) => setUnitEn(e.target.value)}
                placeholder="cm"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unitRu">{t("catalogs.unitRu")}</Label>
              <Input
                id="unitRu"
                value={unitRu}
                onChange={(e) => setUnitRu(e.target.value)}
                placeholder="см"
                required
              />
            </div>
          </div>

          {/* Sort order */}
          <div className="space-y-2">
            <Label htmlFor="sortOrder">{t("catalogs.sortOrder")}</Label>
            <Input
              id="sortOrder"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="0"
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

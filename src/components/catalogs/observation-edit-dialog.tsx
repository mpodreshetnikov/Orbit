"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateObservation, useUpdateObservation } from "@/hooks";
import type { ObservationCatalog, UnitConversion } from "@/types";

interface ObservationEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  observation: ObservationCatalog | null; // null for create mode
}

interface AcceptedUnitEntry {
  unit: string;
  factor?: string;
  formula?: string;
}

export function ObservationEditDialog({
  open,
  onOpenChange,
  observation,
}: ObservationEditDialogProps) {
  const t = useTranslations();
  const isEditMode = !!observation;

  // Form state
  const [obsCode, setObsCode] = useState("");
  const [nameRu, setNameRu] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [canonicalUnit, setCanonicalUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [defaultRefLow, setDefaultRefLow] = useState<string>("");
  const [defaultRefHigh, setDefaultRefHigh] = useState<string>("");

  // Synonyms state
  const [synonymsRu, setSynonymsRu] = useState<string[]>([]);
  const [synonymsEn, setSynonymsEn] = useState<string[]>([]);
  const [newSynonymRu, setNewSynonymRu] = useState("");
  const [newSynonymEn, setNewSynonymEn] = useState("");

  // Accepted units state
  const [acceptedUnits, setAcceptedUnits] = useState<AcceptedUnitEntry[]>([]);
  const [newUnit, setNewUnit] = useState("");

  // Mutations
  const createMutation = useCreateObservation();
  const updateMutation = useUpdateObservation();

  const isLoading = createMutation.isPending || updateMutation.isPending;

  // Initialize form when dialog opens or observation changes
  useEffect(() => {
    if (open) {
      if (observation) {
        setObsCode(observation.obs_code);
        setNameRu(observation.name_ru);
        setNameEn(observation.name_en);
        setCanonicalUnit(observation.canonical_unit);
        setNotes(observation.notes || "");
        setSynonymsRu(observation.synonyms_ru || []);
        setSynonymsEn(observation.synonyms_en || []);
        setDefaultRefLow(observation.default_ref_low?.toString() || "");
        setDefaultRefHigh(observation.default_ref_high?.toString() || "");

        // Convert accepted_units object to array
        const units: AcceptedUnitEntry[] = Object.entries(observation.accepted_units || {}).map(
          ([unit, config]) => ({
            unit,
            factor: config.factor_to_canonical?.toString() || "",
            formula: config.formula_to_canonical || "",
          }),
        );
        setAcceptedUnits(units);
      } else {
        // Reset form for create mode
        setObsCode("");
        setNameRu("");
        setNameEn("");
        setCanonicalUnit("");
        setNotes("");
        setSynonymsRu([]);
        setSynonymsEn([]);
        setAcceptedUnits([]);
        setDefaultRefLow("");
        setDefaultRefHigh("");
      }
      setNewSynonymRu("");
      setNewSynonymEn("");
      setNewUnit("");
    }
  }, [open, observation]);

  // Handlers for synonyms
  const addSynonymRu = () => {
    const trimmed = newSynonymRu.trim().toLowerCase();
    if (trimmed && !synonymsRu.includes(trimmed)) {
      setSynonymsRu([...synonymsRu, trimmed]);
      setNewSynonymRu("");
    }
  };

  const removeSynonymRu = (synonym: string) => {
    setSynonymsRu(synonymsRu.filter((s) => s !== synonym));
  };

  const addSynonymEn = () => {
    const trimmed = newSynonymEn.trim().toLowerCase();
    if (trimmed && !synonymsEn.includes(trimmed)) {
      setSynonymsEn([...synonymsEn, trimmed]);
      setNewSynonymEn("");
    }
  };

  const removeSynonymEn = (synonym: string) => {
    setSynonymsEn(synonymsEn.filter((s) => s !== synonym));
  };

  // Handlers for accepted units
  const addUnit = () => {
    const trimmed = newUnit.trim();
    if (trimmed && !acceptedUnits.some((u) => u.unit === trimmed)) {
      setAcceptedUnits([...acceptedUnits, { unit: trimmed, factor: "1", formula: "" }]);
      setNewUnit("");
    }
  };

  const removeUnit = (unit: string) => {
    setAcceptedUnits(acceptedUnits.filter((u) => u.unit !== unit));
  };

  const updateUnitFactor = (unit: string, factor: string) => {
    setAcceptedUnits(
      acceptedUnits.map((u) => (u.unit === unit ? { ...u, factor, formula: "" } : u)),
    );
  };

  const updateUnitFormula = (unit: string, formula: string) => {
    setAcceptedUnits(
      acceptedUnits.map((u) => (u.unit === unit ? { ...u, formula, factor: "" } : u)),
    );
  };

  // Convert form state to accepted_units object
  const buildAcceptedUnits = (): Record<string, UnitConversion> => {
    const result: Record<string, UnitConversion> = {};
    for (const entry of acceptedUnits) {
      const conversion: UnitConversion = {};
      if (entry.factor && entry.factor.trim()) {
        conversion.factor_to_canonical = parseFloat(entry.factor);
      }
      if (entry.formula && entry.formula.trim()) {
        conversion.formula_to_canonical = entry.formula;
      }
      result[entry.unit] = conversion;
    }
    return result;
  };

  // Handle form submission
  const handleSubmit = async () => {
    const data = {
      obs_code: obsCode.trim(),
      name_ru: nameRu.trim(),
      name_en: nameEn.trim(),
      canonical_unit: canonicalUnit.trim(),
      synonyms_ru: synonymsRu,
      synonyms_en: synonymsEn,
      accepted_units: buildAcceptedUnits(),
      notes: notes.trim() || null,
      default_ref_low: defaultRefLow.trim() ? parseFloat(defaultRefLow) : null,
      default_ref_high: defaultRefHigh.trim() ? parseFloat(defaultRefHigh) : null,
    };

    try {
      if (isEditMode && observation) {
        await updateMutation.mutateAsync({
          id: observation.id,
          updates: data,
        });
      } else {
        await createMutation.mutateAsync(data);
      }
      onOpenChange(false);
    } catch (error) {
      // Error is handled by the mutation
      console.error("Failed to save observation:", error);
    }
  };

  const isValid = obsCode.trim() && nameRu.trim() && nameEn.trim() && canonicalUnit.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? t("catalogs.editObservation") : t("catalogs.addObservation")}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? t("catalogs.editObservationDescription")
              : t("catalogs.addObservationDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="obs_code">{t("catalogs.obsCode")}</Label>
              <Input
                id="obs_code"
                value={obsCode}
                onChange={(e) => setObsCode(e.target.value)}
                placeholder="e.g., vitamin_b12"
                disabled={isEditMode}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="canonical_unit">{t("catalogs.canonicalUnit")}</Label>
              <Input
                id="canonical_unit"
                value={canonicalUnit}
                onChange={(e) => setCanonicalUnit(e.target.value)}
                placeholder="e.g., pmol/L"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name_ru">{t("catalogs.nameRu")}</Label>
              <Input
                id="name_ru"
                value={nameRu}
                onChange={(e) => setNameRu(e.target.value)}
                placeholder="Название на русском"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name_en">{t("catalogs.nameEn")}</Label>
              <Input
                id="name_en"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Name in English"
              />
            </div>
          </div>

          {/* Default Reference Range */}
          <div className="space-y-2">
            <Label>{t("catalogs.defaultRefRange")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("catalogs.defaultRefRangeDescription")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="default_ref_low" className="text-xs">
                  {t("catalogs.refLow")}
                </Label>
                <Input
                  id="default_ref_low"
                  type="number"
                  step="any"
                  value={defaultRefLow}
                  onChange={(e) => setDefaultRefLow(e.target.value)}
                  placeholder="e.g., 148"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default_ref_high" className="text-xs">
                  {t("catalogs.refHigh")}
                </Label>
                <Input
                  id="default_ref_high"
                  type="number"
                  step="any"
                  value={defaultRefHigh}
                  onChange={(e) => setDefaultRefHigh(e.target.value)}
                  placeholder="e.g., 738"
                />
              </div>
            </div>
          </div>

          {/* Synonyms RU */}
          <div className="space-y-2">
            <Label>{t("catalogs.synonymsRu")}</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {synonymsRu.map((synonym) => (
                <Badge key={synonym} variant="secondary" className="gap-1">
                  {synonym}
                  <Button
                    type="button"
                    onClick={() => removeSynonymRu(synonym)}
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-1 p-0 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newSynonymRu}
                onChange={(e) => setNewSynonymRu(e.target.value)}
                placeholder={t("catalogs.addSynonym")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSynonymRu();
                  }
                }}
              />
              <Button type="button" variant="outline" size="icon" onClick={addSynonymRu}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Synonyms EN */}
          <div className="space-y-2">
            <Label>{t("catalogs.synonymsEn")}</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {synonymsEn.map((synonym) => (
                <Badge key={synonym} variant="secondary" className="gap-1">
                  {synonym}
                  <Button
                    type="button"
                    onClick={() => removeSynonymEn(synonym)}
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-1 p-0 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newSynonymEn}
                onChange={(e) => setNewSynonymEn(e.target.value)}
                placeholder={t("catalogs.addSynonym")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSynonymEn();
                  }
                }}
              />
              <Button type="button" variant="outline" size="icon" onClick={addSynonymEn}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Accepted Units */}
          <div className="space-y-2">
            <Label>{t("catalogs.acceptedUnits")}</Label>
            <div className="space-y-3">
              {acceptedUnits.map((entry) => (
                <div
                  key={entry.unit}
                  className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30"
                >
                  <div className="flex-shrink-0 font-mono text-sm font-medium min-w-[80px]">
                    {entry.unit}
                  </div>
                  <div className="flex-1 grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs shrink-0">{t("catalogs.factor")}:</Label>
                      <Input
                        type="number"
                        step="any"
                        value={entry.factor}
                        onChange={(e) => updateUnitFactor(entry.unit, e.target.value)}
                        className="h-8"
                        placeholder="1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs shrink-0">{t("catalogs.formula")}:</Label>
                      <Input
                        value={entry.formula}
                        onChange={(e) => updateUnitFormula(entry.unit, e.target.value)}
                        className="h-8"
                        placeholder="optional"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeUnit(entry.unit)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder={t("catalogs.addUnit")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addUnit();
                  }
                }}
              />
              <Button type="button" variant="outline" size="icon" onClick={addUnit}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t("catalogs.notes")}</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("catalogs.notesPlaceholder")}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, Plus } from "lucide-react";
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
import { useCreateFindingType, useUpdateFindingType } from "@/hooks";
import type { FindingTypeCatalog } from "@/types";

interface FindingTypeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  findingType: FindingTypeCatalog | null;
}

export function FindingTypeEditDialog({
  open,
  onOpenChange,
  findingType,
}: FindingTypeEditDialogProps) {
  const t = useTranslations();
  const createMutation = useCreateFindingType();
  const updateMutation = useUpdateFindingType();

  const isNew = !findingType;
  const isProcessing = createMutation.isPending || updateMutation.isPending;

  // Form state
  const [findingCode, setFindingCode] = useState("");
  const [nameRu, setNameRu] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [synonymsRu, setSynonymsRu] = useState<string[]>([]);
  const [synonymsEn, setSynonymsEn] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [newSynonymRu, setNewSynonymRu] = useState("");
  const [newSynonymEn, setNewSynonymEn] = useState("");

  // Initialize form
  useEffect(() => {
    if (open) {
      if (findingType) {
        setFindingCode(findingType.finding_code);
        setNameRu(findingType.name_ru);
        setNameEn(findingType.name_en);
        setSynonymsRu(findingType.synonyms_ru || []);
        setSynonymsEn(findingType.synonyms_en || []);
        setNotes(findingType.notes || "");
      } else {
        setFindingCode("");
        setNameRu("");
        setNameEn("");
        setSynonymsRu([]);
        setSynonymsEn([]);
        setNotes("");
      }
      setNewSynonymRu("");
      setNewSynonymEn("");
    }
  }, [open, findingType]);

  const addSynonymRu = () => {
    const trimmed = newSynonymRu.trim().toLowerCase();
    if (trimmed && !synonymsRu.includes(trimmed)) {
      setSynonymsRu([...synonymsRu, trimmed]);
      setNewSynonymRu("");
    }
  };

  const addSynonymEn = () => {
    const trimmed = newSynonymEn.trim().toLowerCase();
    if (trimmed && !synonymsEn.includes(trimmed)) {
      setSynonymsEn([...synonymsEn, trimmed]);
      setNewSynonymEn("");
    }
  };

  const removeSynonymRu = (syn: string) => {
    setSynonymsRu(synonymsRu.filter(s => s !== syn));
  };

  const removeSynonymEn = (syn: string) => {
    setSynonymsEn(synonymsEn.filter(s => s !== syn));
  };

  const handleSave = async () => {
    if (!findingCode.trim() || !nameRu.trim() || !nameEn.trim()) return;

    const data = {
      finding_code: findingCode.trim().toLowerCase(),
      name_ru: nameRu.trim(),
      name_en: nameEn.trim(),
      synonyms_ru: synonymsRu,
      synonyms_en: synonymsEn,
      notes: notes.trim() || null,
    };

    if (isNew) {
      await createMutation.mutateAsync(data);
    } else {
      await updateMutation.mutateAsync({
        id: findingType!.id,
        updates: data,
      });
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? t("catalogs.addFindingType") : t("catalogs.editFindingType")}
          </DialogTitle>
          <DialogDescription>
            {t("catalogs.findingTypeDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="findingCode">{t("catalogs.code")}</Label>
            <Input
              id="findingCode"
              value={findingCode}
              onChange={(e) => setFindingCode(e.target.value)}
              placeholder="polyp"
              disabled={isProcessing}
            />
          </div>

          {/* Russian name */}
          <div className="space-y-2">
            <Label htmlFor="nameRu">{t("catalogs.nameRu")}</Label>
            <Input
              id="nameRu"
              value={nameRu}
              onChange={(e) => setNameRu(e.target.value)}
              placeholder="Полип"
              disabled={isProcessing}
            />
          </div>

          {/* English name */}
          <div className="space-y-2">
            <Label htmlFor="nameEn">{t("catalogs.nameEn")}</Label>
            <Input
              id="nameEn"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Polyp"
              disabled={isProcessing}
            />
          </div>

          {/* Russian synonyms */}
          <div className="space-y-2">
            <Label>{t("catalogs.synonymsRu")}</Label>
            <div className="flex gap-2">
              <Input
                value={newSynonymRu}
                onChange={(e) => setNewSynonymRu(e.target.value)}
                placeholder={t("catalogs.addSynonym")}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSynonymRu())}
                disabled={isProcessing}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addSynonymRu}
                disabled={isProcessing}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {synonymsRu.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {synonymsRu.map((syn) => (
                  <Badge key={syn} variant="secondary" className="gap-1">
                    {syn}
                    <Button
                      type="button"
                      onClick={() => removeSynonymRu(syn)}
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 p-0 hover:text-destructive"
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* English synonyms */}
          <div className="space-y-2">
            <Label>{t("catalogs.synonymsEn")}</Label>
            <div className="flex gap-2">
              <Input
                value={newSynonymEn}
                onChange={(e) => setNewSynonymEn(e.target.value)}
                placeholder={t("catalogs.addSynonym")}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSynonymEn())}
                disabled={isProcessing}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addSynonymEn}
                disabled={isProcessing}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {synonymsEn.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {synonymsEn.map((syn) => (
                  <Badge key={syn} variant="secondary" className="gap-1">
                    {syn}
                    <Button
                      type="button"
                      onClick={() => removeSynonymEn(syn)}
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 p-0 hover:text-destructive"
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t("catalogs.notes")}</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("catalogs.notesPlaceholder")}
              rows={2}
              disabled={isProcessing}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!findingCode.trim() || !nameRu.trim() || !nameEn.trim() || isProcessing}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

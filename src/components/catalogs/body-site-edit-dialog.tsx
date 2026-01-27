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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateBodySite, useUpdateBodySite } from "@/hooks";
import type { BodySiteCatalog } from "@/types";

interface BodySiteEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bodySite: BodySiteCatalog | null;
  allSites: BodySiteCatalog[];
}

export function BodySiteEditDialog({
  open,
  onOpenChange,
  bodySite,
  allSites,
}: BodySiteEditDialogProps) {
  const t = useTranslations();
  const createMutation = useCreateBodySite();
  const updateMutation = useUpdateBodySite();

  const isNew = !bodySite;
  const isProcessing = createMutation.isPending || updateMutation.isPending;

  // Form state
  const [siteCode, setSiteCode] = useState("");
  const [nameRu, setNameRu] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [parentSiteCode, setParentSiteCode] = useState<string | null>(null);
  const [synonymsRu, setSynonymsRu] = useState<string[]>([]);
  const [synonymsEn, setSynonymsEn] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [newSynonymRu, setNewSynonymRu] = useState("");
  const [newSynonymEn, setNewSynonymEn] = useState("");

  // Initialize form
  useEffect(() => {
    if (open) {
      if (bodySite) {
        setSiteCode(bodySite.site_code);
        setNameRu(bodySite.name_ru);
        setNameEn(bodySite.name_en);
        setParentSiteCode(bodySite.parent_site_code);
        setSynonymsRu(bodySite.synonyms_ru || []);
        setSynonymsEn(bodySite.synonyms_en || []);
        setNotes(bodySite.notes || "");
      } else {
        setSiteCode("");
        setNameRu("");
        setNameEn("");
        setParentSiteCode(null);
        setSynonymsRu([]);
        setSynonymsEn([]);
        setNotes("");
      }
      setNewSynonymRu("");
      setNewSynonymEn("");
    }
  }, [open, bodySite]);

  // Get available parent sites (exclude self and descendants to prevent circular references)
  const availableParents = allSites.filter(s => {
    if (!bodySite) return true;
    // Exclude self
    if (s.id === bodySite.id) return false;
    // Exclude sites that have this site as parent (to prevent circular refs)
    let current = s;
    while (current.parent_site_code) {
      if (current.parent_site_code === bodySite.site_code) return false;
      const parent = allSites.find(p => p.site_code === current.parent_site_code);
      if (!parent) break;
      current = parent;
    }
    return true;
  });

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
    if (!siteCode.trim() || !nameRu.trim() || !nameEn.trim()) return;

    const data = {
      site_code: siteCode.trim().toLowerCase(),
      name_ru: nameRu.trim(),
      name_en: nameEn.trim(),
      parent_site_code: parentSiteCode || null,
      synonyms_ru: synonymsRu,
      synonyms_en: synonymsEn,
      notes: notes.trim() || null,
    };

    if (isNew) {
      await createMutation.mutateAsync(data);
    } else {
      await updateMutation.mutateAsync({
        id: bodySite!.id,
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
            {isNew ? t("catalogs.addBodySite") : t("catalogs.editBodySite")}
          </DialogTitle>
          <DialogDescription>
            {t("catalogs.bodySiteDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="siteCode">{t("catalogs.code")}</Label>
            <Input
              id="siteCode"
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value)}
              placeholder="kidney_left"
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
              placeholder="Левая почка"
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
              placeholder="Left kidney"
              disabled={isProcessing}
            />
          </div>

          {/* Parent Site */}
          <div className="space-y-2">
            <Label>{t("catalogs.parentSite")}</Label>
            <Select
              value={parentSiteCode || "__none__"}
              onValueChange={(value) => setParentSiteCode(value === "__none__" ? null : value)}
              disabled={isProcessing}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("catalogs.selectParentSite")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("catalogs.noParent")}</SelectItem>
                {availableParents.map((site) => (
                  <SelectItem key={site.site_code} value={site.site_code}>
                    {site.name_ru} ({site.site_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    <button
                      type="button"
                      onClick={() => removeSynonymRu(syn)}
                      className="hover:text-destructive"
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </button>
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
                    <button
                      type="button"
                      onClick={() => removeSynonymEn(syn)}
                      className="hover:text-destructive"
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </button>
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
            disabled={!siteCode.trim() || !nameRu.trim() || !nameEn.trim() || isProcessing}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

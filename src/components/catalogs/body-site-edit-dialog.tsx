"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { X, Plus, Search, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const [parentSearch, setParentSearch] = useState("");
  const [isParentComboboxOpen, setIsParentComboboxOpen] = useState(false);
  const parentComboboxRef = useRef<HTMLDivElement>(null);
  const parentInputRef = useRef<HTMLInputElement>(null);

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
      setParentSearch("");
      setIsParentComboboxOpen(false);
    }
  }, [open, bodySite]);

  // Close parent combobox when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (parentComboboxRef.current && !parentComboboxRef.current.contains(event.target as Node)) {
        setIsParentComboboxOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  // Filter available parents based on search
  const filteredParents = availableParents.filter(site => {
    if (!parentSearch.trim()) return true;
    const search = parentSearch.toLowerCase();
    return (
      site.site_code.toLowerCase().includes(search) ||
      site.name_ru.toLowerCase().includes(search) ||
      site.name_en.toLowerCase().includes(search) ||
      site.synonyms_ru?.some(s => s.toLowerCase().includes(search)) ||
      site.synonyms_en?.some(s => s.toLowerCase().includes(search))
    );
  });

  // Display value for parent site combobox
  const parentDisplayValue = parentSiteCode
    ? (() => {
        const parent = allSites.find(s => s.site_code === parentSiteCode);
        return parent ? `${parent.name_ru} (${parent.site_code})` : "";
      })()
    : "";

  const handleParentSelect = (siteCode: string | null) => {
    setParentSiteCode(siteCode);
    setParentSearch("");
    setIsParentComboboxOpen(false);
  };

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
            <div className="relative" ref={parentComboboxRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={parentInputRef}
                  value={isParentComboboxOpen ? parentSearch : parentDisplayValue}
                  onChange={(e) => {
                    setParentSearch(e.target.value);
                    if (!isParentComboboxOpen) setIsParentComboboxOpen(true);
                  }}
                  onFocus={() => {
                    setIsParentComboboxOpen(true);
                    setParentSearch("");
                  }}
                  placeholder={t("catalogs.selectParentSite")}
                  className="pl-9 pr-9"
                  disabled={isProcessing}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-9 hover:bg-transparent"
                  onClick={() => {
                    setIsParentComboboxOpen(!isParentComboboxOpen);
                    if (!isParentComboboxOpen) {
                      setParentSearch("");
                      parentInputRef.current?.focus();
                    }
                  }}
                  disabled={isProcessing}
                >
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              
              {/* Dropdown */}
              {isParentComboboxOpen && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                  <ScrollArea className="max-h-60">
                    <div className="p-1">
                      {/* No parent option */}
                      <button
                        type="button"
                        onClick={() => handleParentSelect(null)}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                          parentSiteCode === null ? "bg-accent" : ""
                        }`}
                      >
                        <Check className={`h-4 w-4 ${parentSiteCode === null ? "opacity-100" : "opacity-0"}`} />
                        <span className="text-muted-foreground italic">
                          {t("catalogs.noParent")}
                        </span>
                      </button>
                      
                      {/* Available parent sites */}
                      {filteredParents.map((site) => (
                        <button
                          key={site.site_code}
                          type="button"
                          onClick={() => handleParentSelect(site.site_code)}
                          className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                            parentSiteCode === site.site_code ? "bg-accent" : ""
                          }`}
                        >
                          <Check className={`h-4 w-4 shrink-0 ${parentSiteCode === site.site_code ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{site.name_ru}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {site.site_code}
                            </div>
                          </div>
                        </button>
                      ))}
                      
                      {filteredParents.length === 0 && parentSearch && (
                        <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                          {t("catalogs.noSearchResults")}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
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

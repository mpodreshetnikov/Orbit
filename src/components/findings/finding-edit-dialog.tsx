"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Search, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useFindingTypeCatalog, useBodySiteCatalog } from "@/hooks";
import type {
  RecordFindingWithCatalog,
  FindingSeverity,
  FindingLaterality,
} from "@/types";

interface FindingEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finding: Partial<RecordFindingWithCatalog> | null;
  onSave: (data: {
    finding_type_id: string | null;
    finding_code: string | null;
    finding_type_text: string;
    body_site_id: string | null;
    site_code: string | null;
    body_site_text: string | null;
    size_mm: number | null;
    count: number | null;
    severity: FindingSeverity;
    laterality: FindingLaterality;
    morphology: string | null;
    description: string | null;
    histology: string | null;
    finding_date: string | null;
    source_anchor: string;
  }) => void;
  isNew: boolean;
}

export function FindingEditDialog({
  open,
  onOpenChange,
  finding,
  onSave,
  isNew,
}: FindingEditDialogProps) {
  const t = useTranslations();
  const { data: findingTypeCatalog } = useFindingTypeCatalog();
  const { data: bodySiteCatalog } = useBodySiteCatalog();

  // Form state
  const [findingTypeText, setFindingTypeText] = useState("");
  const [selectedFindingCode, setSelectedFindingCode] = useState<string | null>(null);
  const [bodySiteText, setBodySiteText] = useState("");
  const [selectedSiteCode, setSelectedSiteCode] = useState<string | null>(null);
  const [sizeMm, setSizeMm] = useState("");
  const [count, setCount] = useState("");
  const [severity, setSeverity] = useState<FindingSeverity>("unknown");
  const [laterality, setLaterality] = useState<FindingLaterality>("none");
  const [morphology, setMorphology] = useState("");
  const [description, setDescription] = useState("");
  const [histology, setHistology] = useState("");
  const [findingDate, setFindingDate] = useState("");
  const [sourceAnchor, setSourceAnchor] = useState("");

  // Combobox state
  const [findingTypeSearch, setFindingTypeSearch] = useState("");
  const [bodySiteSearch, setBodySiteSearch] = useState("");
  const [isFindingTypeOpen, setIsFindingTypeOpen] = useState(false);
  const [isBodySiteOpen, setIsBodySiteOpen] = useState(false);
  
  const findingTypeRef = useRef<HTMLDivElement>(null);
  const bodySiteRef = useRef<HTMLDivElement>(null);
  const findingTypeInputRef = useRef<HTMLInputElement>(null);
  const bodySiteInputRef = useRef<HTMLInputElement>(null);

  // Initialize form when dialog opens
  useEffect(() => {
    if (open) {
      if (finding) {
        setFindingTypeText(finding.finding_type_text || "");
        setSelectedFindingCode(finding.finding_code || null);
        setBodySiteText(finding.body_site_text || "");
        setSelectedSiteCode(finding.site_code || null);
        setSizeMm(finding.size_mm?.toString() || "");
        setCount(finding.count?.toString() || "");
        setSeverity(finding.severity || "unknown");
        setLaterality(finding.laterality || "none");
        setMorphology(finding.morphology || "");
        setDescription(finding.description || "");
        setHistology(finding.histology || "");
        setFindingDate(finding.finding_date || "");
        setSourceAnchor(finding.source_anchor || "");
      } else if (isNew) {
        // Reset form for new finding
        setFindingTypeText("");
        setSelectedFindingCode(null);
        setBodySiteText("");
        setSelectedSiteCode(null);
        setSizeMm("");
        setCount("");
        setSeverity("unknown");
        setLaterality("none");
        setMorphology("");
        setDescription("");
        setHistology("");
        setFindingDate("");
        setSourceAnchor("");
      }
      setFindingTypeSearch("");
      setBodySiteSearch("");
      setIsFindingTypeOpen(false);
      setIsBodySiteOpen(false);
    }
  }, [open, finding, isNew]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (findingTypeRef.current && !findingTypeRef.current.contains(event.target as Node)) {
        setIsFindingTypeOpen(false);
      }
      if (bodySiteRef.current && !bodySiteRef.current.contains(event.target as Node)) {
        setIsBodySiteOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Get current catalog entries
  const currentFindingType = selectedFindingCode 
    ? findingTypeCatalog?.find(c => c.finding_code === selectedFindingCode) 
    : null;
  const currentBodySite = selectedSiteCode 
    ? bodySiteCatalog?.find(c => c.site_code === selectedSiteCode) 
    : null;

  // Filter catalogs based on search
  const filteredFindingTypes = findingTypeCatalog?.filter(item => {
    if (!findingTypeSearch.trim()) return true;
    const search = findingTypeSearch.toLowerCase();
    return (
      item.finding_code.toLowerCase().includes(search) ||
      item.name_ru.toLowerCase().includes(search) ||
      item.name_en.toLowerCase().includes(search) ||
      item.synonyms_ru?.some(s => s.toLowerCase().includes(search)) ||
      item.synonyms_en?.some(s => s.toLowerCase().includes(search))
    );
  }) || [];

  const filteredBodySites = bodySiteCatalog?.filter(item => {
    if (!bodySiteSearch.trim()) return true;
    const search = bodySiteSearch.toLowerCase();
    return (
      item.site_code.toLowerCase().includes(search) ||
      item.name_ru.toLowerCase().includes(search) ||
      item.name_en.toLowerCase().includes(search) ||
      item.synonyms_ru?.some(s => s.toLowerCase().includes(search)) ||
      item.synonyms_en?.some(s => s.toLowerCase().includes(search))
    );
  }) || [];

  // Handle finding type selection
  const handleFindingTypeSelect = (code: string | null) => {
    if (code === null) {
      setSelectedFindingCode(null);
      setFindingTypeSearch("");
      setIsFindingTypeOpen(false);
      return;
    }
    const entry = findingTypeCatalog?.find(c => c.finding_code === code);
    if (entry) {
      setSelectedFindingCode(code);
      setFindingTypeText(entry.name_ru);
      setFindingTypeSearch("");
      setIsFindingTypeOpen(false);
    }
  };

  // Handle body site selection
  const handleBodySiteSelect = (code: string | null) => {
    if (code === null) {
      setSelectedSiteCode(null);
      setBodySiteSearch("");
      setIsBodySiteOpen(false);
      return;
    }
    const entry = bodySiteCatalog?.find(c => c.site_code === code);
    if (entry) {
      setSelectedSiteCode(code);
      setBodySiteText(entry.name_ru);
      setBodySiteSearch("");
      setIsBodySiteOpen(false);
    }
  };

  // Handle save
  const handleSave = () => {
    const sizeNum = parseFloat(sizeMm);
    const countNum = parseInt(count);

    onSave({
      finding_type_id: currentFindingType?.id || null,
      finding_code: selectedFindingCode,
      finding_type_text: findingTypeText.trim(),
      body_site_id: currentBodySite?.id || null,
      site_code: selectedSiteCode,
      body_site_text: bodySiteText.trim() || null,
      size_mm: !isNaN(sizeNum) ? sizeNum : null,
      count: !isNaN(countNum) ? countNum : null,
      severity,
      laterality,
      morphology: morphology.trim() || null,
      description: description.trim() || null,
      histology: histology.trim() || null,
      finding_date: findingDate || null,
      source_anchor: sourceAnchor.trim(),
    });
  };

  // Display values for comboboxes
  const findingTypeDisplayValue = currentFindingType 
    ? `${currentFindingType.name_ru} (${currentFindingType.finding_code})`
    : "";
  const bodySiteDisplayValue = currentBodySite 
    ? `${currentBodySite.name_ru} (${currentBodySite.site_code})`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? t("findings.add") : t("findings.edit")}
          </DialogTitle>
          <DialogDescription>
            {t("findings.editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Finding Type Selector */}
          <div className="space-y-2">
            <Label>{t("findings.findingType")}</Label>
            <div className="relative" ref={findingTypeRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={findingTypeInputRef}
                  value={isFindingTypeOpen ? findingTypeSearch : findingTypeDisplayValue}
                  onChange={(e) => {
                    setFindingTypeSearch(e.target.value);
                    if (!isFindingTypeOpen) setIsFindingTypeOpen(true);
                  }}
                  onFocus={() => {
                    setIsFindingTypeOpen(true);
                    setFindingTypeSearch("");
                  }}
                  placeholder={t("findings.searchFindingType")}
                  className="pl-9 pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-9 hover:bg-transparent"
                  onClick={() => {
                    setIsFindingTypeOpen(!isFindingTypeOpen);
                    if (!isFindingTypeOpen) {
                      setFindingTypeSearch("");
                      findingTypeInputRef.current?.focus();
                    }
                  }}
                >
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              
              {isFindingTypeOpen && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                  <ScrollArea className="max-h-60">
                    <div className="p-1">
                      <button
                        type="button"
                        onClick={() => handleFindingTypeSelect(null)}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                          selectedFindingCode === null ? "bg-accent" : ""
                        }`}
                      >
                        <Check className={`h-4 w-4 ${selectedFindingCode === null ? "opacity-100" : "opacity-0"}`} />
                        <span className="text-muted-foreground italic">{t("findings.customFinding")}</span>
                      </button>
                      
                      {filteredFindingTypes.map((item) => (
                        <button
                          key={item.finding_code}
                          type="button"
                          onClick={() => handleFindingTypeSelect(item.finding_code)}
                          className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                            selectedFindingCode === item.finding_code ? "bg-accent" : ""
                          }`}
                        >
                          <Check className={`h-4 w-4 shrink-0 ${selectedFindingCode === item.finding_code ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{item.name_ru}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.finding_code}
                            </div>
                          </div>
                        </button>
                      ))}
                      
                      {filteredFindingTypes.length === 0 && findingTypeSearch && (
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

          {/* Finding Type Text (if custom) */}
          {!currentFindingType && (
            <div className="space-y-2">
              <Label htmlFor="findingTypeText">{t("findings.findingTypeText")}</Label>
              <Input
                id="findingTypeText"
                value={findingTypeText}
                onChange={(e) => setFindingTypeText(e.target.value)}
                placeholder={t("findings.findingTypeTextPlaceholder")}
              />
            </div>
          )}

          {/* Body Site Selector */}
          <div className="space-y-2">
            <Label>{t("findings.bodySite")}</Label>
            <div className="relative" ref={bodySiteRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={bodySiteInputRef}
                  value={isBodySiteOpen ? bodySiteSearch : bodySiteDisplayValue}
                  onChange={(e) => {
                    setBodySiteSearch(e.target.value);
                    if (!isBodySiteOpen) setIsBodySiteOpen(true);
                  }}
                  onFocus={() => {
                    setIsBodySiteOpen(true);
                    setBodySiteSearch("");
                  }}
                  placeholder={t("findings.searchBodySite")}
                  className="pl-9 pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-9 hover:bg-transparent"
                  onClick={() => {
                    setIsBodySiteOpen(!isBodySiteOpen);
                    if (!isBodySiteOpen) {
                      setBodySiteSearch("");
                      bodySiteInputRef.current?.focus();
                    }
                  }}
                >
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              
              {isBodySiteOpen && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                  <ScrollArea className="max-h-60">
                    <div className="p-1">
                      <button
                        type="button"
                        onClick={() => handleBodySiteSelect(null)}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                          selectedSiteCode === null ? "bg-accent" : ""
                        }`}
                      >
                        <Check className={`h-4 w-4 ${selectedSiteCode === null ? "opacity-100" : "opacity-0"}`} />
                        <span className="text-muted-foreground italic">{t("findings.customSite")}</span>
                      </button>
                      
                      {filteredBodySites.map((item) => (
                        <button
                          key={item.site_code}
                          type="button"
                          onClick={() => handleBodySiteSelect(item.site_code)}
                          className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                            selectedSiteCode === item.site_code ? "bg-accent" : ""
                          }`}
                        >
                          <Check className={`h-4 w-4 shrink-0 ${selectedSiteCode === item.site_code ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{item.name_ru}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.site_code}
                              {item.parent_site_code && ` (${item.parent_site_code})`}
                            </div>
                          </div>
                        </button>
                      ))}
                      
                      {filteredBodySites.length === 0 && bodySiteSearch && (
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

          {/* Body Site Text (if custom) */}
          {!currentBodySite && (
            <div className="space-y-2">
              <Label htmlFor="bodySiteText">{t("findings.bodySiteText")}</Label>
              <Input
                id="bodySiteText"
                value={bodySiteText}
                onChange={(e) => setBodySiteText(e.target.value)}
                placeholder={t("findings.bodySiteTextPlaceholder")}
              />
            </div>
          )}

          {/* Size and Count */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sizeMm">{t("findings.size")}</Label>
              <Input
                id="sizeMm"
                type="number"
                step="0.1"
                value={sizeMm}
                onChange={(e) => setSizeMm(e.target.value)}
                placeholder="10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="count">{t("findings.count")}</Label>
              <Input
                id="count"
                type="number"
                step="1"
                min="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="1"
              />
            </div>
          </div>

          {/* Severity and Laterality */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("findings.severity")}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as FindingSeverity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">{t("findings.severityOptions.unknown")}</SelectItem>
                  <SelectItem value="mild">{t("findings.severityOptions.mild")}</SelectItem>
                  <SelectItem value="moderate">{t("findings.severityOptions.moderate")}</SelectItem>
                  <SelectItem value="severe">{t("findings.severityOptions.severe")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("findings.laterality")}</Label>
              <Select value={laterality} onValueChange={(v) => setLaterality(v as FindingLaterality)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("findings.lateralityOptions.none")}</SelectItem>
                  <SelectItem value="left">{t("findings.lateralityOptions.left")}</SelectItem>
                  <SelectItem value="right">{t("findings.lateralityOptions.right")}</SelectItem>
                  <SelectItem value="bilateral">{t("findings.lateralityOptions.bilateral")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Finding Date */}
          <div className="space-y-2">
            <Label htmlFor="findingDate">{t("findings.findingDate")}</Label>
            <Input
              id="findingDate"
              type="date"
              value={findingDate}
              onChange={(e) => setFindingDate(e.target.value)}
            />
          </div>

          {/* Source Anchor */}
          <div className="space-y-2">
            <Label htmlFor="sourceAnchor">{t("findings.sourceAnchor")} *</Label>
            <Textarea
              id="sourceAnchor"
              value={sourceAnchor}
              onChange={(e) => setSourceAnchor(e.target.value)}
              placeholder={t("findings.sourceAnchorPlaceholder")}
              rows={2}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">{t("findings.description")}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("findings.descriptionPlaceholder")}
              rows={2}
            />
          </div>

          {/* Morphology */}
          <div className="space-y-2">
            <Label htmlFor="morphology">{t("findings.morphology")}</Label>
            <Input
              id="morphology"
              value={morphology}
              onChange={(e) => setMorphology(e.target.value)}
              placeholder={t("findings.morphologyPlaceholder")}
            />
          </div>

          {/* Histology */}
          <div className="space-y-2">
            <Label htmlFor="histology">{t("findings.histology")}</Label>
            <Textarea
              id="histology"
              value={histology}
              onChange={(e) => setHistology(e.target.value)}
              placeholder={t("findings.histologyPlaceholder")}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!findingTypeText.trim() || !sourceAnchor.trim()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

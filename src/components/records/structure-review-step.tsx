"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Save,
  FileCheck,
  Loader2,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
  FlaskConical,
  Pencil,
  Trash2,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Check,
  ArrowLeft,
  Search,
  ChevronsUpDown,
  Stethoscope,
  HeartPulse,
  CircleDot,
  History,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  useUpdateMedicalRecord,
  useRecordObservations,
  useUpdateRecordObservation,
  useDeleteRecordObservation,
  useCreateRecordObservation,
  useObservationCatalog,
  useRecordFindings,
  useUpdateRecordFinding,
  useDeleteRecordFinding,
  useCreateRecordFinding,
  useRecordConditions,
  usePersonConditions,
  useUpdateConditionRecord,
  useDeleteConditionRecord,
  useCreateConditionWithRecord,
  useLinkConditionToRecord,
  usePersonFindingHistory,
  usePersonConditionRecordHistory,
  usePersonObservationHistory,
} from "@/hooks";
import { FindingRow, FindingEditDialog, type FindingComparison } from "@/components/findings";
import { ConditionRecordRow, ConditionEditDialog, type ConditionComparison } from "@/components/conditions";
import { 
  RECORD_TYPES, 
  type RecordType, 
  type MedicalRecordWithAttachments,
  type RecordObservationWithCatalog,
  type ObservationStatus,
  type RecordFindingWithCatalog,
  type FindingSeverity,
  type FindingLaterality,
  type ConditionRecordWithDetails,
  type ConditionStatus,
} from "@/types";

interface StructureReviewStepProps {
  record: MedicalRecordWithAttachments;
  onComplete: () => void;
  onBack?: () => void;
}

// Status badge component
function ObservationStatusBadge({ status }: { status: ObservationStatus | null }) {
  const t = useTranslations();
  
  if (!status || status === "unknown") {
    return null;
  }

  const config: Record<string, { variant: "default" | "destructive" | "secondary" | "outline"; icon: React.ReactNode }> = {
    normal: { variant: "secondary", icon: <Check className="h-3 w-3" /> },
    low: { variant: "outline", icon: <ArrowDown className="h-3 w-3 text-blue-500" /> },
    high: { variant: "outline", icon: <ArrowUp className="h-3 w-3 text-orange-500" /> },
    critical_low: { variant: "destructive", icon: <ArrowDown className="h-3 w-3" /> },
    critical_high: { variant: "destructive", icon: <ArrowUp className="h-3 w-3" /> },
  };

  const { variant, icon } = config[status] || { variant: "secondary", icon: null };

  return (
    <Badge variant={variant} className="gap-1 text-xs">
      {icon}
      {t(`observations.status.${status}`)}
    </Badge>
  );
}

// Type for observation comparison
type ObservationComparisonData = { 
  isNew: boolean; 
  previousOccurrences: number;
  previousValue: number | null;
  previousUnit: string | null;
};

// Observation value change indicator
// Uses "closer to middle of reference range is better" logic
function ObservationValueChangeIndicator({ 
  currentValue, 
  previousValue,
  unit,
  refLow,
  refHigh,
  defaultRefLow,
  defaultRefHigh,
}: { 
  currentValue: number | null; 
  previousValue: number | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  defaultRefLow?: number | null;
  defaultRefHigh?: number | null;
}) {
  const t = useTranslations();
  
  if (currentValue === null || previousValue === null) return null;
  
  // Round to 2 decimal places to avoid floating point issues
  const change = Math.round((currentValue - previousValue) * 100) / 100;
  
  if (change === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <span>= {previousValue}{unit ? ` ${unit}` : ""}</span>
      </span>
    );
  }
  
  const isIncrease = change > 0;
  const changeText = isIncrease ? `+${change}` : `${change}`;
  
  // Use specific ref range if available, otherwise use defaults
  const effectiveRefLow = refLow ?? defaultRefLow;
  const effectiveRefHigh = refHigh ?? defaultRefHigh;
  
  // Determine if change is an improvement based on distance from reference range middle
  let isImprovement: boolean | null = null;
  if (effectiveRefLow != null && effectiveRefHigh != null) {
    const middle = (effectiveRefLow + effectiveRefHigh) / 2;
    const prevDistance = Math.abs(previousValue - middle);
    const currDistance = Math.abs(currentValue - middle);
    isImprovement = currDistance < prevDistance;
  }
  
  // Determine color: green = improvement, red = worsening, gray = unknown
  let colorClass = "text-muted-foreground"; // fallback if no ref range
  if (isImprovement === true) {
    colorClass = "text-green-600 dark:text-green-400";
  } else if (isImprovement === false) {
    colorClass = "text-red-600 dark:text-red-400";
  }
  
  return (
    <span className={`flex items-center gap-0.5 text-xs ${colorClass}`}>
      {isIncrease ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      <span>{changeText}</span>
      <span className="text-muted-foreground/70">({t("observations.comparison.was")} {previousValue.toFixed(2)})</span>
    </span>
  );
}

// Observation comparison badge
function ObservationComparisonBadge({ comparison }: { comparison: ObservationComparisonData }) {
  const t = useTranslations();
  if (comparison.isNew) {
    return (
      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1">
        <CircleDot className="h-3 w-3" />
        {t("observations.comparison.new")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20 gap-1" title={t("observations.comparison.knownTitle", { count: comparison.previousOccurrences })}>
      <History className="h-3 w-3" />
      {t("observations.comparison.known", { count: comparison.previousOccurrences })}
    </Badge>
  );
}

// Observation row component
function ObservationRow({ 
  observation,
  comparison,
  onEdit, 
  onDelete,
  onApply,
  isProcessing,
}: { 
  observation: RecordObservationWithCatalog;
  comparison?: ObservationComparisonData | null;
  onEdit: () => void;
  onDelete: () => void;
  onApply: () => void;
  isProcessing: boolean;
}) {
  const t = useTranslations();
  const isCustom = !observation.obs_code;
  const isUnapplied = isCustom && !observation.is_applied;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
      isUnapplied 
        ? "border-dashed border-muted-foreground/40 opacity-70" 
        : isCustom 
          ? "border-dashed border-muted-foreground/40"
          : comparison?.isNew
            ? "border-amber-500/30 bg-amber-500/5" 
          : ""
    }`}>
      {/* Name and value */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium truncate ${isUnapplied ? "text-muted-foreground" : ""}`}>
            {observation.obs_name}
          </span>
          {observation.obs_code ? (
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {observation.obs_code}
            </code>
          ) : isUnapplied ? (
            <Badge 
              variant="outline" 
              className="text-xs border-dashed text-yellow-600 border-yellow-400"
            >
              {t("observations.pendingBadge")}
            </Badge>
          ) : (
            <Badge 
              variant="outline" 
              className="text-xs border-dashed text-muted-foreground"
              title={t("observations.addToCatalogHint")}
            >
              {t("observations.customBadge")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm flex-wrap">
          {/* Reference range (numeric) */}
          {(observation.ref_range_low !== null || observation.ref_range_high !== null) && (
            <span className="text-muted-foreground/70 text-xs">
              ({observation.ref_range_low ?? "—"}–{observation.ref_range_high ?? "—"})
            </span>
          )}
          <span className={`font-semibold ${isUnapplied ? "text-muted-foreground" : ""}`}>
            {observation.value_text || observation.value_numeric}
          </span>
          {observation.unit && (
            <span className="text-muted-foreground">{observation.unit}</span>
          )}
          {/* Value change indicator */}
          {comparison && !comparison.isNew && comparison.previousValue !== null && (
            <ObservationValueChangeIndicator
              currentValue={observation.value_numeric}
              previousValue={comparison.previousValue}
              unit={observation.unit}
              refLow={observation.ref_range_low}
              refHigh={observation.ref_range_high}
              defaultRefLow={observation.default_ref_low}
              defaultRefHigh={observation.default_ref_high}
            />
          )}
        </div>
        {/* Hint for unapplied custom observations */}
        {isUnapplied && (
          <p className="text-xs text-yellow-600 mt-1 italic">
            {t("observations.applyHint")}
          </p>
        )}
        {/* Subtle hint for applied custom observations */}
        {isCustom && !isUnapplied && (
          <p className="text-xs text-muted-foreground/70 mt-1 italic">
            {t("observations.addToCatalogHint")}
          </p>
        )}
      </div>

      {/* Comparison badge */}
      {comparison && <ObservationComparisonBadge comparison={comparison} />}

      {/* Status */}
      <ObservationStatusBadge status={observation.status as ObservationStatus} />

      {/* Confidence indicator */}
      {observation.confidence !== null && observation.confidence < 0.8 && (
        <span title={t("observations.lowConfidence")}>
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Apply button for unapplied custom observations */}
        {isUnapplied && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={onApply}
            disabled={isProcessing}
          >
            <Check className="h-3.5 w-3.5" />
            {t("observations.applyButton")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
          disabled={isProcessing}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isProcessing}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Edit observation dialog
function EditObservationDialog({
  open,
  onOpenChange,
  observation,
  onSave,
  isNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  observation: Partial<RecordObservationWithCatalog> | null;
  onSave: (data: {
    obs_name: string;
    value_text: string;
    value_numeric: number | null;
    value_canonical: number | null;
    unit: string;
    unit_canonical: string | null;
    ref_range_text: string;
    ref_range_low: number | null;
    ref_range_high: number | null;
    ref_range_low_canonical: number | null;
    ref_range_high_canonical: number | null;
    status: ObservationStatus | null;
    obs_code: string | null;
  }) => void;
  isNew: boolean;
}) {
  const t = useTranslations();
  const { data: catalog } = useObservationCatalog();

  const [obsName, setObsName] = useState("");
  const [valueText, setValueText] = useState("");
  const [unit, setUnit] = useState("");
  const [refRange, setRefRange] = useState("");
  const [refRangeLow, setRefRangeLow] = useState("");
  const [refRangeHigh, setRefRangeHigh] = useState("");
  const [status, setStatus] = useState<ObservationStatus | null>(null);
  const [obsCode, setObsCode] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const currentCatalogEntry = obsCode ? catalog?.find(c => c.obs_code === obsCode) : null;

  useEffect(() => {
    if (open && observation) {
      setObsName(observation.obs_name || "");
      setValueText(observation.value_text || "");
      setUnit(observation.unit || "");
      setRefRange(observation.ref_range_text || "");
      setRefRangeLow(observation.ref_range_low?.toString() || "");
      setRefRangeHigh(observation.ref_range_high?.toString() || "");
      setStatus(observation.status as ObservationStatus || null);
      setObsCode(observation.obs_code || null);
      setCatalogSearch("");
      setIsComboboxOpen(false);
    } else if (open && isNew) {
      setObsName("");
      setValueText("");
      setUnit("");
      setRefRange("");
      setRefRangeLow("");
      setRefRangeHigh("");
      setStatus(null);
      setObsCode(null);
      setCatalogSearch("");
      setIsComboboxOpen(false);
    }
  }, [open, observation, isNew]);

  // Close combobox when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setIsComboboxOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Convert value to canonical using catalog unit config
  const convertToCanonical = (value: number | null, unitStr: string): number | null => {
    if (value === null) return null;
    if (!currentCatalogEntry?.accepted_units) return value;
    
    // Find unit config (case-insensitive)
    const unitConfig = Object.entries(currentCatalogEntry.accepted_units).find(
      ([u]) => u.toLowerCase() === unitStr.toLowerCase()
    )?.[1] as { factor_to_canonical?: number; formula_to_canonical?: string } | undefined;
    
    if (!unitConfig) return value;
    
    // Apply formula if exists
    if (unitConfig.formula_to_canonical) {
      try {
        const formula = unitConfig.formula_to_canonical.replace(/x/g, value.toString());
        return eval(formula);
      } catch {
        return value;
      }
    }
    
    // Apply factor if exists
    if (unitConfig.factor_to_canonical) {
      return value * unitConfig.factor_to_canonical;
    }
    
    return value;
  };

  const handleSave = () => {
    const numericValue = parseFloat(valueText);
    const refLow = parseFloat(refRangeLow);
    const refHigh = parseFloat(refRangeHigh);
    const valueNumeric = !isNaN(numericValue) ? numericValue : null;
    const refLowVal = !isNaN(refLow) ? refLow : null;
    const refHighVal = !isNaN(refHigh) ? refHigh : null;
    const unitTrimmed = unit.trim();
    
    // Convert values to canonical
    const valueCanonical = convertToCanonical(valueNumeric, unitTrimmed);
    const refLowCanonical = convertToCanonical(refLowVal, unitTrimmed);
    const refHighCanonical = convertToCanonical(refHighVal, unitTrimmed);
    
    // Get canonical unit from catalog
    const unitCanonical = currentCatalogEntry?.canonical_unit || null;
    
    onSave({
      obs_name: obsName.trim(),
      value_text: valueText.trim(),
      value_numeric: valueNumeric,
      value_canonical: valueCanonical,
      unit: unitTrimmed,
      unit_canonical: unitCanonical,
      ref_range_text: refRange.trim(),
      ref_range_low: refLowVal,
      ref_range_high: refHighVal,
      ref_range_low_canonical: refLowCanonical,
      ref_range_high_canonical: refHighCanonical,
      status,
      obs_code: obsCode,
    });
  };

  const handleCatalogSelect = (code: string | null) => {
    if (code === null) {
      setObsCode(null);
      setUnit("");
      setCatalogSearch("");
      setIsComboboxOpen(false);
      return;
    }
    const entry = catalog?.find(c => c.obs_code === code);
    if (entry) {
      setObsCode(code);
      setObsName(entry.name_ru);
      setUnit(entry.canonical_unit);
      setCatalogSearch("");
      setIsComboboxOpen(false);
    }
  };

  // Get accepted units from catalog entry
  const acceptedUnits = currentCatalogEntry?.accepted_units 
    ? Object.keys(currentCatalogEntry.accepted_units) 
    : null;

  // Filter catalog items based on search
  const filteredCatalog = catalog?.filter(item => {
    if (!catalogSearch.trim()) return true;
    const search = catalogSearch.toLowerCase();
    return (
      item.obs_code.toLowerCase().includes(search) ||
      item.name_ru.toLowerCase().includes(search) ||
      item.name_en.toLowerCase().includes(search) ||
      item.synonyms_ru?.some(s => s.toLowerCase().includes(search)) ||
      item.synonyms_en?.some(s => s.toLowerCase().includes(search))
    );
  }) || [];

  // Display value for the combobox
  const displayValue = currentCatalogEntry 
    ? `${currentCatalogEntry.name_ru} (${currentCatalogEntry.obs_code})`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? t("observations.addObservation") : t("observations.editObservation")}
          </DialogTitle>
          <DialogDescription>
            {t("observations.editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Searchable catalog combobox */}
          {catalog && catalog.length > 0 && (
            <div className="space-y-2">
              <Label>{t("observations.fromCatalog")}</Label>
              <div className="relative" ref={comboboxRef}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={inputRef}
                    value={isComboboxOpen ? catalogSearch : displayValue}
                    onChange={(e) => {
                      setCatalogSearch(e.target.value);
                      if (!isComboboxOpen) setIsComboboxOpen(true);
                    }}
                    onFocus={() => {
                      setIsComboboxOpen(true);
                      setCatalogSearch("");
                    }}
                    placeholder={t("observations.searchOrSelect")}
                    className="pl-9 pr-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-9 hover:bg-transparent"
                    onClick={() => {
                      setIsComboboxOpen(!isComboboxOpen);
                      if (!isComboboxOpen) {
                        setCatalogSearch("");
                        inputRef.current?.focus();
                      }
                    }}
                  >
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
                
                {/* Dropdown */}
                {isComboboxOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                    <ScrollArea className="max-h-60">
                      <div className="p-1">
                        {/* Custom option */}
                        <button
                          type="button"
                          onClick={() => handleCatalogSelect(null)}
                          className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                            obsCode === null ? "bg-accent" : ""
                          }`}
                        >
                          <Check className={`h-4 w-4 ${obsCode === null ? "opacity-100" : "opacity-0"}`} />
                          <span className="text-muted-foreground italic">
                            {t("observations.customObservation")}
                          </span>
                        </button>
                        
                        {/* Catalog items */}
                        {filteredCatalog.map((item) => (
                          <button
                            key={item.obs_code}
                            type="button"
                            onClick={() => handleCatalogSelect(item.obs_code)}
                            className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                              obsCode === item.obs_code ? "bg-accent" : ""
                            }`}
                          >
                            <Check className={`h-4 w-4 shrink-0 ${obsCode === item.obs_code ? "opacity-100" : "opacity-0"}`} />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{item.name_ru}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {item.obs_code} · {item.canonical_unit}
                              </div>
                            </div>
                          </button>
                        ))}
                        
                        {filteredCatalog.length === 0 && catalogSearch && (
                          <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                            {t("catalogs.noSearchResults")}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
              {currentCatalogEntry && (
                <p className="text-xs text-muted-foreground">
                  {t("observations.selectedFromCatalog")}: {currentCatalogEntry.obs_code}
                </p>
              )}
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="obs_name">{t("observations.name")}</Label>
            <Input
              id="obs_name"
              value={obsName}
              onChange={(e) => setObsName(e.target.value)}
              placeholder={t("observations.namePlaceholder")}
              disabled={!!currentCatalogEntry}
            />
            {currentCatalogEntry && (
              <p className="text-xs text-muted-foreground">
                {t("observations.nameFromCatalog")}
              </p>
            )}
          </div>

          {/* Value and Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="value">{t("observations.value")}</Label>
              <Input
                id="value"
                value={valueText}
                onChange={(e) => setValueText(e.target.value)}
                placeholder="14.2"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("observations.unit")}</Label>
              {acceptedUnits && acceptedUnits.length > 0 ? (
                <Select value={unit || "_none"} onValueChange={(v) => setUnit(v === "_none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("observations.selectUnit")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">—</SelectItem>
                    {acceptedUnits.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="g/L"
                />
              )}
            </div>
          </div>

          {/* Reference range */}
          <div className="space-y-2">
            <Label>{t("observations.refRange")}</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ref_low" className="text-xs text-muted-foreground">
                  {t("observations.refLow")}
                </Label>
                <Input
                  id="ref_low"
                  type="number"
                  step="any"
                  value={refRangeLow}
                  onChange={(e) => setRefRangeLow(e.target.value)}
                  placeholder="12.0"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ref_high" className="text-xs text-muted-foreground">
                  {t("observations.refHigh")}
                </Label>
                <Input
                  id="ref_high"
                  type="number"
                  step="any"
                  value={refRangeHigh}
                  onChange={(e) => setRefRangeHigh(e.target.value)}
                  placeholder="16.0"
                />
              </div>
            </div>
            <Input
              value={refRange}
              onChange={(e) => setRefRange(e.target.value)}
              placeholder={t("observations.refRangeText")}
              className="text-xs"
            />
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>{t("observations.statusLabel")}</Label>
            <Select 
              value={status || "_unknown"} 
              onValueChange={(v) => setStatus(v === "_unknown" ? null : v as ObservationStatus)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("observations.selectStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_unknown">{t("observations.status.unknown")}</SelectItem>
                <SelectItem value="normal">{t("observations.status.normal")}</SelectItem>
                <SelectItem value="low">{t("observations.status.low")}</SelectItem>
                <SelectItem value="high">{t("observations.status.high")}</SelectItem>
                <SelectItem value="critical_low">{t("observations.status.critical_low")}</SelectItem>
                <SelectItem value="critical_high">{t("observations.status.critical_high")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!obsName.trim()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StructureReviewStep({ record, onComplete, onBack }: StructureReviewStepProps) {
  const t = useTranslations();
  const router = useRouter();
  
  // Form state
  const [title, setTitle] = useState(record.title);
  const [recordType, setRecordType] = useState<RecordType>(record.record_type);
  const [recordDate, setRecordDate] = useState(record.record_date || "");
  const [notes, setNotes] = useState(record.notes || "");
  const [keywords, setKeywords] = useState<string[]>(record.llm_keywords || []);
  const [newKeyword, setNewKeyword] = useState("");
  const [showOcrText, setShowOcrText] = useState(false);

  // Observations
  const { data: observations, isLoading: observationsLoading } = useRecordObservations(record.id);
  const [editingObservation, setEditingObservation] = useState<RecordObservationWithCatalog | null>(null);
  const [isAddingObservation, setIsAddingObservation] = useState(false);
  const [showObservations, setShowObservations] = useState(true);

  // Findings
  const { data: findings, isLoading: findingsLoading } = useRecordFindings(record.id);
  const { data: personFindingHistory } = usePersonFindingHistory(record.person_id);
  const [editingFinding, setEditingFinding] = useState<RecordFindingWithCatalog | null>(null);
  const [isAddingFinding, setIsAddingFinding] = useState(false);
  const [showFindings, setShowFindings] = useState(true);

  // Conditions
  const { data: conditionRecords, isLoading: conditionsLoading } = useRecordConditions(record.id);
  const { data: personConditions } = usePersonConditions(record.person_id);
  const { data: personConditionRecordHistory } = usePersonConditionRecordHistory(record.person_id);
  const { data: personObservationHistory } = usePersonObservationHistory(record.person_id);
  const [editingCondition, setEditingCondition] = useState<ConditionRecordWithDetails | null>(null);
  const [isAddingCondition, setIsAddingCondition] = useState(false);
  const [showConditions, setShowConditions] = useState(true);

  const updateMutation = useUpdateMedicalRecord();
  const updateObsMutation = useUpdateRecordObservation();
  const deleteObsMutation = useDeleteRecordObservation();
  const createObsMutation = useCreateRecordObservation();
  const updateFindingMutation = useUpdateRecordFinding();
  const deleteFindingMutation = useDeleteRecordFinding();
  const createFindingMutation = useCreateRecordFinding();
  const updateConditionRecordMutation = useUpdateConditionRecord();
  const deleteConditionRecordMutation = useDeleteConditionRecord();
  const createConditionWithRecordMutation = useCreateConditionWithRecord();
  const linkConditionToRecordMutation = useLinkConditionToRecord();

  const isProcessing = updateMutation.isPending || updateObsMutation.isPending || 
    deleteObsMutation.isPending || createObsMutation.isPending ||
    updateFindingMutation.isPending || deleteFindingMutation.isPending || createFindingMutation.isPending ||
    updateConditionRecordMutation.isPending || deleteConditionRecordMutation.isPending || 
    createConditionWithRecordMutation.isPending || linkConditionToRecordMutation.isPending;

  // Helper function to compute comparison data for a finding
  const getComparisonForFinding = (finding: RecordFindingWithCatalog): FindingComparison | null => {
    if (personFindingHistory === undefined) return null; // Still loading
    
    const findingKey = finding.finding_code || finding.finding_type_text.toLowerCase().trim();
    const siteKey = finding.site_code || (finding.body_site_text?.toLowerCase().trim() || "unknown");
    
    const historyMatch = personFindingHistory.find(h => {
      const historyFindingKey = h.finding_code || h.finding_type_text.toLowerCase().trim();
      const historySiteKey = h.site_code || (h.body_site_text?.toLowerCase().trim() || "unknown");
      return historyFindingKey === findingKey && historySiteKey === siteKey;
    });
    
    if (!historyMatch) {
      return {
        isNew: true,
        previousOccurrences: 0,
        previousSize: null,
        previousCount: null,
        previousDate: null,
      };
    }
    
    // Filter out findings from this same record
    const previousOccurrences = historyMatch.history.filter(h => h.record_id !== record.id);
    
    if (previousOccurrences.length === 0) {
      return {
        isNew: true,
        previousOccurrences: 0,
        previousSize: null,
        previousCount: null,
        previousDate: null,
      };
    }
    
    const mostRecentPrevious = previousOccurrences[0];
    return {
      isNew: false,
      previousOccurrences: previousOccurrences.length,
      previousSize: mostRecentPrevious.size_mm,
      previousCount: mostRecentPrevious.count,
      previousDate: mostRecentPrevious.record_date,
    };
  };

  const getComparisonForCondition = (cr: ConditionRecordWithDetails): ConditionComparison | null => {
    if (personConditionRecordHistory === undefined) return null;
    const recordIds = personConditionRecordHistory[cr.condition_id] ?? [];
    const previousOccurrences = recordIds.filter((id) => id !== record.id).length;
    return {
      isNew: previousOccurrences === 0,
      previousOccurrences,
    };
  };

  const getComparisonForObservation = (obs: RecordObservationWithCatalog): { 
    isNew: boolean; 
    previousOccurrences: number;
    previousValue: number | null;
    previousUnit: string | null;
  } | null => {
    if (personObservationHistory === undefined) return null;
    const obsKey = obs.obs_code || obs.obs_name.toLowerCase().trim();
    const historySummary = personObservationHistory.find(h => {
      const historyKey = h.obs_code || h.obs_name.toLowerCase().trim();
      return historyKey === obsKey;
    });
    if (!historySummary) {
      return { isNew: true, previousOccurrences: 0, previousValue: null, previousUnit: null };
    }
    // Filter out current record and sort by date descending to get most recent previous
    const previousHistory = historySummary.history
      .filter(h => h.record_id !== record.id)
      .sort((a, b) => {
        const dateA = new Date(a.record_date || a.created_at).getTime();
        const dateB = new Date(b.record_date || b.created_at).getTime();
        return dateB - dateA;
      });
    if (previousHistory.length === 0) {
      return { isNew: true, previousOccurrences: 0, previousValue: null, previousUnit: null };
    }
    const mostRecent = previousHistory[0];
    return {
      isNew: false,
      previousOccurrences: previousHistory.length,
      previousValue: mostRecent.value_canonical ?? mostRecent.value_numeric,
      previousUnit: mostRecent.unit_canonical || mostRecent.unit,
    };
  };

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords((prev) => [...prev, trimmed]);
      setNewKeyword("");
    }
  };

  const removeKeyword = (keywordToRemove: string) => {
    setKeywords((prev) => prev.filter((k) => k !== keywordToRemove));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  };

  const handleSave = async (activate: boolean) => {
    if (!title.trim()) return;

    await updateMutation.mutateAsync({
      id: record.id,
      updates: {
        title: title.trim(),
        record_type: recordType,
        record_date: recordDate || null,
        notes: notes.trim() || null,
        llm_keywords: keywords.length > 0 ? keywords : null,
        status: activate ? "active" : "draft",
      },
    });

    // When activating, mark all observations, findings, and conditions as verified
    if (activate) {
      await Promise.all([
        verifyAllObservations(),
        verifyAllFindings(),
        verifyAllConditions(),
      ]);
      router.push("/health");
    } else {
      onComplete();
    }
  };

  const handleEditObservation = (obs: RecordObservationWithCatalog) => {
    setEditingObservation(obs);
    setIsAddingObservation(false);
  };

  const handleAddObservation = () => {
    setEditingObservation(null);
    setIsAddingObservation(true);
  };

  const handleSaveObservation = async (data: {
    obs_name: string;
    value_text: string;
    value_numeric: number | null;
    value_canonical: number | null;
    unit: string;
    unit_canonical: string | null;
    ref_range_text: string;
    ref_range_low: number | null;
    ref_range_high: number | null;
    ref_range_low_canonical: number | null;
    ref_range_high_canonical: number | null;
    status: ObservationStatus | null;
    obs_code: string | null;
  }) => {
    if (isAddingObservation) {
      await createObsMutation.mutateAsync({
        record_id: record.id,
        obs_name: data.obs_name,
        value_text: data.value_text,
        value_numeric: data.value_numeric,
        value_canonical: data.value_canonical,
        unit: data.unit || null,
        unit_canonical: data.unit_canonical,
        ref_range_text: data.ref_range_text || null,
        ref_range_low: data.ref_range_low,
        ref_range_high: data.ref_range_high,
        ref_range_low_canonical: data.ref_range_low_canonical,
        ref_range_high_canonical: data.ref_range_high_canonical,
        status: data.status,
        obs_code: data.obs_code,
        is_llm_extracted: false,
        is_user_verified: true,
        is_applied: true, // User manually added, so it's applied
      });
    } else if (editingObservation) {
      await updateObsMutation.mutateAsync({
        id: editingObservation.id,
        updates: {
          obs_name: data.obs_name,
          value_text: data.value_text,
          value_numeric: data.value_numeric,
          value_canonical: data.value_canonical,
          unit: data.unit || null,
          unit_canonical: data.unit_canonical,
          ref_range_text: data.ref_range_text || null,
          ref_range_low: data.ref_range_low,
          ref_range_high: data.ref_range_high,
          ref_range_low_canonical: data.ref_range_low_canonical,
          ref_range_high_canonical: data.ref_range_high_canonical,
          status: data.status,
          obs_code: data.obs_code,
          is_user_verified: true,
          is_applied: true, // User edited, so it's applied
        },
      });
    }

    setEditingObservation(null);
    setIsAddingObservation(false);
  };

  const handleDeleteObservation = async (obs: RecordObservationWithCatalog) => {
    await deleteObsMutation.mutateAsync({ id: obs.id, recordId: record.id });
  };

  const handleApplyObservation = async (obs: RecordObservationWithCatalog) => {
    await updateObsMutation.mutateAsync({
      id: obs.id,
      updates: { is_applied: true },
    });
  };

  const verifyAllObservations = async () => {
    if (!observations || observations.length === 0) return;
    
    // Verify all unverified observations
    const unverified = observations.filter(obs => !obs.is_user_verified);
    await Promise.all(
      unverified.map(obs => 
        updateObsMutation.mutateAsync({
          id: obs.id,
          updates: { is_user_verified: true },
        })
      )
    );
  };

  // Finding handlers
  const handleEditFinding = (finding: RecordFindingWithCatalog) => {
    setEditingFinding(finding);
    setIsAddingFinding(false);
  };

  const handleAddFinding = () => {
    setEditingFinding(null);
    setIsAddingFinding(true);
  };

  const handleSaveFinding = async (data: {
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
  }) => {
    if (isAddingFinding) {
      await createFindingMutation.mutateAsync({
        person_id: record.person_id,
        record_id: record.id,
        ...data,
        is_llm_extracted: false,
        is_user_verified: true,
      });
    } else if (editingFinding) {
      await updateFindingMutation.mutateAsync({
        id: editingFinding.id,
        updates: {
          ...data,
          is_user_verified: true,
        },
      });
    }

    setEditingFinding(null);
    setIsAddingFinding(false);
  };

  const handleDeleteFinding = async (finding: RecordFindingWithCatalog) => {
    await deleteFindingMutation.mutateAsync({ id: finding.id, recordId: record.id });
  };

  const verifyAllFindings = async () => {
    if (!findings || findings.length === 0) return;
    
    const unverified = findings.filter(f => !f.is_user_verified);
    await Promise.all(
      unverified.map(f => 
        updateFindingMutation.mutateAsync({
          id: f.id,
          updates: { is_user_verified: true },
        })
      )
    );
  };

  // Condition handlers
  const handleEditCondition = (cr: ConditionRecordWithDetails) => {
    setEditingCondition(cr);
    setIsAddingCondition(false);
  };

  const handleAddCondition = () => {
    setEditingCondition(null);
    setIsAddingCondition(true);
  };

  const handleSaveCondition = async (data: {
    condition_id?: string;
    name?: string;
    code?: string | null;
    icd_name_en?: string | null;
    icd_name_ru?: string | null;
    status_in_record: ConditionStatus;
    source_anchor: string | null;
  }) => {
    if (isAddingCondition) {
      if (data.condition_id) {
        // Linking to existing condition (auto-updates current_status if most recent)
        await linkConditionToRecordMutation.mutateAsync({
          condition_id: data.condition_id,
          record_id: record.id,
          status_in_record: data.status_in_record,
          source_anchor: data.source_anchor || undefined,
          // Pass ICD code if user added one
          code: data.code,
          icd_name_en: data.icd_name_en,
        });
      } else if (data.name) {
        // Creating new condition
        await createConditionWithRecordMutation.mutateAsync({
          person_id: record.person_id,
          record_id: record.id,
          name: data.name,
          code: data.code,
          icd_name_en: data.icd_name_en,
          icd_name_ru: data.icd_name_ru,
          status: data.status_in_record,
          source_anchor: data.source_anchor || undefined,
        });
      }
    } else if (editingCondition) {
      // Editing existing condition record (auto-updates current_status if most recent)
      await updateConditionRecordMutation.mutateAsync({
        id: editingCondition.id,
        updates: {
          status_in_record: data.status_in_record,
          source_anchor: data.source_anchor,
          is_user_verified: true,
        },
        recordId: record.id,
        conditionId: editingCondition.condition_id,
        code: data.code,
        icd_name_en: data.icd_name_en,
      });
    }

    setEditingCondition(null);
    setIsAddingCondition(false);
  };

  const handleDeleteCondition = async (cr: ConditionRecordWithDetails) => {
    await deleteConditionRecordMutation.mutateAsync({
      id: cr.id,
      recordId: record.id,
    });
  };

  const verifyAllConditions = async () => {
    if (!conditionRecords || conditionRecords.length === 0) return;
    
    const unverified = conditionRecords.filter(cr => !cr.is_user_verified);
    await Promise.all(
      unverified.map(cr => 
        updateConditionRecordMutation.mutateAsync({
          id: cr.id,
          updates: { is_user_verified: true },
        })
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("records.structure.reviewTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("records.structure.reviewDescription")}
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: Main fields */}
        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">{t("records.add.recordTitle")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("records.add.recordTitlePlaceholder")}
              disabled={isProcessing}
            />
          </div>

          {/* Record Type */}
          <div className="space-y-2">
            <Label htmlFor="recordType">{t("records.add.recordType")}</Label>
            <Select
              value={recordType}
              onValueChange={(value) => setRecordType(value as RecordType)}
              disabled={isProcessing}
            >
              <SelectTrigger id="recordType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECORD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`records.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Record Date */}
          <div className="space-y-2">
            <Label htmlFor="recordDate">{t("records.add.recordDate")}</Label>
            <Input
              id="recordDate"
              type="date"
              value={recordDate}
              onChange={(e) => setRecordDate(e.target.value)}
              disabled={isProcessing}
            />
          </div>

          {/* Summary/Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t("records.add.notes")}</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("records.add.notesPlaceholder")}
              rows={4}
              disabled={isProcessing}
            />
          </div>
        </div>

        {/* Right column: Keywords and OCR text */}
        <div className="space-y-4">
          {/* Keywords */}
          <div className="space-y-2">
            <Label>{t("records.detail.keywords")}</Label>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {keywords.map((keyword, index) => (
                  <Badge key={index} variant="secondary" className="gap-1 pr-1">
                    {keyword}
                    <button
                      type="button"
                      onClick={() => removeKeyword(keyword)}
                      className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {keywords.length === 0 && (
                  <span className="text-sm text-muted-foreground italic">
                    {t("records.structure.noKeywords")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={handleKeywordKeyDown}
                  placeholder={t("records.wizard.addKeyword")}
                  disabled={isProcessing}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addKeyword}
                  disabled={!newKeyword.trim() || isProcessing}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* OCR Text (collapsible reference) */}
          {record.ocr_text && (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3">
              <button
                type="button"
                onClick={() => setShowOcrText(!showOcrText)}
                className="flex w-full items-center justify-between text-left"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span>
                    {t("records.detail.ocrText")} ({record.ocr_text.length} {t("records.wizard.chars")})
                  </span>
                </div>
                {showOcrText ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {showOcrText && (
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">
                  {record.ocr_text}
                </pre>
              )}
            </div>
          )}

          {/* Attachment count */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>
                {t("records.detail.attachments")}: {record.attachments.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Observations Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowObservations(!showObservations)}
              className="flex items-center gap-2 text-left"
            >
              <FlaskConical className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("observations.title")}
                {observations && observations.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {observations.length}
                  </Badge>
                )}
              </CardTitle>
              {showObservations ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddObservation}
              disabled={isProcessing}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("observations.add")}
            </Button>
          </div>
        </CardHeader>
        {showObservations && (
          <CardContent className="pt-0">
            {observationsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : observations && observations.length > 0 ? (
              <div className="space-y-2">
                {observations.map((obs) => (
                  <ObservationRow
                    key={obs.id}
                    observation={obs}
                    comparison={getComparisonForObservation(obs)}
                    onEdit={() => handleEditObservation(obs)}
                    onDelete={() => handleDeleteObservation(obs)}
                    onApply={() => handleApplyObservation(obs)}
                    isProcessing={isProcessing}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("observations.noObservations")}</p>
                <p className="text-xs mt-1">{t("observations.noObservationsHint")}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Edit/Add Observation Dialog */}
      <EditObservationDialog
        open={!!editingObservation || isAddingObservation}
        onOpenChange={(open) => {
          if (!open) {
            setEditingObservation(null);
            setIsAddingObservation(false);
          }
        }}
        observation={editingObservation}
        onSave={handleSaveObservation}
        isNew={isAddingObservation}
      />

      {/* Findings Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowFindings(!showFindings)}
              className="flex items-center gap-2 text-left"
            >
              <Stethoscope className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("findings.title")}
                {findings && findings.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {findings.length}
                  </Badge>
                )}
              </CardTitle>
              {showFindings ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddFinding}
              disabled={isProcessing}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("findings.add")}
            </Button>
          </div>
        </CardHeader>
        {showFindings && (
          <CardContent className="pt-0">
            {findingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : findings && findings.length > 0 ? (
              <div className="space-y-2">
                {findings.map((finding) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    comparison={getComparisonForFinding(finding)}
                    onEdit={() => handleEditFinding(finding)}
                    onDelete={() => handleDeleteFinding(finding)}
                    isProcessing={isProcessing}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Stethoscope className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("findings.noFindings")}</p>
                <p className="text-xs mt-1">{t("findings.noFindingsHint")}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Edit/Add Finding Dialog */}
      <FindingEditDialog
        open={!!editingFinding || isAddingFinding}
        onOpenChange={(open) => {
          if (!open) {
            setEditingFinding(null);
            setIsAddingFinding(false);
          }
        }}
        finding={editingFinding}
        recordDate={record.record_date ?? null}
        onSave={handleSaveFinding}
        isNew={isAddingFinding}
      />

      {/* Conditions Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowConditions(!showConditions)}
              className="flex items-center gap-2 text-left"
            >
              <HeartPulse className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("conditions.title")}
                {conditionRecords && conditionRecords.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {conditionRecords.length}
                  </Badge>
                )}
              </CardTitle>
              {showConditions ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCondition}
              disabled={isProcessing}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("conditions.add")}
            </Button>
          </div>
        </CardHeader>
        {showConditions && (
          <CardContent className="pt-0">
            {conditionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : conditionRecords && conditionRecords.length > 0 ? (
              <div className="space-y-2">
                {conditionRecords.map((cr) => (
                  <ConditionRecordRow
                    key={cr.id}
                    conditionRecord={cr}
                    comparison={getComparisonForCondition(cr)}
                    onEdit={() => handleEditCondition(cr)}
                    onDelete={() => handleDeleteCondition(cr)}
                    isProcessing={isProcessing}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <HeartPulse className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("conditions.noConditions")}</p>
                <p className="text-xs mt-1">{t("conditions.noConditionsHint")}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Edit/Add Condition Dialog */}
      <ConditionEditDialog
        open={!!editingCondition || isAddingCondition}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCondition(null);
            setIsAddingCondition(false);
          }
        }}
        conditionRecord={editingCondition}
        existingConditions={personConditions || []}
        onSave={handleSaveCondition}
        isNew={isAddingCondition}
      />

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 border-t pt-6">
        {onBack ? (
          <Button
            variant="outline"
            onClick={onBack}
            disabled={isProcessing}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("records.structure.backToOcr")}
          </Button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => handleSave(false)}
            disabled={!title.trim() || isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {t("records.add.saveDraft")}
          </Button>
          <Button
            onClick={() => handleSave(true)}
            disabled={!title.trim() || isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileCheck className="mr-2 h-4 w-4" />
            )}
            {t("records.add.saveAndActivate")}
          </Button>
        </div>
      </div>
    </div>
  );
}

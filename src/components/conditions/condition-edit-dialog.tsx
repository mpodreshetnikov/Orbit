"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronsUpDown,
  Check,
  Plus,
  Loader2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  History,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { useIcdLookup } from "@/hooks";
import { cn } from "@/lib/utils";
import type { Condition, ConditionRecordWithDetails, ConditionStatus } from "@/types";

interface ConditionEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conditionRecord: ConditionRecordWithDetails | null;
  existingConditions: Condition[];
  onSave: (data: {
    // If linking to existing condition
    condition_id?: string;
    // If creating new condition
    name?: string;
    code?: string | null;
    icd_name_en?: string | null;
    icd_name_ru?: string | null;
    // Common fields
    status_in_record: ConditionStatus;
    source_anchor: string | null;
  }) => void | Promise<void>;
  isNew: boolean;
}

export function ConditionEditDialog({
  open,
  onOpenChange,
  conditionRecord,
  existingConditions,
  onSave,
  isNew,
}: ConditionEditDialogProps) {
  const t = useTranslations();

  // Form state
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [selectedConditionId, setSelectedConditionId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [icdCode, setIcdCode] = useState("");
  const [statusInRecord, setStatusInRecord] = useState<ConditionStatus>("suspected");
  const [sourceAnchor, setSourceAnchor] = useState("");
  const [saving, setSaving] = useState(false);

  // Combobox state
  const [conditionSearch, setConditionSearch] = useState("");
  const [isConditionOpen, setIsConditionOpen] = useState(false);
  const [showStatusTips, setShowStatusTips] = useState(false);

  // ICD validation hook (validates entered code)
  const { data: icdLookup, isLoading: icdLoading } = useIcdLookup(
    icdCode.length >= 2 ? icdCode : null,
  );

  // Initialize form when dialog opens
  useEffect(() => {
    if (open) {
      if (conditionRecord?.is_proposal) {
        // A proposal names a condition the chart does not have yet, so it is edited the way a
        // new one is: the reviewer can correct the model's name and code before approving it.
        setMode("new");
        setSelectedConditionId(null);
        setName(conditionRecord.condition_name);
        setIcdCode(conditionRecord.condition_code || "");
        setStatusInRecord(conditionRecord.status_in_record);
        setSourceAnchor(conditionRecord.source_anchor || "");
      } else if (conditionRecord) {
        // Editing existing condition record
        setMode("existing");
        setSelectedConditionId(conditionRecord.condition_id);
        setName(conditionRecord.condition_name);
        setIcdCode(conditionRecord.condition_code || "");
        setStatusInRecord(conditionRecord.status_in_record);
        setSourceAnchor(conditionRecord.source_anchor || "");
      } else if (isNew) {
        // Adding new condition record
        setMode("new");
        setSelectedConditionId(null);
        setName("");
        setIcdCode("");
        setStatusInRecord("suspected");
        setSourceAnchor("");
      }
      setConditionSearch("");
      setIsConditionOpen(false);
    }
  }, [open, conditionRecord, isNew]);

  // Get current selected condition
  const selectedCondition = selectedConditionId
    ? existingConditions.find((c) => c.id === selectedConditionId)
    : null;

  // Filter conditions based on search
  const filteredConditions = existingConditions.filter((condition) => {
    if (!conditionSearch.trim()) return true;
    const search = conditionSearch.toLowerCase();
    return (
      condition.name.toLowerCase().includes(search) ||
      (condition.code && condition.code.toLowerCase().includes(search))
    );
  });

  // Handle condition selection
  const handleConditionSelect = (id: string | null) => {
    if (id === null) {
      setMode("new");
      setSelectedConditionId(null);
      setName("");
    } else {
      setMode("existing");
      setSelectedConditionId(id);
      const condition = existingConditions.find((c) => c.id === id);
      if (condition) {
        setName(condition.name);
      }
    }
    setConditionSearch("");
    setIsConditionOpen(false);
  };

  // Generate Google search URL for ICD code lookup
  const getGoogleSearchUrl = (conditionName: string) => {
    const searchQuery = encodeURIComponent(`${conditionName} ICD-10 code`);
    return `https://www.google.com/search?q=${searchQuery}`;
  };

  // Get the name to use for Google search (prefer original name, fallback to current input)
  const searchName =
    mode === "existing" && selectedCondition ? selectedCondition.name : name.trim();

  // Handle save
  const handleSave = async () => {
    const icdCodeTrimmed = icdCode.trim();
    const hasIcdCode = !!icdCodeTrimmed;
    const icdData = hasIcdCode
      ? {
          code: icdCodeTrimmed,
          icd_name_en: icdLookup?.found ? icdLookup.name_en : null,
          icd_name_ru: null,
        }
      : {};

    let payload: Parameters<typeof onSave>[0] | null = null;
    if (mode === "existing" && selectedConditionId) {
      payload = {
        condition_id: selectedConditionId,
        status_in_record: statusInRecord,
        source_anchor: sourceAnchor.trim() || null,
        ...icdData,
      };
    } else if (mode === "new" && name.trim()) {
      payload = {
        name: name.trim(),
        code: icdCodeTrimmed || null,
        icd_name_en: icdLookup?.found ? icdLookup.name_en : null,
        icd_name_ru: null,
        status_in_record: statusInRecord,
        source_anchor: sourceAnchor.trim() || null,
      };
    }
    if (!payload) return;

    setSaving(true);
    try {
      await Promise.resolve(onSave(payload));
    } finally {
      setSaving(false);
    }
  };

  // Display value for combobox
  const conditionDisplayValue = selectedCondition
    ? `${selectedCondition.name}${selectedCondition.code ? ` (${selectedCondition.code})` : ""}`
    : "";

  const canSave = mode === "existing" ? !!selectedConditionId : name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{isNew ? t("conditions.add") : t("conditions.edit")}</DialogTitle>
          <DialogDescription>
            {isNew ? t("conditions.addDescription") : t("conditions.editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Condition Selector (for new records or when editing) */}
          {isNew && existingConditions.length > 0 && (
            <div className="space-y-2">
              <Label>{t("conditions.selectOrCreate")}</Label>
              <div className="relative">
                <Popover open={isConditionOpen} onOpenChange={setIsConditionOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={isConditionOpen}
                      className={cn(
                        "h-10 w-full justify-between px-3 py-2 text-sm",
                        !conditionDisplayValue && "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">
                        {conditionDisplayValue || t("conditions.searchOrCreate")}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={conditionSearch}
                        onValueChange={setConditionSearch}
                        placeholder={t("conditions.searchOrCreate")}
                        autoFocus
                      />
                      <CommandList className="max-h-60">
                        <CommandGroup>
                          <CommandItem
                            value="__create__"
                            onSelect={() => handleConditionSelect(null)}
                            className={cn(mode === "new" && "bg-accent")}
                          >
                            <Plus className="h-4 w-4 shrink-0" />
                            <span className="text-muted-foreground italic">
                              {t("conditions.createNew")}
                            </span>
                          </CommandItem>
                        </CommandGroup>
                        {filteredConditions.length === 0 && conditionSearch ? (
                          <CommandEmpty>{t("conditions.noSearchResults")}</CommandEmpty>
                        ) : (
                          <CommandGroup>
                            {filteredConditions.map((condition) => (
                              <CommandItem
                                key={condition.id}
                                value={condition.id}
                                onSelect={() => handleConditionSelect(condition.id)}
                                className={cn(selectedConditionId === condition.id && "bg-accent")}
                              >
                                <Check
                                  className={`h-4 w-4 shrink-0 ${selectedConditionId === condition.id ? "opacity-100" : "opacity-0"}`}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="truncate">{condition.name}</div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {t(`conditions.status.${condition.current_status}`)}
                                    {condition.code && ` · ${condition.code}`}
                                  </div>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Condition Name (for new conditions) */}
          {(mode === "new" || !isNew) && (
            <div className="space-y-2">
              <Label htmlFor="name">{t("conditions.name")} *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("conditions.namePlaceholder")}
                disabled={mode === "existing" && isNew}
              />
            </div>
          )}

          {/* ICD-10 Code (for new conditions, existing without ICD, or when editing) */}
          {(mode === "new" ||
            (mode === "existing" && isNew && selectedCondition && !selectedCondition.code) ||
            (!isNew && conditionRecord)) && (
            <div className="space-y-2">
              <Label htmlFor="icdCode">{t("conditions.icdCode")}</Label>
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Input
                    id="icdCode"
                    value={icdCode}
                    onChange={(e) => setIcdCode(e.target.value.toUpperCase())}
                    placeholder="D50.9"
                    className="font-mono w-28 shrink-0"
                  />
                  {icdLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                  )}
                  {icdLookup?.found && <Check className="h-4 w-4 shrink-0 text-green-600" />}
                  {icdCode && !icdLoading && icdLookup && !icdLookup.found && (
                    <div className="flex items-center gap-1 text-yellow-600 shrink-0">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm">{t("conditions.icdNotFound")}</span>
                    </div>
                  )}
                </div>
                {icdLookup?.found && (
                  <p className="text-sm text-green-600 break-words min-w-0">{icdLookup.name_en}</p>
                )}
              </div>

              {/* Google search link to find ICD code */}
              {searchName && (
                <a
                  href={getGoogleSearchUrl(searchName)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("conditions.findIcdCode")}
                </a>
              )}
            </div>
          )}

          {/* Status in this record */}
          <div className="space-y-2">
            <Label>{t("conditions.statusInRecord")}</Label>
            <Select
              value={statusInRecord}
              onValueChange={(v) => setStatusInRecord(v as ConditionStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-orange-500" />
                    {t("conditions.status.active")}
                  </div>
                </SelectItem>
                <SelectItem value="suspected">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-3.5 w-3.5 text-yellow-500" />
                    {t("conditions.status.suspected")}
                  </div>
                </SelectItem>
                <SelectItem value="resolved">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    {t("conditions.status.resolved")}
                  </div>
                </SelectItem>
                <SelectItem value="history">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-gray-500" />
                    {t("conditions.status.history")}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Status tips toggle */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowStatusTips(!showStatusTips)}
              className="h-auto p-0 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-transparent"
            >
              <Info className="h-3.5 w-3.5" />
              <span>{t("conditions.statusTips.title")}</span>
              {showStatusTips ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>

            {/* Status tips content */}
            {showStatusTips && (
              <div className="rounded-md bg-muted/50 p-3 space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                  <span>{t("conditions.statusTips.active")}</span>
                </div>
                <div className="flex items-start gap-2">
                  <HelpCircle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                  <span>{t("conditions.statusTips.suspected")}</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  <span>{t("conditions.statusTips.resolved")}</span>
                </div>
                <div className="flex items-start gap-2">
                  <History className="h-3.5 w-3.5 text-gray-500 mt-0.5 shrink-0" />
                  <span>{t("conditions.statusTips.history")}</span>
                </div>
              </div>
            )}
          </div>

          {/* Source Anchor */}
          <div className="space-y-2">
            <Label htmlFor="sourceAnchor">{t("conditions.sourceAnchor")}</Label>
            <Textarea
              id="sourceAnchor"
              value={sourceAnchor}
              onChange={(e) => setSourceAnchor(e.target.value)}
              placeholder={t("conditions.sourceAnchorPlaceholder")}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("common.save")}
              </>
            ) : (
              t("common.save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

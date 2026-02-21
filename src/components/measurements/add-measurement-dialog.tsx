"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Loader2, Check, ChevronDown } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useMeasurementCatalog, useCreateMeasurement } from "@/hooks";
import type { MeasurementCategory, MeasurementCatalog } from "@/types";
import { MEASUREMENT_CATEGORY_LABELS } from "@/types";

interface AddMeasurementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string | null;
  preselectedCode?: string;
}

export function AddMeasurementDialog({
  open,
  onOpenChange,
  personId,
  preselectedCode,
}: AddMeasurementDialogProps) {
  const t = useTranslations();
  const [locale, setLocale] = useState("en");
  const [catalogId, setCatalogId] = useState("");
  const [value, setValue] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");
  const [notes, setNotes] = useState("");
  const [typeSearch, setTypeSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [popoverContainer, setPopoverContainer] = useState<HTMLElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dialogContentRef = useCallback((el: HTMLDivElement | null) => {
    setPopoverContainer(el);
  }, []);

  // Get locale from document
  useEffect(() => {
    const htmlLang = document.documentElement.lang || "en";
    setLocale(htmlLang);
  }, []);

  // Set default date/time to now
  useEffect(() => {
    if (open) {
      const now = new Date();
      setMeasuredAt(format(now, "yyyy-MM-dd'T'HH:mm"));
      setTypeSearch("");
      setDropdownOpen(false);
    }
  }, [open]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data: catalog, isLoading: catalogLoading } = useMeasurementCatalog();
  const createMutation = useCreateMeasurement();

  // Set preselected catalog item
  useEffect(() => {
    if (preselectedCode && catalog) {
      const item = catalog.find((c) => c.code === preselectedCode);
      if (item) {
        setCatalogId(item.id);
      }
    }
  }, [preselectedCode, catalog]);

  // Filter and group catalog by search
  const filteredGroupedCatalog = useMemo((): Record<MeasurementCategory, MeasurementCatalog[]> => {
    const emptyResult: Record<MeasurementCategory, MeasurementCatalog[]> = {
      basic: [],
      body: [],
      limbs: [],
      vital: [],
    };

    if (!catalog) return emptyResult;

    const searchLower = typeSearch.toLowerCase().trim();
    const filtered = searchLower
      ? catalog.filter(
          (item) =>
            item.name_ru.toLowerCase().includes(searchLower) ||
            item.name_en.toLowerCase().includes(searchLower) ||
            item.code.toLowerCase().includes(searchLower),
        )
      : catalog;

    return filtered.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    }, emptyResult);
  }, [catalog, typeSearch]);

  const selectedCatalogItem = catalog?.find((c) => c.id === catalogId);
  const displayUnit = locale === "ru" ? selectedCatalogItem?.unit_ru : selectedCatalogItem?.unit_en;
  const selectedDisplayName = selectedCatalogItem
    ? locale === "ru"
      ? selectedCatalogItem.name_ru
      : selectedCatalogItem.name_en
    : null;

  const handleSelectType = (item: MeasurementCatalog) => {
    setCatalogId(item.id);
    setDropdownOpen(false);
    setTypeSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!personId || !catalogId || !value) return;

    try {
      await createMutation.mutateAsync({
        person_id: personId,
        catalog_id: catalogId,
        value: parseFloat(value),
        measured_at: new Date(measuredAt).toISOString(),
        notes: notes.trim() || null,
      });

      // Reset form and close
      setCatalogId(preselectedCode ? catalogId : "");
      setValue("");
      setNotes("");
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to create measurement:", error);
    }
  };

  const handleClose = () => {
    setCatalogId(preselectedCode ? catalogId : "");
    setValue("");
    setNotes("");
    setTypeSearch("");
    setDropdownOpen(false);
    onOpenChange(false);
  };

  const hasResults = Object.values(filteredGroupedCatalog).some(
    (items) => items && items.length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <div ref={dialogContentRef}>
          <DialogHeader>
            <DialogTitle>{t("measurements.addMeasurement")}</DialogTitle>
            <DialogDescription>{t("measurements.addDescription")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Measurement type selector with search */}
            <div className="space-y-2">
              <Label>{t("measurements.selectType")}</Label>
              <div className="relative" ref={dropdownRef}>
                <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={dropdownOpen}
                      disabled={!!preselectedCode}
                      className={cn(
                        "tap-target h-10 w-full justify-between px-3 py-2 text-sm ring-offset-background",
                        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        !selectedDisplayName && "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">
                        {selectedDisplayName || t("measurements.selectTypePlaceholder")}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[80] w-[--radix-popover-trigger-width] p-0"
                    align="start"
                    container={popoverContainer}
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={typeSearch}
                        onValueChange={setTypeSearch}
                        placeholder={t("measurements.searchPlaceholder")}
                        autoFocus
                      />
                      <CommandList className="max-h-60">
                        {catalogLoading ? (
                          <div className="p-4 text-center">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          </div>
                        ) : !hasResults ? (
                          <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                        ) : (
                          Object.entries(filteredGroupedCatalog).map(([category, items]) => {
                            if (!items || items.length === 0) return null;
                            const categoryLabel =
                              MEASUREMENT_CATEGORY_LABELS[category as MeasurementCategory];
                            return (
                              <CommandGroup
                                key={category}
                                heading={locale === "ru" ? categoryLabel.ru : categoryLabel.en}
                              >
                                {items.map((item) => (
                                  <CommandItem
                                    key={item.id}
                                    value={item.id}
                                    onSelect={() => handleSelectType(item)}
                                    className={cn(
                                      "tap-target gap-2",
                                      catalogId === item.id && "bg-accent",
                                    )}
                                  >
                                    <Check
                                      className={cn(
                                        "h-4 w-4",
                                        catalogId === item.id ? "opacity-100" : "opacity-0",
                                      )}
                                    />
                                    <span className="flex-1 text-left">
                                      {locale === "ru" ? item.name_ru : item.name_en}
                                    </span>
                                    {item.unit_en && (
                                      <span className="text-muted-foreground text-xs">
                                        {locale === "ru" ? item.unit_ru : item.unit_en}
                                      </span>
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            );
                          })
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Value input */}
            <div className="space-y-2">
              <Label htmlFor="value">{t("measurements.value")}</Label>
              <div className="flex gap-2">
                <Input
                  id="value"
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
              <Label htmlFor="measuredAt">{t("measurements.measuredAt")}</Label>
              <Input
                id="measuredAt"
                type="datetime-local"
                value={measuredAt}
                onChange={(e) => setMeasuredAt(e.target.value)}
                required
              />
            </div>

            {/* Notes input */}
            <div className="space-y-2">
              <Label htmlFor="notes">{t("measurements.notes")}</Label>
              <Textarea
                id="notes"
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
              <Button type="submit" disabled={!catalogId || !value || createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

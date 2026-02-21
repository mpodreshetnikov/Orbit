"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, Plus, Pencil, Trash2, X, Ruler, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MeasurementCatalogEditDialog } from "./measurement-catalog-edit-dialog";
import { useMeasurementCatalog, useDeleteMeasurementCatalogItem } from "@/hooks";
import type { MeasurementCatalog, MeasurementCategory } from "@/types";
import { MEASUREMENT_CATEGORY_LABELS } from "@/types";

export function MeasurementCatalogList() {
  const t = useTranslations();
  const [locale, setLocale] = useState("en");

  // Get locale from document
  useEffect(() => {
    const htmlLang = document.documentElement.lang || "en";
    setLocale(htmlLang);
  }, []);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedMeasurement, setSelectedMeasurement] = useState<MeasurementCatalog | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [measurementToDelete, setMeasurementToDelete] = useState<MeasurementCatalog | null>(null);

  // Data
  const { data: measurements, isLoading, error } = useMeasurementCatalog(debouncedSearch);
  const deleteMutation = useDeleteMeasurementCatalogItem();

  // Group by category
  const groupedMeasurements = measurements?.reduce(
    (acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<MeasurementCategory, MeasurementCatalog[]>,
  );

  // Handlers
  const handleAdd = () => {
    setSelectedMeasurement(null);
    setEditDialogOpen(true);
  };

  const handleEdit = (measurement: MeasurementCatalog) => {
    setSelectedMeasurement(measurement);
    setEditDialogOpen(true);
  };

  const handleDelete = (measurement: MeasurementCatalog) => {
    setMeasurementToDelete(measurement);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (measurementToDelete) {
      await deleteMutation.mutateAsync(measurementToDelete.id);
      setMeasurementToDelete(null);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/health/catalogs">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("catalogs.measurements")}</h1>
            <p className="text-muted-foreground">{t("catalogs.measurementsDescription")}</p>
          </div>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          {t("catalogs.addMeasurement")}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("catalogs.searchMeasurements")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
        {searchQuery && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      )}

      {/* Measurements grouped by category */}
      {!isLoading &&
        !error &&
        groupedMeasurements &&
        Object.keys(groupedMeasurements).length > 0 && (
          <div className="space-y-8">
            {Object.entries(groupedMeasurements).map(([category, items]) => {
              if (!items || items.length === 0) return null;
              const categoryLabel = MEASUREMENT_CATEGORY_LABELS[category as MeasurementCategory];
              return (
                <div key={category}>
                  <h2 className="text-lg font-semibold mb-4">
                    {locale === "ru" ? categoryLabel.ru : categoryLabel.en}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((m) => (
                      <Card key={m.id} className="group relative">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <Ruler className="h-5 w-5 text-primary" />
                              <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">
                                {m.code}
                              </code>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEdit(m)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(m)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <CardTitle className="text-base">{m.name_en}</CardTitle>
                          <CardDescription>{m.name_ru}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">{t("catalogs.unit")}:</span>
                            <Badge variant="outline">
                              {locale === "ru" ? m.unit_ru : m.unit_en}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Empty state */}
      {!isLoading && !error && measurements && measurements.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Ruler className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">
            {searchQuery ? t("common.noResults") : t("catalogs.noMeasurements")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {searchQuery ? t("catalogs.noSearchResults") : t("catalogs.noMeasurementsDescription")}
          </p>
          {!searchQuery && (
            <Button className="mt-4" onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              {t("catalogs.addMeasurement")}
            </Button>
          )}
        </div>
      )}

      {/* Edit/Create Dialog */}
      <MeasurementCatalogEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        measurement={selectedMeasurement}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("catalogs.deleteMeasurement")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("catalogs.deleteMeasurementMessage", {
                code: measurementToDelete?.code ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

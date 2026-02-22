"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, Plus, Pencil, Trash2, X, FlaskConical, ChevronLeft } from "lucide-react";
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
import { ObservationEditDialog } from "./observation-edit-dialog";
import { useObservationCatalog, useDeleteObservation } from "@/hooks";
import type { ObservationCatalog } from "@/types";

export function ObservationCatalogList() {
  const t = useTranslations();

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
  const [selectedObservation, setSelectedObservation] = useState<ObservationCatalog | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [observationToDelete, setObservationToDelete] = useState<ObservationCatalog | null>(null);

  // Data
  const { data: observations, isLoading, error } = useObservationCatalog(debouncedSearch);
  const deleteMutation = useDeleteObservation();

  // Handlers
  const handleAdd = () => {
    setSelectedObservation(null);
    setEditDialogOpen(true);
  };

  const handleEdit = (observation: ObservationCatalog) => {
    setSelectedObservation(observation);
    setEditDialogOpen(true);
  };

  const handleDelete = (observation: ObservationCatalog) => {
    setObservationToDelete(observation);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (observationToDelete) {
      await deleteMutation.mutateAsync(observationToDelete.id);
      setObservationToDelete(null);
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
            <h1 className="text-2xl font-bold tracking-tight">{t("catalogs.observations")}</h1>
            <p className="text-muted-foreground">{t("catalogs.observationsDescription")}</p>
          </div>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          {t("catalogs.addObservation")}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("catalogs.searchObservations")}
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
            <Skeleton key={i} className="h-48" />
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

      {/* Observations grid */}
      {!isLoading && !error && observations && observations.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {observations.map((obs) => (
            <Card key={obs.id} className="group relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-5 w-5 text-primary" />
                    <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">
                      {obs.obs_code}
                    </code>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(obs)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(obs)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardTitle className="text-base">{obs.name_en}</CardTitle>
                <CardDescription>{obs.name_ru}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Canonical unit */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t("catalogs.unit")}:</span>
                  <Badge variant="outline">{obs.canonical_unit}</Badge>
                </div>

                {/* Reference range */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t("catalogs.refRange")}:</span>
                  {obs.default_ref_low !== null || obs.default_ref_high !== null ? (
                    <span className="font-mono">
                      {obs.default_ref_low ?? "—"} – {obs.default_ref_high ?? "—"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50 italic">{t("catalogs.notSet")}</span>
                  )}
                </div>

                {/* Accepted units count */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t("catalogs.acceptedUnits")}:</span>
                  <span>{Object.keys(obs.accepted_units || {}).length}</span>
                </div>

                {/* Synonyms preview */}
                {(obs.synonyms_en.length > 0 || obs.synonyms_ru.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {obs.synonyms_en.slice(0, 3).map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                    {obs.synonyms_en.length + obs.synonyms_ru.length > 3 && (
                      <Badge variant="secondary" className="text-xs">
                        +{obs.synonyms_en.length + obs.synonyms_ru.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && observations && observations.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <FlaskConical className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">
            {searchQuery ? t("common.noResults") : t("catalogs.noObservations")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {searchQuery ? t("catalogs.noSearchResults") : t("catalogs.noObservationsDescription")}
          </p>
          {!searchQuery && (
            <Button className="mt-4" onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              {t("catalogs.addObservation")}
            </Button>
          )}
        </div>
      )}

      {/* Edit/Create Dialog */}
      <ObservationEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        observation={selectedObservation}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("catalogs.deleteObservation")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("catalogs.deleteObservationMessage", {
                code: observationToDelete?.obs_code ?? "",
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

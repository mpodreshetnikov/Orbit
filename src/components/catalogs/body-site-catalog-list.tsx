"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, Plus, Pencil, Trash2, ChevronLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { BodySiteEditDialog } from "./body-site-edit-dialog";
import { useBodySiteCatalog, useDeleteBodySite } from "@/hooks";
import type { BodySiteCatalog } from "@/types";

export function BodySiteCatalogList() {
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
  const [selectedBodySite, setSelectedBodySite] = useState<BodySiteCatalog | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bodySiteToDelete, setBodySiteToDelete] = useState<BodySiteCatalog | null>(null);

  // Data
  const { data: bodySites, isLoading, error } = useBodySiteCatalog();
  const deleteMutation = useDeleteBodySite();

  // Filter by search
  const filteredItems = bodySites?.filter(item => {
    if (!debouncedSearch.trim()) return true;
    const search = debouncedSearch.toLowerCase();
    return (
      item.site_code.toLowerCase().includes(search) ||
      item.name_ru.toLowerCase().includes(search) ||
      item.name_en.toLowerCase().includes(search) ||
      item.synonyms_ru?.some(s => s.toLowerCase().includes(search)) ||
      item.synonyms_en?.some(s => s.toLowerCase().includes(search))
    );
  });

  // Handlers
  const handleAdd = () => {
    setSelectedBodySite(null);
    setEditDialogOpen(true);
  };

  const handleEdit = (bodySite: BodySiteCatalog) => {
    setSelectedBodySite(bodySite);
    setEditDialogOpen(true);
  };

  const handleDelete = (bodySite: BodySiteCatalog) => {
    setBodySiteToDelete(bodySite);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (bodySiteToDelete) {
      await deleteMutation.mutateAsync(bodySiteToDelete.id);
      setBodySiteToDelete(null);
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
            <h1 className="text-2xl font-bold tracking-tight">
              {t("catalogs.bodySites")}
            </h1>
            <p className="text-muted-foreground">
              {t("catalogs.bodySitesDescription")}
            </p>
          </div>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          {t("catalogs.add")}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("catalogs.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">{t("common.error")}</p>
          </CardContent>
        </Card>
      ) : filteredItems && filteredItems.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <Card key={item.id} className="relative group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base">{item.name_ru}</CardTitle>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(item)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  <code className="text-xs">{item.site_code}</code>
                  <span className="mx-2">•</span>
                  {item.name_en}
                  {item.parent_site_code && (
                    <>
                      <span className="mx-2">•</span>
                      <span className="text-xs">↳ {item.parent_site_code}</span>
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(item.synonyms_ru?.length > 0 || item.synonyms_en?.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {item.synonyms_ru?.slice(0, 3).map((syn, i) => (
                      <Badge key={`ru-${i}`} variant="secondary" className="text-xs">
                        {syn}
                      </Badge>
                    ))}
                    {(item.synonyms_ru?.length || 0) > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{(item.synonyms_ru?.length || 0) - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {debouncedSearch ? t("catalogs.noSearchResults") : t("catalogs.noItems")}
          </CardContent>
        </Card>
      )}

      {/* Edit/Add Dialog */}
      <BodySiteEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        bodySite={selectedBodySite}
        allSites={bodySites || []}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("catalogs.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("catalogs.deleteDescription", {
                name: bodySiteToDelete?.name_ru ?? "",
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

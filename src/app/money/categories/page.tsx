"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TreeView, type TreeDataItem, type TreeRenderItemParams } from "@/components/tree-view";
import {
  buildMoneyCategoryTree,
  flattenMoneyCategoryTree,
  useCreateMoneyCategory,
  useDeleteMoneyCategory,
  useMoneyCategories,
  useUpdateMoneyCategory,
} from "@/hooks";
import type { MoneyCategoryTreeNode } from "@/hooks";
import type { MoneyCategory } from "@/types";
import { cn } from "@/lib/utils";

export default function MoneyCategoriesPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();

  const { data: categories, isLoading } = useMoneyCategories();
  const createMutation = useCreateMoneyCategory();
  const updateMutation = useUpdateMoneyCategory();
  const deleteMutation = useDeleteMoneyCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MoneyCategory | null>(null);

  const [nameEn, setNameEn] = useState("");
  const [nameRu, setNameRu] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);

  const tree = useMemo(() => buildMoneyCategoryTree(categories || []), [categories]);
  const flattened = useMemo(() => flattenMoneyCategoryTree(tree), [tree]);

  const categoryById = useMemo(() => {
    const map = new Map<string, MoneyCategory>();
    (categories || []).forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  const treeData = useMemo((): TreeDataItem[] => {
    function mapNode(node: MoneyCategoryTreeNode): TreeDataItem {
      return {
        id: node.id,
        name: node.name_en,
        children: node.children.length > 0 ? node.children.map(mapNode) : undefined,
      };
    }
    return tree.map(mapNode);
  }, [tree]);

  const openNew = useCallback(() => {
    setEditing(null);
    setNameEn("");
    setNameRu("");
    setSlug("");
    setParentId(null);
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    if (searchParams?.get("new") === "1") {
      openNew();
    }
  }, [searchParams, openNew]);

  const openEdit = useCallback((category: MoneyCategory) => {
    setEditing(category);
    setNameEn(category.name_en);
    setNameRu(category.name_ru);
    setSlug(category.slug);
    setParentId(category.parent_id);
    setDialogOpen(true);
  }, []);

  const openNewWithParent = useCallback(
    (parentCategory: MoneyCategory) => {
      if (parentCategory.depth >= 4) {
        toast.error(t("money.categoryDepthLimit"));
        return;
      }
      setEditing(null);
      setNameEn("");
      setNameRu("");
      setSlug("");
      setParentId(parentCategory.id);
      setDialogOpen(true);
    },
    [t],
  );

  const renderTreeItem = useCallback(
    (params: TreeRenderItemParams) => {
      const category = categoryById.get(params.item.id);
      if (!category) return <span className="text-sm truncate">{params.item.name}</span>;
      const canAddChild = category.depth < 4;
      return (
        <div className="flex flex-1 items-center min-w-0 w-full relative pr-[7.5rem]">
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium truncate block text-left">{category.name_en}</span>
            <span className="text-xs text-muted-foreground truncate block text-left">
              {category.name_ru}
            </span>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
            {category.slug}
          </span>
          <div
            className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {canAddChild && (
              <span
                role="button"
                tabIndex={0}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon" }),
                  "h-8 w-8 cursor-pointer",
                )}
                onClick={() => openNewWithParent(category)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openNewWithParent(category);
                  }
                }}
                aria-label={t("money.addCategory")}
              >
                <Plus className="h-4 w-4" />
              </span>
            )}
            <span
              role="button"
              tabIndex={0}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-8 w-8 cursor-pointer",
              )}
              onClick={() => openEdit(category)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openEdit(category);
                }
              }}
              aria-label={t("common.edit")}
            >
              <Pencil className="h-4 w-4" />
            </span>
            <span
              role="button"
              tabIndex={0}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-8 w-8 cursor-pointer text-destructive hover:bg-destructive/15 hover:text-destructive",
              )}
              onClick={() => setDeleteTarget(category)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDeleteTarget(category);
                }
              }}
              aria-label={t("common.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </span>
          </div>
        </div>
      );
    },
    [categoryById, t, openEdit, openNewWithParent, setDeleteTarget],
  );

  const handleSave = async () => {
    if (!nameEn.trim() || !nameRu.trim() || !slug.trim()) {
      toast.error(t("money.validationCategoryRequired"));
      return;
    }

    const parent = (categories || []).find((c) => c.id === parentId) || null;
    const depth = parent ? parent.depth + 1 : 1;

    if (depth > 4) {
      toast.error(t("money.categoryDepthLimit"));
      return;
    }

    if (editing) {
      await updateMutation.mutateAsync({
        id: editing.id,
        updates: {
          parent_id: parentId,
          depth,
          name_en: nameEn.trim(),
          name_ru: nameRu.trim(),
          slug: slug.trim(),
        },
      });
    } else {
      await createMutation.mutateAsync({
        parent_id: parentId,
        depth,
        name_en: nameEn.trim(),
        name_ru: nameRu.trim(),
        slug: slug.trim(),
      });
    }

    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const hasChildren = (categories || []).some((cat) => cat.parent_id === deleteTarget.id);
    if (hasChildren) {
      toast.error(t("money.cannotDeleteCategory"));
      setDeleteTarget(null);
      return;
    }
    await deleteMutation.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const parentOptions = flattened.filter((cat) => cat.depth < 4 && cat.id !== editing?.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("money.categories")}</h1>
        <Button size="sm" onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("money.addCategory")}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !categories || categories.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p className="font-medium">{t("money.noCategories")}</p>
          <p className="text-sm mt-1">{t("money.noCategoriesHint")}</p>
          <Button size="sm" className="mt-3" onClick={openNew}>
            {t("money.addCategory")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <TreeView data={treeData} renderItem={renderTreeItem} className="p-2" />
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("money.editCategory") : t("money.addCategory")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.categoryNameEn")}</label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.categoryNameRu")}</label>
              <Input value={nameRu} onChange={(e) => setNameRu(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.categorySlug")}</label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.categoryParent")}</label>
              <Select
                value={parentId ?? "none"}
                onValueChange={(value) => setParentId(value === "none" ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("money.categoryParent")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("money.categoryRoot")}</SelectItem>
                  {parentOptions.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("money.deleteCategoryConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

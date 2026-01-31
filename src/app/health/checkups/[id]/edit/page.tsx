"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckupForm } from "@/components/checkups";
import {
  useCheckupItem,
  useUpdateCheckupItem,
  usePersonConditions,
} from "@/hooks";
import type { UpdateCheckupItemInput } from "@/types";

export default function EditCheckupPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations();
  const id = params.id as string;

  const { data: item, isLoading, error } = useCheckupItem(id);
  const updateMutation = useUpdateCheckupItem();
  const { data: conditions } = usePersonConditions(item?.person_id ?? null);

  const handleSubmit = async (updates: UpdateCheckupItemInput) => {
    if (!item) return;
    await updateMutation.mutateAsync({ id: item.id, updates });
    router.push(`/health/checkups/${item.id}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 max-w-md" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/health/checkups">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("common.back")}
          </Link>
        </Button>
        <p className="text-destructive">{t("common.error")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href={`/health/checkups/${item.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Pencil className="h-5 w-5" />
          {t("checkups.edit")}
        </h1>
      </div>

      <div className="max-w-md">
        <CheckupForm
          mode="edit"
          initial={item}
          personId={item.person_id}
          conditions={conditions ?? []}
          onSubmit={handleSubmit}
          isPending={updateMutation.isPending}
          onCancel={() => router.push(`/health/checkups/${item.id}`)}
        />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckupForm } from "@/components/checkups";
import { useCreateCheckupItem, usePersonConditions } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";

export default function NewCheckupPage() {
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const createMutation = useCreateCheckupItem();
  const { data: conditions } = usePersonConditions(selectedPersonId);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  const handleSubmit = async (
    data: import("@/types").CreateCheckupItemInput | import("@/types").UpdateCheckupItemInput,
  ) => {
    const item = await createMutation.mutateAsync(data as import("@/types").CreateCheckupItemInput);
    router.push(`/health/checkups/${item.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/health/checkups">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t("checkups.add")}</h1>
      </div>

      <div className="max-w-md">
        <CheckupForm
          mode="create"
          personId={selectedPersonId}
          conditions={conditions ?? []}
          onSubmit={handleSubmit}
          isPending={createMutation.isPending}
          onCancel={() => router.push("/health/checkups")}
        />
      </div>
    </div>
  );
}

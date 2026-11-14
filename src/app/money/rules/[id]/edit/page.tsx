"use client";

import React, { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { MoneyRuleEditor } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMoneyCategoryRules } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";

export default function EditMoneyRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const searchParams = useSearchParams();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: rules, isLoading } = useMoneyCategoryRules(selectedPersonId);
  const rule = rules?.find((item) => item.id === id) ?? null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full max-w-xl" />
        <Skeleton className="h-[720px] w-full" />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/money/rules">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("common.back")}
          </Link>
        </Button>
        <p className="text-sm text-destructive">{t("common.error")}</p>
      </div>
    );
  }

  return (
    <MoneyRuleEditor
      mode="edit"
      rule={rule}
      initialExampleTransactionId={searchParams.get("exampleTransactionId")}
      initialExampleLineItemId={searchParams.get("exampleLineItemId")}
      autoRunExample={searchParams.get("autorun") === "1"}
    />
  );
}

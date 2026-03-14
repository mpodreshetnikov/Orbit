"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyRuleEditor } from "@/components/money";

export default function NewMoneyRulePage() {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/money/rules">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Plus className="h-5 w-5" />
          {t("money.addRule")}
        </h1>
      </div>

      <MoneyRuleEditor mode="create" />
    </div>
  );
}

"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowRight, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useDeleteMoneyCategoryRule,
  useMoneyCategories,
  useMoneyCategoryRules,
  usePersons,
  useReorderMoneyCategoryRules,
} from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import { movedRuleIds, ruleCategoryLabel, ruleSummary } from "@/types/money-rules";

export default function MoneyRulesPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: persons } = usePersons();
  const { data: categories } = useMoneyCategories();
  const { data: rules, isLoading } = useMoneyCategoryRules(selectedPersonId);
  const deleteRuleMutation = useDeleteMoneyCategoryRule();
  const reorderRuleMutation = useReorderMoneyCategoryRules();

  const orderedRules = rules ?? [];
  const selectedPerson = useMemo(
    () => persons?.find((person) => person.id === selectedPersonId) ?? null,
    [persons, selectedPersonId],
  );

  const categoryNameById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, ruleCategoryLabel(category)])),
    [categories],
  );

  const isMutating = deleteRuleMutation.isPending || reorderRuleMutation.isPending;

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedPersonId) return;
    if (!window.confirm(t("money.ruleDeleteConfirm"))) return;

    try {
      await deleteRuleMutation.mutateAsync({ id: ruleId, personId: selectedPersonId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    }
  };

  const handleMoveRule = async (ruleId: string, direction: "up" | "down") => {
    if (!selectedPersonId) return;
    const orderedRuleIds = movedRuleIds(orderedRules, ruleId, direction);
    if (!orderedRuleIds) return;

    try {
      await reorderRuleMutation.mutateAsync({
        personId: selectedPersonId,
        orderedRuleIds,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    }
  };

  if (!selectedPersonId) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t("money.rules")}</h1>
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          <p>{t("person.selectPrompt")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{t("money.rules")}</h1>
          <p className="text-sm text-muted-foreground">
            {selectedPerson ? selectedPerson.name : t("person.selectPrompt")}
          </p>
        </div>
        <Button asChild className="gap-2 self-start md:self-auto">
          <Link href="/money/rules/new">
            <Plus className="h-4 w-4" />
            {t("money.addRule")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                {t("common.loading")}
              </CardContent>
            </Card>
          ) : orderedRules.length === 0 ? (
            <Card>
              <CardContent className="space-y-2 p-6 text-center">
                <p className="font-medium">{t("money.noRules")}</p>
                <p className="text-sm text-muted-foreground">{t("money.noRulesHint")}</p>
              </CardContent>
            </Card>
          ) : (
            orderedRules.map((rule, index) => (
              <Card key={rule.id}>
                <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{rule.name}</span>
                      <Badge variant="outline">{t(`money.ruleKind${rule.rule_kind}`)}</Badge>
                      <Badge variant={rule.enabled ? "default" : "secondary"}>
                        {rule.enabled ? t("money.ruleEnabled") : t("money.ruleDisabled")}
                      </Badge>
                    </div>
                    {rule.description ? (
                      <p className="text-sm text-muted-foreground">{rule.description}</p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      {ruleSummary(rule, t, categoryNameById)}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{t(`money.ruleScope${rule.scope_filter}`)}</span>
                      <span>{t(`money.ruleMatch${rule.match_mode}`)}</span>
                      {rule.target_category_id ? (
                        <span>{categoryNameById.get(rule.target_category_id)}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t("money.ruleMoveUp")}
                      disabled={index === 0 || isMutating}
                      onClick={() => void handleMoveRule(rule.id, "up")}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t("money.ruleMoveDown")}
                      disabled={index === orderedRules.length - 1 || isMutating}
                      onClick={() => void handleMoveRule(rule.id, "down")}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link href={`/money/rules/${rule.id}/edit`}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t("common.edit")}
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      aria-label={t("common.delete")}
                      onClick={() => void handleDeleteRule(rule.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>{t("money.ruleReplayReviewTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("money.ruleReplayReviewIndexHint")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("money.ruleQuickActionsHint")}</p>
            <Button asChild className="gap-2">
              <Link href="/money/rules/replay-review">
                {t("money.ruleOpenReplayReview")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

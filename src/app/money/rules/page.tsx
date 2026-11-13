"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowRight, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDeleteMoneyCategoryRule,
  useMoneyCategories,
  useMoneyCategoryRules,
  usePersons,
  useReorderMoneyCategoryRules,
} from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import {
  movedRuleIds,
  resolveRuleLlmProvider,
  ruleCategoryLabel,
  ruleSummary,
} from "@/types/money-rules";
import type { MoneyCategoryRule } from "@/types/money";
import { cn } from "@/lib/utils";

function ruleResultLabel(
  rule: MoneyCategoryRule,
  t: (key: string) => string,
  categoryNameById: Map<string, string>,
): string {
  switch (rule.rule_kind) {
    case "direct":
      return rule.target_category_id
        ? (categoryNameById.get(rule.target_category_id) ?? t("money.ruleResultCategory"))
        : t("money.ruleResultCategory");
    case "llm_categorization":
      return t("money.ruleResultAskAi");
    case "mcc_map":
      return t("money.ruleResultByMcc");
    case "source_category_map":
      return t("money.ruleResultByBank");
    case "fallback_uncategorized":
      return t("money.ruleResultFallback");
    default:
      return t("money.ruleResultCategory");
  }
}

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("money.rules")}</h1>
        <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          <p>{t("person.selectPrompt")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("money.rules")}</h1>
          <p className="text-sm text-muted-foreground">
            {selectedPerson ? selectedPerson.name : t("person.selectPrompt")}
            {!isLoading ? (
              <>
                {" · "}
                {t("money.rulesCountSimple", { count: orderedRules.length })}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/money/rules/replay-review">
              {t("money.ruleOpenReplayReview")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/money/rules/new">
              <Plus className="h-4 w-4" />
              {t("money.addRule")}
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : orderedRules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-muted/20 px-6 py-14 text-center">
          <p className="text-base font-medium">{t("money.noRules")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("money.noRulesHint")}</p>
          <Button asChild className="mt-2 gap-2">
            <Link href="/money/rules/new">
              <Plus className="h-4 w-4" />
              {t("money.addRule")}
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {orderedRules.map((rule, index) => {
            const provider = resolveRuleLlmProvider(rule.config);
            const condition =
              rule.filters.length === 0
                ? t("money.ruleAppliesAlways")
                : ruleSummary(rule, t, categoryNameById);
            const result = ruleResultLabel(rule, t, categoryNameById);
            const muted = !rule.enabled;

            return (
              <li
                key={rule.id}
                className={cn(
                  "rounded-2xl border bg-card p-4 transition-opacity",
                  muted && "opacity-60",
                )}
              >
                <div className="flex gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums text-muted-foreground"
                    aria-label={`${t("money.rulePriority")} ${index + 1}`}
                  >
                    {index + 1}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-medium">{rule.name}</span>
                          <Badge variant="secondary" className="font-normal">
                            {t(`money.ruleKind${rule.rule_kind}`)}
                          </Badge>
                          {rule.rule_kind === "llm_categorization" ? (
                            <Badge variant="outline" className="font-normal">
                              {provider === "jev"
                                ? t("money.ruleAiProviderChipJev")
                                : t("money.ruleAiProviderChipOpenRouter")}
                            </Badge>
                          ) : null}
                          <span
                            className={cn(
                              "text-xs",
                              rule.enabled
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {rule.enabled ? t("money.ruleEnabled") : t("money.ruleDisabled")}
                          </span>
                        </div>

                        {rule.description ? (
                          <p className="text-sm text-muted-foreground">{rule.description}</p>
                        ) : null}

                        <p className="text-sm leading-relaxed text-muted-foreground">
                          <span className="text-foreground/80">{condition}</span>
                          <span aria-hidden="true" className="mx-1.5 text-muted-foreground/70">
                            {" → "}
                          </span>
                          <span className="font-medium text-foreground">{result}</span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("money.ruleMoveUp")}
                          disabled={index === 0 || isMutating}
                          onClick={() => void handleMoveRule(rule.id, "up")}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("money.ruleMoveDown")}
                          disabled={index === orderedRules.length - 1 || isMutating}
                          onClick={() => void handleMoveRule(rule.id, "down")}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          asChild
                        >
                          <Link href={`/money/rules/${rule.id}/edit`} aria-label={t("common.edit")}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          aria-label={t("common.delete")}
                          onClick={() => void handleDeleteRule(rule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

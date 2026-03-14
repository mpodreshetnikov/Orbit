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
import type { MoneyCategoryRule } from "@/types";

const FILTER_FIELD_OPTIONS: { value: string; labelKey: string; fallbackLabel: string }[] = [
  {
    value: "line_item_title",
    labelKey: "money.ruleFieldLineItemTitle",
    fallbackLabel: "Line-item title",
  },
  {
    value: "merchant_name",
    labelKey: "money.ruleFieldMerchantName",
    fallbackLabel: "Merchant name",
  },
  {
    value: "transaction_comment",
    labelKey: "money.ruleFieldTransactionComment",
    fallbackLabel: "Transaction comment",
  },
  {
    value: "source_comment",
    labelKey: "money.ruleFieldSourceComment",
    fallbackLabel: "Source comment",
  },
  { value: "source", labelKey: "money.ruleFieldSource", fallbackLabel: "Source" },
  {
    value: "source_category_id",
    labelKey: "money.ruleFieldSourceCategoryId",
    fallbackLabel: "Source category id",
  },
  {
    value: "source_category_name",
    labelKey: "money.ruleFieldSourceCategoryName",
    fallbackLabel: "Source category name",
  },
  { value: "mcc", labelKey: "money.ruleFieldMcc", fallbackLabel: "MCC" },
  {
    value: "transaction_type",
    labelKey: "money.ruleFieldTransactionType",
    fallbackLabel: "Transaction type",
  },
  {
    value: "account_source",
    labelKey: "money.ruleFieldAccountSource",
    fallbackLabel: "Account source",
  },
  { value: "account_kind", labelKey: "money.ruleFieldAccountKind", fallbackLabel: "Account kind" },
  {
    value: "payer_person_id",
    labelKey: "money.ruleFieldPayerPerson",
    fallbackLabel: "Payer person",
  },
  {
    value: "line_item_amount",
    labelKey: "money.ruleFieldLineItemAmount",
    fallbackLabel: "Line-item amount",
  },
  {
    value: "transaction_amount",
    labelKey: "money.ruleFieldTransactionAmount",
    fallbackLabel: "Transaction amount",
  },
  {
    value: "current_category_id",
    labelKey: "money.ruleFieldCurrentCategory",
    fallbackLabel: "Current category",
  },
  {
    value: "canonical_branch_system_key",
    labelKey: "money.ruleFieldCanonicalBranch",
    fallbackLabel: "Canonical branch",
  },
  { value: "is_transfer", labelKey: "money.ruleFieldTransferFlag", fallbackLabel: "Transfer flag" },
];

const FILTER_OPERATOR_OPTIONS: { value: string; labelKey: string; fallbackLabel: string }[] = [
  { value: "contains", labelKey: "money.ruleOperatorContains", fallbackLabel: "contains" },
  {
    value: "not_contains",
    labelKey: "money.ruleOperatorNotContains",
    fallbackLabel: "does not contain",
  },
  { value: "equals", labelKey: "money.ruleOperatorEquals", fallbackLabel: "equals" },
  { value: "starts_with", labelKey: "money.ruleOperatorStartsWith", fallbackLabel: "starts with" },
  { value: "regex", labelKey: "money.ruleOperatorRegex", fallbackLabel: "matches regex" },
  {
    value: "contains_any_in_set",
    labelKey: "money.ruleOperatorContainsAnyOfSet",
    fallbackLabel: "contains any of set",
  },
  {
    value: "equals_any_in_set",
    labelKey: "money.ruleOperatorEqualsAnyOfSet",
    fallbackLabel: "equals any of set",
  },
  {
    value: "in_set",
    labelKey: "money.ruleOperatorEqualsAnyOfSet",
    fallbackLabel: "equals any of set",
  },
  { value: "range", labelKey: "money.ruleOperatorRange", fallbackLabel: "is between" },
  { value: "is_empty", labelKey: "money.ruleOperatorIsEmpty", fallbackLabel: "is empty" },
  {
    value: "is_not_empty",
    labelKey: "money.ruleOperatorIsNotEmpty",
    fallbackLabel: "is not empty",
  },
];

function resolveSummaryLabel(t: (key: string) => string, labelKey: string, fallbackLabel: string) {
  const translated = t(labelKey);
  return translated === labelKey ? fallbackLabel : translated;
}

function formatRuleSummary(
  rule: MoneyCategoryRule,
  t: (key: string) => string,
  categoryNameById: Map<string, string>,
) {
  if (!rule.filters.length) {
    return t("money.ruleSummaryNoFilters");
  }

  const fieldLabelByValue = new Map(
    FILTER_FIELD_OPTIONS.map((option) => [
      option.value,
      resolveSummaryLabel(t, option.labelKey, option.fallbackLabel),
    ]),
  );
  const operatorLabelByValue = new Map(
    FILTER_OPERATOR_OPTIONS.map((option) => [
      option.value,
      resolveSummaryLabel(t, option.labelKey, option.fallbackLabel),
    ]),
  );

  const parts = rule.filters.map((filter) => {
    const fieldLabel = fieldLabelByValue.get(filter.field) ?? filter.field;
    const operatorLabel = operatorLabelByValue.get(filter.operator) ?? filter.operator;

    if (filter.operator === "range") {
      return `${fieldLabel} ${operatorLabel} ${filter.min ?? "..."} - ${filter.max ?? "..."}`;
    }

    if (
      filter.operator === "contains_any_in_set" ||
      filter.operator === "equals_any_in_set" ||
      filter.operator === "in_set"
    ) {
      const values = (filter.values ?? []).map((value) => `'${value}'`).join(", ");
      return `${fieldLabel} ${operatorLabel} ${values}`;
    }

    if (filter.operator === "is_empty" || filter.operator === "is_not_empty") {
      return `${fieldLabel} ${operatorLabel}`;
    }

    if (filter.field === "current_category_id" && typeof filter.value === "string") {
      return `${fieldLabel} ${operatorLabel} '${categoryNameById.get(filter.value) ?? filter.value}'`;
    }

    return `${fieldLabel} ${operatorLabel} '${String(filter.value ?? "")}'`;
  });

  const joiner =
    rule.match_mode === "all" ? ` ${t("money.ruleSummaryAnd")} ` : ` ${t("money.ruleSummaryOr")} `;
  return parts.join(joiner);
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
    () =>
      new Map(
        (categories ?? []).map((category) => [
          category.id,
          `${category.name_en} / ${category.name_ru}${category.system_key ? ` (${category.system_key})` : ""}`,
        ]),
      ),
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
    const currentIndex = orderedRules.findIndex((rule) => rule.id === ruleId);
    if (currentIndex === -1) return;

    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= orderedRules.length) return;

    const reordered = [...orderedRules];
    const [movedRule] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, movedRule);

    try {
      await reorderRuleMutation.mutateAsync({
        personId: selectedPersonId,
        orderedRuleIds: reordered.map((rule) => rule.id),
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
                      {formatRuleSummary(rule, t, categoryNameById)}
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

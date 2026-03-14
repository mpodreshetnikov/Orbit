"use client";

import React, { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { translateOrFallback } from "@/lib/money-category-pipeline-ui";
import type { MoneyCategory, MoneyCategoryRuleRun } from "@/types";

interface MoneyRuleRunReportSuccess {
  actionLabel: string;
  runs: MoneyCategoryRuleRun[];
}

interface MoneyRuleRunReportError {
  actionLabel: string;
  message: string;
}

interface MoneyRuleRunReportProps {
  t: (key: string) => string;
  categories: MoneyCategory[];
  successReport: MoneyRuleRunReportSuccess | null;
  errorReport: MoneyRuleRunReportError | null;
}

function buildCategoryLabel(category: MoneyCategory | undefined, fallbackId: string | null) {
  if (!category) return fallbackId ?? "--";
  return `${category.name_en} / ${category.name_ru}${category.system_key ? ` (${category.system_key})` : ""}`;
}

function didRunChangeCategory(run: MoneyCategoryRuleRun) {
  if (run.starting_category_id !== run.final_category_id) return true;
  return run.steps.some((step) => step.changed_category);
}

export function MoneyRuleRunReport({
  t,
  categories,
  successReport,
  errorReport,
}: MoneyRuleRunReportProps) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const [showOnlyUnmapped, setShowOnlyUnmapped] = useState(false);
  const [mappedCategoryId, setMappedCategoryId] = useState("all");

  if (!successReport && !errorReport) {
    return (
      <Card data-testid="money-rule-report">
        <CardHeader>
          <CardTitle>{t("money.ruleReportTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("money.ruleReportEmpty")}</p>
        </CardContent>
      </Card>
    );
  }

  if (errorReport) {
    return (
      <Card data-testid="money-rule-report">
        <CardHeader className="space-y-2">
          <CardTitle>{t("money.ruleReportTitle")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">{t("money.ruleRunReportFailed")}</Badge>
            <Badge variant="outline">{errorReport.actionLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("money.ruleRunReportFailed")}</AlertTitle>
            <AlertDescription>{errorReport.message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const runs = successReport?.runs ?? [];
  const mappedCategoryOptions = categories.filter((category) =>
    runs.some((run) => run.final_category_id === category.id),
  );
  const filteredRuns = runs.filter((run) => {
    if (showOnlyUnmapped) return run.final_category_id == null;
    if (mappedCategoryId !== "all") return run.final_category_id === mappedCategoryId;
    return true;
  });
  const changedRuns = filteredRuns.filter((run) => didRunChangeCategory(run)).length;
  const unchangedRuns = filteredRuns.length - changedRuns;
  const savedRuns = filteredRuns.filter((run) => run.saved).length;

  return (
    <Card data-testid="money-rule-report">
      <CardHeader className="space-y-3">
        <CardTitle>{t("money.ruleReportTitle")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">{t("money.ruleRunReportSucceeded")}</Badge>
          <Badge variant="outline">{successReport?.actionLabel}</Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">
            {t("money.ruleRunReportCountLabel")}: {filteredRuns.length}
          </Badge>
          <Badge variant="secondary">
            {t("money.ruleRunReportChangedLabel")}: {changedRuns}
          </Badge>
          <Badge variant="secondary">
            {t("money.ruleRunReportUnchangedLabel")}: {unchangedRuns}
          </Badge>
          <Badge variant="secondary">
            {t("money.ruleRunReportSavedLabel")}: {savedRuns}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]">
          <div className="flex items-start gap-3">
            <Checkbox
              id="money-rule-report-only-unmapped"
              checked={showOnlyUnmapped}
              onCheckedChange={(checked) => {
                const nextValue = checked === true;
                setShowOnlyUnmapped(nextValue);
                if (nextValue) setMappedCategoryId("all");
              }}
            />
            <div className="space-y-1">
              <Label htmlFor="money-rule-report-only-unmapped">
                {t("money.ruleRunReportOnlyUnmapped")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translateOrFallback(
                  t,
                  "money.ruleRunReportOnlyUnmappedHint",
                  "Show only runs that still ended without a mapped category.",
                )}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="money-rule-report-mapped-category">
              {t("money.ruleRunReportMappedCategoryFilter")}
            </Label>
            <Select
              value={mappedCategoryId}
              onValueChange={setMappedCategoryId}
              disabled={showOnlyUnmapped}
            >
              <SelectTrigger
                id="money-rule-report-mapped-category"
                aria-label={t("money.ruleRunReportMappedCategoryFilter")}
              >
                <SelectValue placeholder={t("money.ruleRunReportAllMappedCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("money.ruleRunReportAllMappedCategories")}</SelectItem>
                {mappedCategoryOptions.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {buildCategoryLabel(category, category.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {filteredRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translateOrFallback(
              t,
              "money.ruleRunReportNoFilteredResults",
              "No runs match the current filters.",
            )}
          </p>
        ) : null}

        {filteredRuns.map((run) => {
          const changed = didRunChangeCategory(run);
          const startingCategory = buildCategoryLabel(
            categoryById.get(run.starting_category_id ?? ""),
            run.starting_category_id,
          );
          const finalCategory = buildCategoryLabel(
            categoryById.get(run.final_category_id ?? ""),
            run.final_category_id,
          );

          return (
            <div
              key={run.id ?? `${run.line_item_id}-${run.transaction_id}`}
              className="rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{run.trigger_source}</Badge>
                <Badge variant={changed ? "default" : "secondary"}>
                  {changed ? t("money.ruleChangedCategory") : t("money.ruleNoChange")}
                </Badge>
                <Badge variant={run.saved ? "default" : "secondary"}>
                  {run.saved ? t("money.ruleRunReportSaved") : t("money.ruleRunReportPreviewOnly")}
                </Badge>
              </div>

              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="font-medium">{t("money.ruleRunReportLineItemTitle")}:</span>{" "}
                  {run.line_item_title || "--"}
                </p>
                <p>
                  <span className="font-medium">{t("money.ruleRunReportMerchantName")}:</span>{" "}
                  {run.merchant_name || "--"}
                </p>
                <p>
                  <span className="font-medium">{t("money.ruleLineItemId")}:</span>{" "}
                  {run.line_item_id || "--"}
                </p>
                <p>
                  <span className="font-medium">{t("money.ruleTransactionId")}:</span>{" "}
                  {run.transaction_id || "--"}
                </p>
                <p>
                  <span className="font-medium">{t("money.ruleRunReportStartingCategory")}:</span>{" "}
                  {startingCategory}
                </p>
                <p>
                  <span className="font-medium">{t("money.ruleRunReportFinalCategory")}:</span>{" "}
                  {finalCategory}
                </p>
              </div>

              <div className="mt-4 space-y-2">
                {run.steps.map((step) => (
                  <div
                    key={step.id ?? `${step.rule_id}-${step.sort_order}`}
                    className="rounded-lg border bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {step.rule_name ?? t(`money.ruleKind${step.rule_kind}`)}
                      </span>
                      <Badge variant="outline">{t(`money.ruleKind${step.rule_kind}`)}</Badge>
                      <Badge variant={step.changed_category ? "default" : "secondary"}>
                        {step.changed_category
                          ? t("money.ruleChangedCategory")
                          : translateOrFallback(t, "money.ruleRunReportStepReviewed", "Reviewed")}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{step.decision_reason}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

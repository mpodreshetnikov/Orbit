"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MoneyRuleRunReport } from "@/components/money/rule-run-report";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApplyMoneyCategoryRulePipeline,
  useMoneyCategories,
  usePersons,
  usePreviewMoneyCategoryRulePipeline,
  useReplayMoneyCategoryRulePipelineForDateRange,
  useReplayMoneyCategoryRulePipelineForTransaction,
} from "@/hooks";
import { describeMoneyCategoryPipelineError } from "@/lib/money-category-pipeline-ui";
import { useUIStore } from "@/stores/ui-store";
import type { MoneyCategoryRuleRun } from "@/types";

interface SuccessReportState {
  actionLabel: string;
  runs: MoneyCategoryRuleRun[];
}

interface ErrorReportState {
  actionLabel: string;
  message: string;
}

export default function MoneyRulesReplayReviewPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: persons } = usePersons();
  const { data: categories } = useMoneyCategories();
  const previewMutation = usePreviewMoneyCategoryRulePipeline();
  const applyLineItemMutation = useApplyMoneyCategoryRulePipeline();
  const replayTransactionMutation = useReplayMoneyCategoryRulePipelineForTransaction();
  const replayDateRangeMutation = useReplayMoneyCategoryRulePipelineForDateRange();

  const [lineItemId, setLineItemId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [forceOverwriteLocked, setForceOverwriteLocked] = useState(false);
  const [successReport, setSuccessReport] = useState<SuccessReportState | null>(null);
  const [errorReport, setErrorReport] = useState<ErrorReportState | null>(null);

  const selectedPerson = persons?.find((person) => person.id === selectedPersonId) ?? null;
  const isMutating =
    previewMutation.isPending ||
    applyLineItemMutation.isPending ||
    replayTransactionMutation.isPending ||
    replayDateRangeMutation.isPending;

  const setSuccess = (actionLabel: string, runs: MoneyCategoryRuleRun[]) => {
    setSuccessReport({ actionLabel, runs });
    setErrorReport(null);
  };

  const setFailure = (actionLabel: string, error: unknown) => {
    setSuccessReport(null);
    setErrorReport({
      actionLabel,
      message: describeMoneyCategoryPipelineError(error, t),
    });
  };

  const handlePreview = async () => {
    if (!selectedPersonId || !lineItemId.trim()) return;
    const actionLabel = t("money.rulePreview");

    try {
      const run = await previewMutation.mutateAsync({
        lineItemId: lineItemId.trim(),
        personId: selectedPersonId,
        ruleIds: null,
      });
      setSuccess(actionLabel, [run]);
    } catch (error) {
      setFailure(actionLabel, error);
    }
  };

  const handleApplyToLineItem = async () => {
    if (!selectedPersonId || !lineItemId.trim()) return;
    const actionLabel = t("money.ruleApplyToLineItem");

    try {
      const runs = await applyLineItemMutation.mutateAsync({
        lineItemIds: [lineItemId.trim()],
        personId: selectedPersonId,
        forceOverwriteLocked,
        triggerSource: "single_line_item_replay",
      });
      setSuccess(actionLabel, runs);
    } catch (error) {
      setFailure(actionLabel, error);
    }
  };

  const handleReplayTransaction = async () => {
    if (!selectedPersonId || !transactionId.trim()) return;
    const actionLabel = t("money.ruleReplayTransaction");

    try {
      const runs = await replayTransactionMutation.mutateAsync({
        transactionId: transactionId.trim(),
        personId: selectedPersonId,
        forceOverwriteLocked,
      });
      setSuccess(actionLabel, runs);
    } catch (error) {
      setFailure(actionLabel, error);
    }
  };

  const handleReplayDateRange = async () => {
    if (!selectedPersonId || !fromDate || !toDate) {
      toast.error(t("money.ruleValidationDateRangeRequired"));
      return;
    }

    const actionLabel = t("money.ruleReplayDateRange");

    try {
      const runs = await replayDateRangeMutation.mutateAsync({
        personId: selectedPersonId,
        from: fromDate,
        to: toDate,
        forceOverwriteLocked,
      });
      setSuccess(actionLabel, runs);
    } catch (error) {
      setFailure(actionLabel, error);
    }
  };

  if (!selectedPersonId) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/money/rules">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("money.rules")}
          </Link>
        </Button>
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          <p>{t("person.selectPrompt")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/money/rules">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("money.rules")}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t("money.ruleReplayReviewTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {selectedPerson ? selectedPerson.name : t("person.selectPrompt")}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>{t("money.ruleQuickActions")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("money.ruleReplayReviewHint")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule-line-item-id">{t("money.ruleLineItemId")}</Label>
              <Input
                id="rule-line-item-id"
                aria-label={t("money.ruleLineItemId")}
                value={lineItemId}
                onChange={(event) => {
                  setLineItemId(event.target.value);
                  setErrorReport(null);
                }}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handlePreview()}
                disabled={!lineItemId.trim() || isMutating}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {t("money.rulePreview")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleApplyToLineItem()}
                disabled={!lineItemId.trim() || isMutating}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("money.ruleApplyToLineItem")}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-transaction-id">{t("money.ruleTransactionId")}</Label>
              <Input
                id="rule-transaction-id"
                aria-label={t("money.ruleTransactionId")}
                value={transactionId}
                onChange={(event) => {
                  setTransactionId(event.target.value);
                  setErrorReport(null);
                }}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => void handleReplayTransaction()}
              disabled={!transactionId.trim() || isMutating}
            >
              {t("money.ruleReplayTransaction")}
            </Button>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rule-from-date">{t("money.ruleFromDate")}</Label>
                <Input
                  id="rule-from-date"
                  aria-label={t("money.ruleFromDate")}
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                    setErrorReport(null);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-to-date">{t("money.ruleToDate")}</Label>
                <Input
                  id="rule-to-date"
                  aria-label={t("money.ruleToDate")}
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value);
                    setErrorReport(null);
                  }}
                />
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => void handleReplayDateRange()}
              disabled={!fromDate || !toDate || isMutating}
            >
              {t("money.ruleReplayDateRange")}
            </Button>

            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="force-overwrite-locked"
                  checked={forceOverwriteLocked}
                  onCheckedChange={(checked) => setForceOverwriteLocked(checked === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="force-overwrite-locked">
                    {t("money.ruleForceOverwriteLocked")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("money.ruleForceOverwriteLockedHint")}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <MoneyRuleRunReport
          t={t}
          categories={categories ?? []}
          successReport={successReport}
          errorReport={errorReport}
        />
      </div>
    </div>
  );
}

"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { MoneyTransactionForm } from "@/components/money";
import type { MoneyTransactionFormValues } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  useApplyMoneyCategoryRulePipeline,
  useDeleteMoneyTransaction,
  useMoneyAccounts,
  useMoneyCategoryDebug,
  useMoneyCategories,
  useMoneyMerchantDefaultCategories,
  useMoneyTransaction,
  useMoneyTransactionEditAudits,
  useMoneyTransactions,
  usePersons,
  usePreviewMoneyCategoryRulePipeline,
  useReplayMoneyCategoryRulePipelineForTransaction,
  useUpdateMoneyTransaction,
} from "@/hooks";
import { formatMoney } from "@/lib/money";
import { useUIStore } from "@/stores/ui-store";

export default function MoneyTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [forceOverwriteLocked, setForceOverwriteLocked] = useState(false);
  const [previewReason, setPreviewReason] = useState<string | null>(null);

  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const { data: categories } = useMoneyCategories();
  const { data: transactions } = useMoneyTransactions(selectedPersonId);
  const { data: merchantDefaultCategoryId } = useMoneyMerchantDefaultCategories(selectedPersonId);
  const { data: persons } = usePersons();
  const { data: transaction, isLoading } = useMoneyTransaction(id);
  const { data: audits } = useMoneyTransactionEditAudits(id);
  const { data: debugRuns } = useMoneyCategoryDebug(selectedLineItemId);
  const updateMutation = useUpdateMoneyTransaction();
  const deleteMutation = useDeleteMoneyTransaction();
  const previewMutation = usePreviewMoneyCategoryRulePipeline();
  const applyMutation = useApplyMoneyCategoryRulePipeline();
  const replayTransactionMutation = useReplayMoneyCategoryRulePipelineForTransaction();

  const existingMerchantNames = useMemo(
    () =>
      [
        ...new Set(
          (transactions ?? [])
            .map((tx) => tx.merchant_name)
            .filter((name): name is string => Boolean(name?.trim())),
        ),
      ].sort(),
    [transactions],
  );

  const categoryNameById = useMemo(
    () =>
      new Map(
        (categories ?? []).map((category) => [
          category.id,
          `${category.name_en} / ${category.name_ru}`,
        ]),
      ),
    [categories],
  );

  const accountNameById = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.id, account.account_label])),
    [accounts],
  );

  useEffect(() => {
    const nextLineItemId = transaction?.line_items?.find((item) => item.id)?.id ?? null;
    if (!nextLineItemId) return;
    if (
      !selectedLineItemId ||
      !transaction?.line_items?.some((item) => item.id === selectedLineItemId)
    ) {
      setSelectedLineItemId(nextLineItemId);
    }
  }, [selectedLineItemId, transaction]);

  if (!selectedPersonId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        {t("common.noResults")}
      </div>
    );
  }

  const handleSubmit = async (values: MoneyTransactionFormValues) => {
    await updateMutation.mutateAsync({
      id: transaction.id,
      updates: {
        account_id: values.account_id,
        posted_at: values.posted_at,
        amount: values.amount,
        currency: values.currency,
        transaction_type: values.transaction_type,
        status: values.status,
        merchant_name: values.merchant_name || null,
        comment: values.comment || null,
      },
      lineItems: values.line_items,
    });
    setEditMode(false);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync({
      id: transaction.id,
      payerPersonId: transaction.payer_person_id,
    });
    router.push("/money/transactions");
  };

  const selectedLineItem =
    transaction.line_items.find((lineItem) => lineItem.id === selectedLineItemId) ?? null;

  const handlePreviewLineItem = async () => {
    if (!selectedLineItemId) return;
    const previewRun = await previewMutation.mutateAsync({
      lineItemId: selectedLineItemId,
      personId: transaction.payer_person_id,
      ruleIds: null,
    });
    setPreviewReason(previewRun?.steps?.[0]?.decision_reason ?? null);
  };

  const handleApplyLineItem = async () => {
    if (!selectedLineItemId) return;
    await applyMutation.mutateAsync({
      lineItemIds: [selectedLineItemId],
      personId: transaction.payer_person_id,
      forceOverwriteLocked,
      triggerSource: "single_line_item_replay",
    });
  };

  const handleReplayTransaction = async () => {
    await replayTransactionMutation.mutateAsync({
      transactionId: transaction.id,
      personId: transaction.payer_person_id,
      forceOverwriteLocked,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link href="/money/transactions">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              {transaction.merchant_name || t("money.transactionFallback")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("money.transactions")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editMode ? (
            <Button type="button" variant="outline" onClick={() => setEditMode(true)}>
              {t("common.edit")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t("money.deleteTransaction")}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {t(
                    `money.transactionType${
                      transaction.transaction_type.charAt(0).toUpperCase() +
                      transaction.transaction_type.slice(1)
                    }`,
                  )}
                </Badge>
                <Badge variant="secondary">
                  {t(
                    `money.transactionStatus${
                      transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)
                    }`,
                  )}
                </Badge>
                {transaction.is_transfer ? (
                  <Badge>{t("money.transactionTypeTransfer")}</Badge>
                ) : null}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("money.account")}</p>
                <p className="font-medium">{accountNameById.get(transaction.account_id) ?? "—"}</p>
              </div>
              {transaction.comment ? (
                <div>
                  <p className="text-sm text-muted-foreground">{t("money.comment")}</p>
                  <p>{transaction.comment}</p>
                </div>
              ) : null}
            </div>

            <div className="text-right">
              <p
                className={`text-3xl font-semibold tracking-tight ${
                  transaction.amount < 0 ? "text-rose-700" : "text-emerald-700"
                }`}
              >
                {formatMoney(transaction.amount, transaction.currency, "en-US")}
              </p>
              {"money_cards" in transaction && transaction.money_cards ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("money.card")}: *{transaction.money_cards.last4}
                  {transaction.money_cards.card_label
                    ? ` (${transaction.money_cards.card_label})`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {transaction.line_items.map((lineItem) => (
              <button
                key={lineItem.id ?? lineItem.title}
                type="button"
                onClick={() => setSelectedLineItemId(lineItem.id ?? null)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  selectedLineItemId === lineItem.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white/80 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {t("money.lineItemTitle")}: {lineItem.title}
                  </span>
                  <span className="text-sm">
                    {formatMoney(lineItem.amount, transaction.currency, "en-US")}
                  </span>
                </div>
                <div className="mt-2 text-xs opacity-80">
                  {lineItem.category_id
                    ? (categoryNameById.get(lineItem.category_id) ?? lineItem.category_id)
                    : t("money.categoryUnassigned")}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {editMode ? (
        <MoneyTransactionForm
          mode="edit"
          accounts={accounts ?? []}
          categories={categories ?? []}
          persons={(persons ?? []).map((person) => ({ id: person.id, name: person.name }))}
          initialTransaction={transaction}
          initialLineItems={transaction.line_items}
          onSubmit={handleSubmit}
          onCancel={() => setEditMode(false)}
          isPending={updateMutation.isPending}
          existingMerchantNames={existingMerchantNames}
          selectedPersonId={selectedPersonId}
          merchantDefaultCategoryId={merchantDefaultCategoryId ?? {}}
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(audits ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>
              ) : (
                (audits ?? []).map((audit) => (
                  <div key={audit.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{audit.id}</p>
                      <Badge variant="outline">{audit.entity_kind}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {audit.before_snapshot?.merchant_name
                        ? String(audit.before_snapshot.merchant_name)
                        : "—"}{" "}
                      →{" "}
                      {audit.after_snapshot?.merchant_name
                        ? String(audit.after_snapshot.merchant_name)
                        : "—"}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("money.ruleDebugTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {transaction.line_items.map((lineItem) => (
                  <Button
                    key={lineItem.id ?? lineItem.title}
                    type="button"
                    variant={selectedLineItemId === lineItem.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedLineItemId(lineItem.id ?? null)}
                  >
                    {lineItem.title}
                  </Button>
                ))}
              </div>

              {selectedLineItem ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {t("money.lineItemTitle")}: {selectedLineItem.title}
                    </span>
                    {selectedLineItem.category_id ? (
                      <Badge variant="outline">
                        {categoryNameById.get(selectedLineItem.category_id) ??
                          selectedLineItem.category_id}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{t("money.categoryUnassigned")}</Badge>
                    )}
                    {selectedLineItem.category_locked_by_user ? (
                      <Badge>{t("money.ruleManualLock")}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={handlePreviewLineItem}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t("money.rulePreview")}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleApplyLineItem}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {t("money.ruleApplyToLineItem")}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleReplayTransaction}>
                      {t("money.ruleReplayTransaction")}
                    </Button>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={forceOverwriteLocked}
                      onChange={(event) => setForceOverwriteLocked(event.target.checked)}
                    />
                    <span>{t("money.ruleForceOverwriteLocked")}</span>
                  </label>

                  {previewReason ? (
                    <p className="text-sm text-muted-foreground">{previewReason}</p>
                  ) : null}

                  <div className="space-y-3">
                    {(debugRuns ?? []).map((run) => (
                      <div
                        key={run.id ?? `${run.line_item_id}-${run.created_at}`}
                        className="rounded-lg border p-3"
                      >
                        <div className="text-xs text-muted-foreground">
                          {t("money.ruleTriggerSource")}: {run.trigger_source}
                        </div>
                        <div className="mt-2 space-y-2">
                          {run.steps.map((step) => (
                            <div
                              key={`${step.rule_id}-${step.sort_order}`}
                              className="rounded-md bg-muted/40 p-2"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {step.rule_name ?? step.rule_kind}
                                </span>
                                {step.changed_category ? (
                                  <Badge>{t("money.ruleChangedCategory")}</Badge>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {step.decision_reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("money.ruleNoLineItemSelected")}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("money.deleteTransaction")}</AlertDialogTitle>
            <AlertDialogDescription>{t("money.deleteTransactionConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {t("money.deleteTransaction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

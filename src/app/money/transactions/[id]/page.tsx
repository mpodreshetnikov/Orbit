"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { MoneyTransactionForm } from "@/components/money";
import type { MoneyTransactionFormValues } from "@/components/money";
import {
  useMoneyAccounts,
  useMoneyCategories,
  useMoneyMerchantDefaultCategories,
  useMoneyTransaction,
  useMoneyTransactions,
  useUpdateMoneyTransaction,
  useDeleteMoneyTransaction,
  usePersons,
} from "@/hooks";
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

  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const { data: categories } = useMoneyCategories();
  const { data: transactions } = useMoneyTransactions(selectedPersonId);
  const { data: merchantDefaultCategoryId } = useMoneyMerchantDefaultCategories(selectedPersonId);
  const { data: persons } = usePersons();
  const { data: transaction, isLoading } = useMoneyTransaction(id);
  const updateMutation = useUpdateMoneyTransaction();
  const deleteMutation = useDeleteMoneyTransaction();

  const existingMerchantNames = useMemo(
    () =>
      [
        ...new Set(
          (transactions ?? [])
            .map((tx) => tx.merchant_name)
            .filter((name): name is string => !!name?.trim()),
        ),
      ].sort(),
    [transactions],
  );

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
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
    router.push("/money/transactions");
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync({
      id: transaction.id,
      payerPersonId: transaction.payer_person_id,
    });
    router.push("/money/transactions");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href="/money/transactions">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">{t("money.editTransaction")}</h1>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" />
          {t("money.deleteTransaction")}
        </Button>
      </div>

      {"money_cards" in transaction && transaction.money_cards && (
        <p className="text-sm text-muted-foreground">
          {t("money.card")}: *{transaction.money_cards.last4}
          {transaction.money_cards.card_label ? ` (${transaction.money_cards.card_label})` : ""}
        </p>
      )}

      <MoneyTransactionForm
        mode="edit"
        accounts={accounts ?? []}
        categories={categories ?? []}
        persons={(persons ?? []).map((p) => ({ id: p.id, name: p.name }))}
        initialTransaction={transaction}
        initialLineItems={transaction.line_items}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/money/transactions")}
        isPending={updateMutation.isPending}
        existingMerchantNames={existingMerchantNames}
        selectedPersonId={selectedPersonId}
        merchantDefaultCategoryId={merchantDefaultCategoryId ?? {}}
      />

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

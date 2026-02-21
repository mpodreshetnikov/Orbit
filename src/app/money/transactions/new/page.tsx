"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyTransactionForm } from "@/components/money";
import type { MoneyTransactionFormValues } from "@/components/money";
import {
  useMoneyAccounts,
  useMoneyCategories,
  useMoneyMerchantDefaultCategories,
  useMoneyTransactions,
  usePersons,
  useCreateMoneyTransaction,
} from "@/hooks";
import { useUIStore } from "@/stores/ui-store";

export default function NewMoneyTransactionPage() {
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);

  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const { data: categories } = useMoneyCategories();
  const { data: transactions } = useMoneyTransactions(selectedPersonId);
  const { data: merchantDefaultCategoryId } = useMoneyMerchantDefaultCategories(selectedPersonId);
  const { data: persons } = usePersons();
  const createMutation = useCreateMoneyTransaction();

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

  const hasAccounts = (accounts || []).length > 0;

  const handleSubmit = async (values: MoneyTransactionFormValues) => {
    const result = await createMutation.mutateAsync({
      transaction: {
        payer_person_id: selectedPersonId,
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
    router.push(`/money/transactions/${result.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/money/transactions">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t("money.addTransaction")}</h1>
      </div>

      {!hasAccounts && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-medium">{t("money.noAccounts")}</p>
              <p className="text-xs">{t("money.noAccountsHint")}</p>
              <Link href="/money/accounts?new=1">
                <Button size="sm" variant="secondary" className="mt-2">
                  {t("money.addAccount")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      <MoneyTransactionForm
        mode="create"
        accounts={accounts ?? []}
        categories={categories ?? []}
        persons={(persons ?? []).map((p) => ({ id: p.id, name: p.name }))}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/money/transactions")}
        isPending={createMutation.isPending}
        existingMerchantNames={existingMerchantNames}
        selectedPersonId={selectedPersonId}
        merchantDefaultCategoryId={merchantDefaultCategoryId ?? {}}
      />
    </div>
  );
}

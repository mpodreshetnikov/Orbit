"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Search, Plus, Wallet, ChevronRight } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useMoneyAccounts, useMoneyTransactions } from "@/hooks";
import { useDateFnsLocale, useIntlLocale } from "@/lib/date-locale";
import { format } from "date-fns";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function MoneyTransactionsPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const dateLocale = useDateFnsLocale();
  const intlLocale = useIntlLocale();

  const [searchQuery, setSearchQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const { data: transactions, isLoading } = useMoneyTransactions(
    selectedPersonId,
    {
      accountId: accountFilter === "all" ? null : accountFilter,
    }
  );

  const accountMap = useMemo(() => {
    const map = new Map<string, string>();
    (accounts || []).forEach((acc) => map.set(acc.id, acc.account_label));
    return map;
  }, [accounts]);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((tx) => {
      const merchant = tx.merchant_name?.toLowerCase() ?? "";
      const comment = tx.comment?.toLowerCase() ?? "";
      return merchant.includes(q) || comment.includes(q);
    });
  }, [transactions, searchQuery]);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">{t("money.transactions")}</h1>
        <Link href="/money/transactions/new">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("money.addTransaction")}
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("money.searchTransactions")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder={t("money.account")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("money.allAccounts")}</SelectItem>
            {(accounts || []).map((account) => (
              <SelectItem
                key={account.id}
                value={account.id}
                className={!account.is_active ? "text-muted-foreground" : undefined}
              >
                {account.account_label}
                {!account.is_active && ` — ${t("money.accountInactive")}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="rounded-lg border overflow-hidden">
          <div className="h-12 bg-muted/50 animate-pulse" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 border-t bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : !filteredTransactions || filteredTransactions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <Wallet className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">{t("money.noTransactions")}</p>
          <p className="text-sm mt-1">{t("money.noTransactionsHint")}</p>
          <Link href="/money/transactions/new">
            <Button size="sm" className="mt-3">
              {t("money.addTransaction")}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium px-4 py-3">
                  {t("money.postedAt")}
                </th>
                <th className="text-left font-medium px-4 py-3">
                  {t("money.merchant")}
                </th>
                <th className="text-left font-medium px-4 py-3">
                  {t("money.account")}
                </th>
                <th className="text-left font-medium px-4 py-3">
                  {t("money.type")}
                </th>
                <th className="text-right font-medium px-4 py-3">
                  {t("money.amount")}
                </th>
                <th className="w-8 px-2 py-3" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const amountColor =
                  tx.amount < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400";
                const accountLabel = accountMap.get(tx.account_id) ?? "";
                return (
                  <tr key={tx.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {format(new Date(tx.posted_at), "MMM d, yyyy", {
                        locale: dateLocale,
                      })}
                    </td>
                    <td className="px-4 py-3 min-w-0">
                      <Link
                        href={`/money/transactions/${tx.id}`}
                        className="font-medium hover:underline block truncate max-w-[200px]"
                      >
                        {tx.merchant_name || t("money.transactionFallback")}
                      </Link>
                      {tx.comment ? (
                        <p className="text-muted-foreground text-xs truncate max-w-[200px] mt-0.5">
                          {tx.comment}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[140px]">
                      {accountLabel}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-xs">
                        {t(
                          `money.transactionType${
                            tx.transaction_type.charAt(0).toUpperCase() +
                            tx.transaction_type.slice(1)
                          }`
                        )}
                      </Badge>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${amountColor}`}
                    >
                      {formatMoney(tx.amount, tx.currency, intlLocale)}
                    </td>
                    <td className="px-2 py-3">
                      <Link
                        href={`/money/transactions/${tx.id}`}
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label={t("common.view")}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUIStore } from "@/stores/ui-store";
import {
  useMoneyAccounts,
  useCreateMoneyAccount,
  useUpdateMoneyAccount,
  useDeleteMoneyAccount,
} from "@/hooks";
import type { MoneyAccount, MoneyAccountKind, MoneyCurrency } from "@/types";
import { MONEY_ACCOUNT_KINDS, MONEY_CURRENCIES } from "@/types";

export default function MoneyAccountsPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const searchParams = useSearchParams();

  const { data: accounts, isLoading } = useMoneyAccounts(selectedPersonId);
  const createMutation = useCreateMoneyAccount();
  const updateMutation = useUpdateMoneyAccount();
  const deleteMutation = useDeleteMoneyAccount();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MoneyAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MoneyAccount | null>(null);

  const [label, setLabel] = useState("");
  const [accountKind, setAccountKind] = useState<MoneyAccountKind>("card");
  const [currency, setCurrency] = useState<MoneyCurrency | string>("RUB");
  const [source, setSource] = useState("manual");
  const [externalId, setExternalId] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (searchParams?.get("new") === "1") {
      openNew();
    }
  }, [searchParams]);

  const resetForm = () => {
    setLabel("");
    setAccountKind("card");
    setCurrency("RUB");
    setSource("manual");
    setExternalId("");
    setIsActive(true);
  };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (account: MoneyAccount) => {
    setEditing(account);
    setLabel(account.account_label);
    setAccountKind(account.account_kind);
    setCurrency(account.currency);
    setSource(account.source);
    setExternalId(account.external_account_id ?? "");
    setIsActive(account.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedPersonId) return;
    if (!label.trim()) return;

    if (editing) {
      await updateMutation.mutateAsync({
        id: editing.id,
        updates: {
          account_label: label.trim(),
          account_kind: accountKind,
          currency,
          source: source.trim() || "manual",
          external_account_id: externalId.trim() || null,
          is_active: isActive,
        },
      });
    } else {
      await createMutation.mutateAsync({
        owner_person_id: selectedPersonId,
        account_label: label.trim(),
        account_kind: accountKind,
        currency,
        source: source.trim() || "manual",
        external_account_id: externalId.trim() || null,
        is_active: isActive,
      });
    }

    setDialogOpen(false);
  };

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("money.accounts")}</h1>
        <Button size="sm" onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("money.addAccount")}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p className="font-medium">{t("money.noAccounts")}</p>
          <p className="text-sm mt-1">{t("money.noAccountsHint")}</p>
          <Button size="sm" className="mt-3" onClick={openNew}>
            {t("money.addAccount")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <Card
              key={account.id}
              className={`border-muted ${!account.is_active ? "opacity-75 bg-muted/40" : ""}`}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{account.account_label}</h3>
                      {!account.is_active && (
                        <Badge variant="secondary" className="shrink-0 text-xs font-normal">
                          {t("money.accountInactive")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t(`money.accountKind${account.account_kind.charAt(0).toUpperCase() + account.account_kind.slice(1)}`)}
                    </p>
                  </div>
                  <span className="text-sm font-medium shrink-0">{account.currency}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {account.source}
                </p>
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => openEdit(account)}
                  >
                    <Pencil className="h-4 w-4" />
                    {t("common.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2 text-destructive"
                    onClick={() => setDeleteTarget(account)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("common.delete")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("money.editAccount") : t("money.addAccount")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.accountLabel")}</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.accountKind")}</label>
              <Select
                value={accountKind}
                onValueChange={(value) => setAccountKind(value as MoneyAccountKind)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("money.accountKind")} />
                </SelectTrigger>
                <SelectContent>
                  {MONEY_ACCOUNT_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {t(`money.accountKind${kind.charAt(0).toUpperCase() + kind.slice(1)}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.accountCurrency")}</label>
              <Select
                value={currency}
                onValueChange={(value) => setCurrency(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("money.currency")} />
                </SelectTrigger>
                <SelectContent>
                  {MONEY_CURRENCIES.map((cur) => (
                    <SelectItem key={cur} value={cur}>
                      {cur}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.accountSource")}</label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("money.accountExternalId")}</label>
              <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="account-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
              />
              <label htmlFor="account-active" className="text-sm">
                {t("money.accountActive")}
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("money.deleteAccountConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget || !selectedPersonId) return;
                await deleteMutation.mutateAsync({
                  id: deleteTarget.id,
                  ownerPersonId: selectedPersonId,
                });
                setDeleteTarget(null);
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

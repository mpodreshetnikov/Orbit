"use client";

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronsUpDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/date-locale";
import type {
  MoneyAccount,
  MoneyCategory,
  MoneyCurrency,
  MoneyLineStatus,
  MoneyTransactionStatus,
  MoneyTransactionType,
  MoneyLineItem,
  MoneyTransaction,
  CreateMoneyLineItemInput,
} from "@/types";
import {
  MONEY_CURRENCIES,
  MONEY_LINE_STATUSES,
  MONEY_TRANSACTION_STATUSES,
  MONEY_TRANSACTION_TYPES,
} from "@/types";

export interface MoneyTransactionFormValues {
  account_id: string;
  posted_at: string;
  amount: number;
  currency: MoneyCurrency | string;
  transaction_type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  merchant_name: string;
  comment: string;
  line_items: CreateMoneyLineItemInput[];
}

interface LineItemState {
  key: string;
  title: string;
  amount: string;
  quantity: string;
  unit: string;
  line_status: MoneyLineStatus;
  category_id: string | null;
  beneficiary_person_id: string | null;
}

interface MoneyTransactionFormProps {
  mode: "create" | "edit";
  accounts: MoneyAccount[];
  categories: MoneyCategory[];
  persons: { id: string; name: string }[];
  initialTransaction?: MoneyTransaction | null;
  initialLineItems?: MoneyLineItem[] | null;
  onSubmit: (values: MoneyTransactionFormValues) => Promise<void>;
  onCancel: () => void;
  isPending?: boolean;
  /** Unique merchant names from existing transactions (for dropdown suggestions). */
  existingMerchantNames?: string[];
  /** Person adding/editing (for default beneficiary on line items). */
  selectedPersonId?: string | null;
  /** Most used category per merchant name (for line item default). */
  merchantDefaultCategoryId?: Record<string, string>;
}

function toLocalDateTimeInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultLineItem(seed?: Partial<LineItemState>): LineItemState {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return {
    key,
    title: "",
    amount: "",
    quantity: "",
    unit: "",
    line_status: "final",
    category_id: null,
    beneficiary_person_id: null,
    ...seed,
  };
}

export function MoneyTransactionForm({
  mode,
  accounts,
  categories,
  persons,
  initialTransaction,
  initialLineItems,
  onSubmit,
  onCancel,
  isPending,
  existingMerchantNames = [],
  selectedPersonId = null,
  merchantDefaultCategoryId = {},
}: MoneyTransactionFormProps) {
  const t = useTranslations();
  const intlLocale = useIntlLocale();
  const prevAccountIdRef = useRef<string | null>(null);
  const accountCurrencySyncedOnce = useRef(false);
  const amountTypeSyncedOnce = useRef(false);
  const lineItemDefaultsApplied = useRef(false);

  const [accountId, setAccountId] = useState(initialTransaction?.account_id ?? "");
  const [postedAt, setPostedAt] = useState(() => {
    const value = initialTransaction?.posted_at ?? new Date().toISOString();
    return toLocalDateTimeInput(value);
  });
  const [amount, setAmount] = useState(initialTransaction ? String(initialTransaction.amount) : "");
  const [currency, setCurrency] = useState<MoneyCurrency | string>(
    initialTransaction?.currency ?? "RUB",
  );
  const [transactionType, setTransactionType] = useState<MoneyTransactionType>(
    initialTransaction?.transaction_type ?? "expense",
  );
  const [status, setStatus] = useState<MoneyTransactionStatus>(
    initialTransaction?.status ?? "posted",
  );
  const [merchantName, setMerchantName] = useState(initialTransaction?.merchant_name ?? "");
  const [comment, setComment] = useState(initialTransaction?.comment ?? "");

  const [lineItems, setLineItems] = useState<LineItemState[]>(() => {
    if (initialLineItems && initialLineItems.length > 0) {
      return initialLineItems.map((item) =>
        defaultLineItem({
          title: item.title,
          amount: String(item.amount),
          quantity: item.quantity != null ? String(item.quantity) : "",
          unit: item.unit ?? "",
          line_status: item.line_status,
          category_id: item.category_id,
          beneficiary_person_id: item.beneficiary_person_id,
        }),
      );
    }
    return [defaultLineItem()];
  });

  const [openCategoryKey, setOpenCategoryKey] = useState<string | null>(null);
  const [openMerchantDropdown, setOpenMerchantDropdown] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId),
    [accounts, accountId],
  );
  const uniqueMerchants = useMemo(
    () => [...new Set(existingMerchantNames.filter(Boolean))].sort(),
    [existingMerchantNames],
  );
  const defaultUnit = t("money.unitPcs");

  // When user changes account for the first time, sync currency to account's currency
  useEffect(() => {
    if (!accountId || !selectedAccount) return;
    const prev = prevAccountIdRef.current;
    if (prev !== null && prev !== accountId && !accountCurrencySyncedOnce.current) {
      setCurrency(selectedAccount.currency);
      accountCurrencySyncedOnce.current = true;
    }
    prevAccountIdRef.current = accountId;
  }, [accountId, selectedAccount]);

  const totalLineItems = useMemo(() => {
    return lineItems.reduce((sum, item) => {
      const value = parseFloat(item.amount);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, [lineItems]);

  const amountNumber = Number.isFinite(parseFloat(amount)) ? parseFloat(amount) : 0;
  // Compare in cents to avoid floating-point false positives
  const totalCents = Math.round(totalLineItems * 100);
  const amountCents = Math.round(amountNumber * 100);
  const showMismatch = totalCents !== amountCents;

  const categoryOptions = useMemo(
    () => [...categories].sort((a, b) => a.depth - b.depth),
    [categories],
  );

  const handleLineItemChange = (key: string, updates: Partial<LineItemState>) => {
    setLineItems((items) =>
      items.map((item) => (item.key === key ? { ...item, ...updates } : item)),
    );
  };

  const defaultLineItemValues = useMemo(
    () => ({
      quantity: "1",
      unit: defaultUnit,
      category_id: (merchantName.trim() ? merchantDefaultCategoryId[merchantName.trim()] : null) as
        | string
        | null,
      beneficiary_person_id: selectedPersonId ?? null,
    }),
    [defaultUnit, merchantName, merchantDefaultCategoryId, selectedPersonId],
  );

  const handleAddLineItem = () => {
    setLineItems((items) => [
      ...items,
      defaultLineItem({
        quantity: defaultLineItemValues.quantity,
        unit: defaultLineItemValues.unit,
        category_id: defaultLineItemValues.category_id,
        beneficiary_person_id: defaultLineItemValues.beneficiary_person_id,
      }),
    ]);
  };

  // Apply defaults to first line item once in create mode (no initial line items)
  useEffect(() => {
    if (mode !== "create" || lineItems.length !== 1 || lineItemDefaultsApplied.current) return;
    const item = lineItems[0];
    if (!item || (item.quantity !== "" && item.unit !== "")) return;
    lineItemDefaultsApplied.current = true;
    const defaultCategory = merchantName.trim()
      ? merchantDefaultCategoryId[merchantName.trim()]
      : null;
    handleLineItemChange(item.key, {
      quantity: "1",
      unit: defaultUnit,
      category_id: defaultCategory ?? null,
      beneficiary_person_id: selectedPersonId ?? null,
    });
  }, [mode, lineItems, merchantName, merchantDefaultCategoryId, selectedPersonId, defaultUnit]);

  // When merchant changes, set all line items' category to the default for that merchant
  const prevMerchantRef = useRef(merchantName);
  useEffect(() => {
    if (prevMerchantRef.current === merchantName) return;
    prevMerchantRef.current = merchantName;
    const trimmed = merchantName.trim();
    const defaultCat = trimmed ? (merchantDefaultCategoryId[trimmed] ?? null) : null;
    setLineItems((items) => items.map((item) => ({ ...item, category_id: defaultCat })));
  }, [merchantName, merchantDefaultCategoryId]);

  const handleRemoveLineItem = (key: string) => {
    setLineItems((items) => items.filter((item) => item.key !== key));
  };

  const handleSubmit = async () => {
    if (!accountId) {
      toast.error(t("money.validationAccountRequired"));
      return;
    }
    if (!postedAt) {
      toast.error(t("money.validationPostedAtRequired"));
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount)) {
      toast.error(t("money.validationAmountRequired"));
      return;
    }

    const lineItemsPayload = lineItems
      .filter((item) => item.title.trim() || item.amount.trim())
      .map<CreateMoneyLineItemInput>((item) => ({
        title: item.title.trim() || merchantName.trim() || "Manual item",
        amount: Number.isFinite(parseFloat(item.amount)) ? parseFloat(item.amount) : 0,
        quantity: Number.isFinite(parseFloat(item.quantity)) ? parseFloat(item.quantity) : null,
        unit: item.unit.trim() || null,
        line_status: item.line_status,
        category_id: item.category_id ?? null,
        beneficiary_person_id: item.beneficiary_person_id ?? null,
        assignment_method: "manual",
      }));

    const isoPostedAt = new Date(postedAt).toISOString();

    await onSubmit({
      account_id: accountId,
      posted_at: isoPostedAt,
      amount: parsedAmount,
      currency,
      transaction_type: transactionType,
      status,
      merchant_name: merchantName.trim(),
      comment: comment.trim(),
      line_items: lineItemsPayload,
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.account")}</label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder={t("money.selectAccount")} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem
                  key={account.id}
                  value={account.id}
                  className={!account.is_active ? "text-muted-foreground" : undefined}
                >
                  {account.account_label} ({account.currency})
                  {!account.is_active && ` — ${t("money.accountInactive")}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.postedAt")}</label>
          <Input
            type="datetime-local"
            value={postedAt}
            onChange={(e) => setPostedAt(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.amount")}</label>
          <Input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => {
              const v = e.target.value;
              setAmount(v);
              if (mode === "create" && !amountTypeSyncedOnce.current) {
                const n = parseFloat(v);
                if (Number.isFinite(n)) {
                  setTransactionType(n >= 0 ? "income" : "expense");
                  amountTypeSyncedOnce.current = true;
                }
              }
            }}
            placeholder="-1200"
          />
          <p className="text-xs text-muted-foreground">{t("money.amountHint")}</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.currency")}</label>
          <Select value={currency} onValueChange={(value) => setCurrency(value)}>
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

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.type")}</label>
          <Select
            value={transactionType}
            onValueChange={(value) => setTransactionType(value as MoneyTransactionType)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("money.type")} />
            </SelectTrigger>
            <SelectContent>
              {MONEY_TRANSACTION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`money.transactionType${type.charAt(0).toUpperCase() + type.slice(1)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.status")}</label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as MoneyTransactionStatus)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("money.status")} />
            </SelectTrigger>
            <SelectContent>
              {MONEY_TRANSACTION_STATUSES.map((st) => (
                <SelectItem key={st} value={st}>
                  {t(`money.transactionStatus${st.charAt(0).toUpperCase() + st.slice(1)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("money.merchant")}</label>
          <Popover open={openMerchantDropdown} onOpenChange={setOpenMerchantDropdown}>
            <PopoverTrigger asChild>
              <div className="relative">
                <Input
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  onFocus={() => setOpenMerchantDropdown(true)}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={t("money.merchantPlaceholder")}
                  className="pr-8"
                />
                <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 shrink-0 opacity-50 pointer-events-none" />
              </div>
            </PopoverTrigger>
            <PopoverContent
              className="w-[var(--radix-popover-trigger-width)] p-0"
              align="start"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Command>
                <CommandInput
                  value={merchantName}
                  onValueChange={setMerchantName}
                  placeholder={t("money.merchantPlaceholder")}
                  className="h-9"
                />
                <CommandList>
                  <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                  <CommandGroup>
                    {uniqueMerchants.slice(0, 100).map((m) => (
                      <CommandItem
                        key={m}
                        value={m}
                        onSelect={() => {
                          setMerchantName(m);
                          setOpenMerchantDropdown(false);
                          const defaultCat = merchantDefaultCategoryId[m];
                          if (defaultCat) {
                            setLineItems((items) =>
                              items.map((item) =>
                                item.category_id
                                  ? item
                                  : {
                                      ...item,
                                      category_id: defaultCat,
                                    },
                              ),
                            );
                          }
                        }}
                      >
                        {m}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">{t("money.comment")}</label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("money.commentPlaceholder")}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("money.lineItems")}</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAddLineItem}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            {t("money.addLineItem")}
          </Button>
        </div>

        <div className="space-y-3">
          {lineItems.map((item) => (
            <Card key={item.key} className="border-muted">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder={t("money.lineItemTitle")}
                    value={item.title}
                    onChange={(e) => handleLineItemChange(item.key, { title: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveLineItem(item.key)}
                    disabled={lineItems.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t("money.lineItemAmount")}
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) =>
                        handleLineItemChange(item.key, {
                          amount: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t("money.lineItemQuantity")}
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.quantity}
                      onChange={(e) =>
                        handleLineItemChange(item.key, {
                          quantity: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t("money.lineItemUnit")}
                    </label>
                    <Input
                      value={item.unit}
                      onChange={(e) => handleLineItemChange(item.key, { unit: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t("money.lineItemStatus")}
                    </label>
                    <Select
                      value={item.line_status}
                      onValueChange={(value) =>
                        handleLineItemChange(item.key, {
                          line_status: value as MoneyLineStatus,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("money.lineItemStatus")} />
                      </SelectTrigger>
                      <SelectContent>
                        {MONEY_LINE_STATUSES.map((statusItem) => (
                          <SelectItem key={statusItem} value={statusItem}>
                            {t(
                              `money.lineStatus${
                                statusItem.charAt(0).toUpperCase() + statusItem.slice(1)
                              }`,
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t("money.lineItemCategory")}
                    </label>
                    <Popover
                      open={openCategoryKey === item.key}
                      onOpenChange={(open) => setOpenCategoryKey(open ? item.key : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={openCategoryKey === item.key}
                          className={cn(
                            "h-9 w-full justify-between font-normal text-sm",
                            !item.category_id && "text-muted-foreground",
                          )}
                        >
                          <span className="truncate">
                            {item.category_id
                              ? (() => {
                                  const cat = categoryOptions.find(
                                    (c) => c.id === item.category_id,
                                  );
                                  return cat
                                    ? `${cat.name_en} / ${cat.name_ru}`
                                    : t("money.categoryUnassigned");
                                })()
                              : t("money.categoryUnassigned")}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput placeholder={t("money.searchCategory")} className="h-9" />
                          <CommandList>
                            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value={t("money.categoryUnassigned")}
                                onSelect={() => {
                                  handleLineItemChange(item.key, {
                                    category_id: null,
                                  });
                                  setOpenCategoryKey(null);
                                }}
                              >
                                {t("money.categoryUnassigned")}
                              </CommandItem>
                              {categoryOptions.map((category) => (
                                <CommandItem
                                  key={category.id}
                                  value={`${category.name_en} ${category.name_ru}`}
                                  onSelect={() => {
                                    handleLineItemChange(item.key, {
                                      category_id: category.id,
                                    });
                                    setOpenCategoryKey(null);
                                  }}
                                >
                                  {category.name_en} / {category.name_ru}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t("money.lineItemBeneficiary")}
                    </label>
                    <Select
                      value={item.beneficiary_person_id ?? "unassigned"}
                      onValueChange={(value) =>
                        handleLineItemChange(item.key, {
                          beneficiary_person_id: value === "unassigned" ? null : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("money.beneficiaryUnassigned")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">
                          {t("money.beneficiaryUnassigned")}
                        </SelectItem>
                        {persons.map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            {person.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("money.lineItemsTotal")}</span>
          <span className={showMismatch ? "text-amber-600 dark:text-amber-400" : ""}>
            {new Intl.NumberFormat(intlLocale, {
              style: "currency",
              currency: currency || "RUB",
              maximumFractionDigits: 2,
            }).format(totalLineItems)}
          </span>
        </div>
        {showMismatch && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("money.lineItemsMismatch")}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onCancel} type="button" disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? t("money.saveTransaction") : t("money.updateTransaction")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, ChevronsUpDown, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateMoneyCategoryRule,
  useMoneyAccounts,
  useMoneyCategories,
  useMoneyCategoryRules,
  useMoneyTransaction,
  useMoneyTransactions,
  usePersons,
  usePreviewMoneyCategoryRulePipeline,
  useUpdateMoneyCategoryRule,
} from "@/hooks";
import { useIntlLocale } from "@/lib/date-locale";
import {
  describeMoneyCategoryPipelineError,
  translateOrFallback,
} from "@/lib/money-category-pipeline-ui";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import type {
  CreateMoneyCategoryRuleInput,
  MoneyCategoryRule,
  MoneyCategoryRuleFilterOperator,
  MoneyCategoryRuleRun,
  MoneyCategoryRuleScopeFilter,
  MoneyLineItem,
  UpdateMoneyCategoryRuleInput,
} from "@/types";
import { callMoneyCategorizeAction } from "@/lib/money-categorize-client";
import {
  emptyRuleForm,
  RULE_FILTER_FIELDS,
  RULE_FILTER_OPERATORS,
  ruleCategoryLabel,
  ruleFilterDraft,
  ruleFormOf,
  ruleFormProblem,
  ruleNumberInput,
  rulePayload,
  type MoneyLlmProvider,
  type RuleForm,
} from "@/types/money-rules";
import {
  MONEY_CATEGORY_RULE_KINDS,
  MONEY_CATEGORY_RULE_MATCH_MODES,
  MONEY_CATEGORY_RULE_SCOPE_FILTERS,
} from "@/types";

type LlmProviderStatus = {
  jev: { configured: boolean };
  openrouter: { configured: boolean };
  default_provider: MoneyLlmProvider;
};

interface MoneyRuleEditorProps {
  mode: "create" | "edit";
  rule?: MoneyCategoryRule | null;
  initialExampleTransactionId?: string | null;
  initialExampleLineItemId?: string | null;
  autoRunExample?: boolean;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function closePopover(setter: React.Dispatch<React.SetStateAction<boolean>>, open: boolean) {
  setter(open);
}

export function MoneyRuleEditor({
  mode,
  rule,
  initialExampleTransactionId = null,
  initialExampleLineItemId = null,
  autoRunExample = false,
}: MoneyRuleEditorProps) {
  const t = useTranslations();
  const router = useRouter();
  const intlLocale = useIntlLocale();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const personId = rule?.person_id ?? selectedPersonId;
  const createRuleMutation = useCreateMoneyCategoryRule();
  const updateRuleMutation = useUpdateMoneyCategoryRule();
  const previewMutation = usePreviewMoneyCategoryRulePipeline();
  const { data: persons } = usePersons();
  const { data: accounts } = useMoneyAccounts(personId);
  const { data: categories } = useMoneyCategories();
  const { data: rules } = useMoneyCategoryRules(personId);
  const { data: transactions } = useMoneyTransactions(personId);

  const [form, setForm] = useState<RuleForm>(() => (rule ? ruleFormOf(rule) : emptyRuleForm()));
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [previewRun, setPreviewRun] = useState<MoneyCategoryRuleRun | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [llmProviderStatus, setLlmProviderStatus] = useState<LlmProviderStatus | null>(null);
  const [llmProviderStatusError, setLlmProviderStatusError] = useState<string | null>(null);
  const [transactionPickerOpen, setTransactionPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [fallbackPickerOpen, setFallbackPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exampleTransactionId, setExampleTransactionId] = useState<string | null>(
    initialExampleTransactionId,
  );
  const [exampleLineItemId, setExampleLineItemId] = useState<string | null>(
    initialExampleLineItemId,
  );
  const autoRunHandledRef = useRef(false);
  const previousRuleIdRef = useRef<string | null>(rule?.id ?? null);

  const { data: exampleTransaction, isLoading: exampleTransactionLoading } =
    useMoneyTransaction(exampleTransactionId);

  useEffect(() => {
    const nextRuleId = rule?.id ?? null;
    const didRuleIdentityChange = previousRuleIdRef.current !== nextRuleId;

    setForm(rule ? ruleFormOf(rule) : emptyRuleForm());
    setHasLocalChanges(false);
    setPreviewRun(null);
    setPreviewError(null);

    if (didRuleIdentityChange) {
      autoRunHandledRef.current = false;
      previousRuleIdRef.current = nextRuleId;
    }
  }, [mode, rule]);

  useEffect(() => {
    setExampleTransactionId(initialExampleTransactionId);
  }, [initialExampleTransactionId]);

  useEffect(() => {
    setExampleLineItemId(initialExampleLineItemId);
  }, [initialExampleLineItemId]);

  useEffect(() => {
    if (form.ruleKind !== "llm_categorization") return;
    let cancelled = false;
    void callMoneyCategorizeAction<LlmProviderStatus>({ action: "llm_provider_status" })
      .then((status) => {
        if (cancelled) return;
        setLlmProviderStatus(status);
        setLlmProviderStatusError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLlmProviderStatus(null);
        setLlmProviderStatusError(describeMoneyCategoryPipelineError(error, t));
      });
    return () => {
      cancelled = true;
    };
  }, [form.ruleKind, t]);

  useEffect(() => {
    if (!exampleTransactionId || !exampleTransaction?.line_items?.length) return;

    const existingLineItem = exampleTransaction.line_items.find(
      (item) => item.id === exampleLineItemId,
    );
    if (!existingLineItem) {
      setExampleLineItemId(exampleTransaction.line_items[0]?.id ?? null);
    }
  }, [exampleTransaction, exampleLineItemId, exampleTransactionId]);

  const selectedExampleLineItem = useMemo(
    () => exampleTransaction?.line_items?.find((item) => item.id === exampleLineItemId) ?? null,
    [exampleLineItemId, exampleTransaction],
  );

  useEffect(() => {
    if (!exampleLineItemId || selectedExampleLineItem) {
      setPreviewError(null);
    }
  }, [exampleLineItemId, selectedExampleLineItem]);

  const sortedCategories = useMemo(
    () =>
      [...(categories ?? [])].sort(
        (left, right) =>
          left.depth - right.depth ||
          left.sort_order - right.sort_order ||
          left.name_en.localeCompare(right.name_en),
      ),
    [categories],
  );

  const categoryById = useMemo(
    () => new Map(sortedCategories.map((category) => [category.id, category])),
    [sortedCategories],
  );

  const personNameById = useMemo(
    () => new Map((persons ?? []).map((person) => [person.id, person.name])),
    [persons],
  );

  const accountById = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.id, account])),
    [accounts],
  );

  const canonicalOptions = useMemo(
    () =>
      sortedCategories.filter(
        (category) => category.category_kind === "canonical" && Boolean(category.system_key),
      ),
    [sortedCategories],
  );

  const transactionOptions = useMemo(
    () =>
      (transactions ?? []).map((transaction) => {
        const merchant = transaction.merchant_name || t("money.transactionFallback");
        const postedDate = transaction.posted_at ? new Date(transaction.posted_at) : null;
        const postedAt =
          postedDate && !Number.isNaN(postedDate.getTime())
            ? new Intl.DateTimeFormat(intlLocale, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }).format(postedDate)
            : "";
        const amount = formatMoney(transaction.amount, transaction.currency, intlLocale);
        return {
          id: transaction.id,
          label: postedAt ? `${merchant} - ${amount} - ${postedAt}` : `${merchant} - ${amount}`,
          description: transaction.comment ?? transaction.source_category_name ?? transaction.id,
        };
      }),
    [intlLocale, t, transactions],
  );

  const selectedPersonName = personId ? personNameById.get(personId) : null;
  const isSaving = createRuleMutation.isPending || updateRuleMutation.isPending;
  const isPreviewing = previewMutation.isPending;
  const isBusy = isSaving || isPreviewing;

  const updateForm = (updater: (current: RuleForm) => RuleForm) => {
    setForm((current) => updater(current));
    setHasLocalChanges(true);
  };

  const getCategoryLabelById = (categoryId: string | null | undefined) => {
    if (!categoryId) return t("money.categoryUnassigned");
    const category = categoryById.get(categoryId);
    return category ? ruleCategoryLabel(category) : categoryId;
  };

  const getCurrentCanonicalSystemKey = (lineItem: MoneyLineItem | null) => {
    if (!lineItem?.category_id) return "--";
    const category = categoryById.get(lineItem.category_id);
    if (!category) return lineItem.category_id;
    const canonicalCategory = categoryById.get(category.canonical_category_id);
    return canonicalCategory?.system_key ?? category.system_key ?? category.canonical_category_id;
  };

  const getExampleFieldValue = (field: string) => {
    if (!selectedExampleLineItem || !exampleTransaction) return "--";

    switch (field) {
      case "line_item_title":
        return selectedExampleLineItem.title || "--";
      case "merchant_name":
        return exampleTransaction.merchant_name || "--";
      case "transaction_comment":
        return exampleTransaction.comment || "--";
      case "source_comment":
        return exampleTransaction.source_comment || "--";
      case "source":
        return exampleTransaction.source || "--";
      case "source_category_id":
        return exampleTransaction.source_category_id || "--";
      case "source_category_name":
        return exampleTransaction.source_category_name || "--";
      case "mcc":
        return exampleTransaction.mcc || "--";
      case "transaction_type":
        return exampleTransaction.transaction_type || "--";
      case "account_source":
        return accountById.get(exampleTransaction.account_id)?.source || "--";
      case "account_kind":
        return accountById.get(exampleTransaction.account_id)?.account_kind || "--";
      case "payer_person_id": {
        const name = personNameById.get(exampleTransaction.payer_person_id);
        return name
          ? `${name} (${exampleTransaction.payer_person_id})`
          : exampleTransaction.payer_person_id;
      }
      case "line_item_amount":
        return formatMoney(selectedExampleLineItem.amount, exampleTransaction.currency, intlLocale);
      case "transaction_amount":
        return formatMoney(exampleTransaction.amount, exampleTransaction.currency, intlLocale);
      case "current_category_id":
        return getCategoryLabelById(selectedExampleLineItem.category_id);
      case "canonical_branch_system_key":
        return getCurrentCanonicalSystemKey(selectedExampleLineItem);
      case "is_transfer":
        return exampleTransaction.is_transfer ? "true" : "false";
      default:
        return "--";
    }
  };

  const validateForm = () => {
    if (!personId) return false;
    const problem = ruleFormProblem(form);
    if (problem) {
      toast.error(
        t(
          problem === "name"
            ? "money.ruleValidationNameRequired"
            : problem === "target"
              ? "money.ruleValidationTargetRequired"
              : "money.ruleValidationRegexInvalid",
        ),
      );
      return false;
    }
    return true;
  };

  const runSingleRulePreview = useCallback(
    async (ruleId: string, lineItemId: string) => {
      try {
        const run = await previewMutation.mutateAsync({
          lineItemId,
          personId,
          ruleIds: [ruleId],
        });
        setPreviewRun(run);
        setPreviewError(null);
        setHasLocalChanges(false);
        return run;
      } catch (error) {
        setPreviewRun(null);
        setPreviewError(describeMoneyCategoryPipelineError(error, t));
        return null;
      }
    },
    [personId, previewMutation, t],
  );

  const handlePersistRule = async (previewAfterSave: boolean) => {
    if (!personId || !validateForm()) return;

    const payload = rulePayload(personId, form, rules ?? []);

    try {
      if (form.id) {
        await updateRuleMutation.mutateAsync({
          id: form.id,
          updates: payload as UpdateMoneyCategoryRuleInput,
        });
        setHasLocalChanges(false);

        if (previewAfterSave && exampleLineItemId) {
          await runSingleRulePreview(form.id, exampleLineItemId);
        }

        return;
      }

      const createdRule = await createRuleMutation.mutateAsync(
        payload as CreateMoneyCategoryRuleInput,
      );
      const nextSearchParams = new URLSearchParams();
      if (exampleTransactionId) nextSearchParams.set("exampleTransactionId", exampleTransactionId);
      if (exampleLineItemId) nextSearchParams.set("exampleLineItemId", exampleLineItemId);
      if (previewAfterSave && exampleLineItemId) {
        nextSearchParams.set("autorun", "1");
      }

      router.push(
        `/money/rules/${createdRule.id}/edit${nextSearchParams.size ? `?${nextSearchParams.toString()}` : ""}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    }
  };

  const handleRunExample = async () => {
    if (!exampleLineItemId) {
      toast.error(t("money.ruleExampleTransactionRequired"));
      return;
    }

    if (exampleTransactionId && !exampleTransactionLoading && !selectedExampleLineItem) {
      setPreviewRun(null);
      setPreviewError(
        translateOrFallback(
          t,
          "money.rulePipelineErrorMissingLineItem",
          "The selected line item is no longer available. Choose another line item and try again.",
        ),
      );
      return;
    }

    if (!form.id || hasLocalChanges) {
      await handlePersistRule(true);
      return;
    }

    await runSingleRulePreview(form.id, exampleLineItemId);
  };

  useEffect(() => {
    if (
      !autoRunExample ||
      autoRunHandledRef.current ||
      !form.id ||
      !selectedExampleLineItem ||
      exampleTransactionLoading ||
      hasLocalChanges
    ) {
      return;
    }

    autoRunHandledRef.current = true;
    void runSingleRulePreview(form.id, selectedExampleLineItem.id);
  }, [
    autoRunExample,
    exampleTransactionLoading,
    form.id,
    hasLocalChanges,
    runSingleRulePreview,
    selectedExampleLineItem,
  ]);

  const previewButtonLabel =
    !form.id || hasLocalChanges ? t("money.ruleCheckSaveAndRun") : t("money.ruleCheckAction");
  const headerTitle =
    mode === "edit" ? form.name.trim() || t("money.editRule") : t("money.addRule");

  if (!personId) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  const startingCategoryId = selectedExampleLineItem?.category_id ?? null;
  const finalCategoryId = previewRun?.final_category_id ?? null;
  const whyText = previewRun?.steps?.[0]?.decision_reason ?? null;

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-20 -mx-1 border-b border-border/60 bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild>
            <Link href="/money/rules" aria-label={t("common.back")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">{headerTitle}</h1>
            {selectedPersonName ? (
              <Badge variant="secondary" className="mt-1 font-normal">
                {selectedPersonName}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
              <Checkbox
                id="rule-enabled-header"
                checked={form.enabled}
                onCheckedChange={(checked) =>
                  updateForm((current) => ({ ...current, enabled: checked === true }))
                }
              />
              <span>{t("money.ruleEnabled")}</span>
            </label>
            <Button variant="ghost" asChild>
              <Link href="/money/rules">{t("common.cancel")}</Link>
            </Button>
            <Button type="button" onClick={() => void handlePersistRule(false)} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <div className="space-y-8">
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-foreground/80">
                {t("money.ruleSectionBasics")}
              </h2>
            </div>

            <Field label={t("money.ruleName")}>
              <Input
                aria-label={t("money.ruleName")}
                value={form.name}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("money.ruleKind")}</Label>
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label={t("money.ruleKind")}
              >
                {MONEY_CATEGORY_RULE_KINDS.map((kind) => {
                  const selected = form.ruleKind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left transition-colors",
                        selected
                          ? "border-foreground/30 bg-muted/50 shadow-sm"
                          : "hover:bg-muted/30",
                      )}
                      onClick={() =>
                        updateForm((current) => ({
                          ...current,
                          ruleKind: kind,
                          targetCategoryId: kind === "direct" ? current.targetCategoryId : "",
                          llmProvider:
                            kind === "llm_categorization" &&
                            current.ruleKind !== "llm_categorization"
                              ? "jev"
                              : current.llmProvider,
                        }))
                      }
                    >
                      <p className="text-sm font-medium">{t(`money.ruleKind${kind}`)}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t(`money.ruleKindTip${kind}`)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.ruleKind === "direct" ? (
              <Field label={t("money.ruleTargetCategory")}>
                <Popover open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen}>
                  <PopoverAnchor asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between"
                      aria-label={t("money.ruleTargetCategory")}
                      aria-expanded={categoryPickerOpen}
                      onClick={() => setCategoryPickerOpen((open) => !open)}
                    >
                      <span className="truncate">
                        {form.targetCategoryId
                          ? getCategoryLabelById(form.targetCategoryId)
                          : t("money.ruleTargetCategoryPlaceholder")}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverAnchor>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                    onEscapeKeyDown={() => closePopover(setCategoryPickerOpen, false)}
                    onFocusOutside={() => closePopover(setCategoryPickerOpen, false)}
                    onPointerDownOutside={() => closePopover(setCategoryPickerOpen, false)}
                  >
                    <Command>
                      <CommandInput placeholder={t("money.ruleSearchCategories")} />
                      <CommandList className="max-h-64">
                        <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                        <CommandGroup>
                          {sortedCategories.map((category) => (
                            <CommandItem
                              key={category.id}
                              value={`${category.name_en} ${category.name_ru} ${category.system_key ?? ""}`}
                              onSelect={() => {
                                updateForm((current) => ({
                                  ...current,
                                  targetCategoryId: category.id,
                                }));
                                setCategoryPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.targetCategoryId === category.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="truncate">{ruleCategoryLabel(category)}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </Field>
            ) : null}

            {form.ruleKind === "fallback_uncategorized" ? (
              <Field label={t("money.ruleFallbackTarget")}>
                <Popover open={fallbackPickerOpen} onOpenChange={setFallbackPickerOpen}>
                  <PopoverAnchor asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between"
                      aria-label={t("money.ruleFallbackTarget")}
                      aria-expanded={fallbackPickerOpen}
                      onClick={() => setFallbackPickerOpen((open) => !open)}
                    >
                      <span className="truncate">
                        {form.fallbackSystemKey
                          ? (canonicalOptions.find(
                              (option) => option.system_key === form.fallbackSystemKey,
                            )?.name_en ?? form.fallbackSystemKey)
                          : t("money.ruleFallbackTargetPlaceholder")}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverAnchor>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                    onEscapeKeyDown={() => closePopover(setFallbackPickerOpen, false)}
                    onFocusOutside={() => closePopover(setFallbackPickerOpen, false)}
                    onPointerDownOutside={() => closePopover(setFallbackPickerOpen, false)}
                  >
                    <Command>
                      <CommandInput placeholder={t("money.ruleSearchCategories")} />
                      <CommandList className="max-h-64">
                        <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                        <CommandGroup>
                          {canonicalOptions.map((category) => (
                            <CommandItem
                              key={category.id}
                              value={`${category.name_en} ${category.name_ru} ${category.system_key ?? ""}`}
                              onSelect={() => {
                                updateForm((current) => ({
                                  ...current,
                                  fallbackSystemKey: category.system_key ?? "uncategorized",
                                }));
                                setFallbackPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.fallbackSystemKey === category.system_key
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="truncate">{ruleCategoryLabel(category)}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </Field>
            ) : null}

            {form.ruleKind === "llm_categorization" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("money.ruleLlmProvider")}</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        [
                          "jev",
                          t("money.ruleLlmProviderJev"),
                          t("money.ruleLlmProviderJevBlurb"),
                          true,
                        ],
                        [
                          "openrouter",
                          t("money.ruleLlmProviderOpenRouter"),
                          t("money.ruleLlmProviderOpenRouterBlurb"),
                          false,
                        ],
                      ] as const
                    ).map(([value, title, blurb, recommended]) => {
                      const selected = form.llmProvider === value;
                      const configured = llmProviderStatus?.[value]?.configured;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={cn(
                            "rounded-xl border px-3 py-3 text-left transition-colors",
                            selected
                              ? "border-foreground/30 bg-muted/50 shadow-sm"
                              : "hover:bg-muted/30",
                          )}
                          onClick={() =>
                            updateForm((current) => ({
                              ...current,
                              llmProvider: value,
                            }))
                          }
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{title}</p>
                            {recommended ? (
                              <Badge variant="secondary" className="font-normal">
                                {t("money.ruleLlmProviderRecommended")}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{blurb}</p>
                          {llmProviderStatus ? (
                            <p
                              className={cn(
                                "mt-2 text-xs",
                                configured ? "text-emerald-700" : "text-amber-800",
                              )}
                            >
                              {configured
                                ? t("money.ruleLlmProviderReady")
                                : t("money.ruleLlmProviderNeedsSetup")}
                            </p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {llmProviderStatusError ? (
                    <Alert>
                      <AlertTitle>{t("common.error")}</AlertTitle>
                      <AlertDescription>{llmProviderStatusError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {llmProviderStatus && !llmProviderStatus[form.llmProvider].configured ? (
                    <p className="text-xs text-amber-800">{t("money.ruleLlmProviderNeedsSetup")}</p>
                  ) : null}
                </div>

                <Field label={t("money.rulePrompt")}>
                  <Textarea
                    aria-label={t("money.rulePrompt")}
                    value={form.prompt}
                    placeholder={t("money.rulePromptPlaceholder")}
                    className="min-h-[88px]"
                    onChange={(event) =>
                      updateForm((current) => ({ ...current, prompt: event.target.value }))
                    }
                  />
                </Field>
              </div>
            ) : null}
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-foreground/80">
                  {t("money.ruleSectionWhen")}
                </h2>
              </div>
            </div>

            <Field label={t("money.ruleScopeFilter")}>
              <Select
                value={form.scopeFilter}
                onValueChange={(value) =>
                  updateForm((current) => ({
                    ...current,
                    scopeFilter: value as MoneyCategoryRuleScopeFilter,
                  }))
                }
              >
                <SelectTrigger aria-label={t("money.ruleScopeFilter")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONEY_CATEGORY_RULE_SCOPE_FILTERS.map((scopeFilter) => (
                    <SelectItem key={scopeFilter} value={scopeFilter}>
                      {t(`money.ruleScope${scopeFilter}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium">{t("money.ruleFilters")}</h3>
                  <div className="inline-flex rounded-lg border p-0.5">
                    {MONEY_CATEGORY_RULE_MATCH_MODES.map((matchMode) => (
                      <button
                        key={matchMode}
                        type="button"
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs transition-colors",
                          form.matchMode === matchMode
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() =>
                          updateForm((current) => ({
                            ...current,
                            matchMode,
                          }))
                        }
                      >
                        {t(`money.ruleMatch${matchMode}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateForm((current) => ({
                      ...current,
                      filters: [...current.filters, ruleFilterDraft()],
                    }))
                  }
                >
                  {t("money.ruleAddFilter")}
                </Button>
              </div>

              {form.filters.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("money.ruleNoFiltersHint")}</p>
              ) : null}

              <div className="space-y-2">
                {form.filters.map((filter) => (
                  <div
                    key={filter.id}
                    data-testid="rule-filter-row"
                    className="rounded-xl border px-3 py-3"
                  >
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                      <Select
                        value={filter.field}
                        onValueChange={(value) =>
                          updateForm((current) => ({
                            ...current,
                            filters: current.filters.map((item) =>
                              item.id === filter.id ? { ...item, field: value } : item,
                            ),
                          }))
                        }
                      >
                        <SelectTrigger aria-label={t("money.ruleFilterField")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_FILTER_FIELDS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={filter.operator}
                        onValueChange={(value) =>
                          updateForm((current) => ({
                            ...current,
                            filters: current.filters.map((item) =>
                              item.id === filter.id
                                ? { ...item, operator: value as MoneyCategoryRuleFilterOperator }
                                : item,
                            ),
                          }))
                        }
                      >
                        <SelectTrigger aria-label={t("money.ruleFilterOperator")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_FILTER_OPERATORS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {filter.operator === "contains_any_in_set" ||
                      filter.operator === "equals_any_in_set" ? (
                        <Input
                          aria-label={t("money.ruleFilterValues")}
                          value={filter.values}
                          onChange={(event) =>
                            updateForm((current) => ({
                              ...current,
                              filters: current.filters.map((item) =>
                                item.id === filter.id
                                  ? { ...item, values: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                        />
                      ) : filter.operator === "range" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            aria-label={t("money.ruleFilterMin")}
                            inputMode="decimal"
                            value={filter.min}
                            onChange={(event) =>
                              updateForm((current) => ({
                                ...current,
                                filters: current.filters.map((item) =>
                                  item.id === filter.id
                                    ? { ...item, min: ruleNumberInput(event.target.value) }
                                    : item,
                                ),
                              }))
                            }
                          />
                          <Input
                            aria-label={t("money.ruleFilterMax")}
                            inputMode="decimal"
                            value={filter.max}
                            onChange={(event) =>
                              updateForm((current) => ({
                                ...current,
                                filters: current.filters.map((item) =>
                                  item.id === filter.id
                                    ? { ...item, max: ruleNumberInput(event.target.value) }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </div>
                      ) : filter.operator === "is_empty" || filter.operator === "is_not_empty" ? (
                        <div />
                      ) : (
                        <Input
                          aria-label={t("money.ruleFilterValue")}
                          value={filter.value}
                          onChange={(event) =>
                            updateForm((current) => ({
                              ...current,
                              filters: current.filters.map((item) =>
                                item.id === filter.id
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                        />
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="justify-self-end"
                        onClick={() =>
                          updateForm((current) => ({
                            ...current,
                            filters: current.filters.filter((item) => item.id !== filter.id),
                          }))
                        }
                      >
                        {t("money.ruleRemoveFilter")}
                      </Button>
                    </div>
                    <div className="mt-2">
                      <Badge variant="outline" className="font-normal">
                        {t("money.ruleExampleValue")}: {getExampleFieldValue(filter.field)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm font-semibold tracking-wide text-foreground/80"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span>{t("money.ruleSectionMore")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {moreOpen ? t("money.ruleSectionMoreHide") : t("money.ruleSectionMoreShow")}
              </span>
            </button>
            {moreOpen ? (
              <div className="space-y-4">
                <Field label={t("money.ruleDescription")} hint={t("money.ruleDescriptionHint")}>
                  <Textarea
                    value={form.description}
                    className="min-h-[72px]"
                    onChange={(event) =>
                      updateForm((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </Field>
                <label className="flex items-start gap-3 rounded-xl border px-3 py-3">
                  <Checkbox
                    id="rule-stop-processing"
                    checked={form.stopProcessing}
                    onCheckedChange={(checked) =>
                      updateForm((current) => ({
                        ...current,
                        stopProcessing: checked === true,
                      }))
                    }
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {t("money.ruleStopProcessing")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("money.ruleStopProcessingHint")}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <div className="space-y-4 rounded-2xl border bg-card/40 p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{t("money.ruleCheckTitle")}</h2>
              <p className="text-xs leading-5 text-muted-foreground">{t("money.ruleCheckHint")}</p>
            </div>

            <Popover open={transactionPickerOpen} onOpenChange={setTransactionPickerOpen}>
              <PopoverAnchor asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  aria-label={t("money.ruleExampleTransaction")}
                  aria-expanded={transactionPickerOpen}
                  onClick={() => setTransactionPickerOpen((open) => !open)}
                >
                  <span className="truncate">
                    {exampleTransactionId
                      ? (transactionOptions.find((option) => option.id === exampleTransactionId)
                          ?.label ?? exampleTransactionId)
                      : t("money.ruleExampleTransactionPlaceholder")}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverAnchor>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
                onEscapeKeyDown={() => closePopover(setTransactionPickerOpen, false)}
                onFocusOutside={() => closePopover(setTransactionPickerOpen, false)}
                onPointerDownOutside={() => closePopover(setTransactionPickerOpen, false)}
              >
                <Command>
                  <CommandInput placeholder={t("money.searchTransactions")} />
                  <CommandList className="max-h-72">
                    <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                    <CommandGroup>
                      {transactionOptions.map((option) => (
                        <CommandItem
                          key={option.id}
                          value={`${option.label} ${option.description}`}
                          onSelect={() => {
                            setExampleTransactionId(option.id);
                            setTransactionPickerOpen(false);
                            setPreviewRun(null);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              exampleTransactionId === option.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <div className="min-w-0">
                            <p className="truncate">{option.label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {option.description}
                            </p>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {exampleTransactionLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : null}

            {exampleTransactionId && selectedExampleLineItem && exampleTransaction ? (
              <div className="rounded-xl border bg-background px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {exampleTransaction.merchant_name || t("money.transactionFallback")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedExampleLineItem.title}
                    </p>
                    {exampleTransaction.posted_at &&
                    !Number.isNaN(new Date(exampleTransaction.posted_at).getTime()) ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(intlLocale, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }).format(new Date(exampleTransaction.posted_at))}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant="outline">
                    {formatMoney(
                      selectedExampleLineItem.amount,
                      exampleTransaction.currency,
                      intlLocale,
                    )}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {getCategoryLabelById(selectedExampleLineItem.category_id)}
                </p>
              </div>
            ) : null}

            {exampleTransaction?.line_items && exampleTransaction.line_items.length > 1 ? (
              <div className="space-y-2">
                <Label className="text-xs">{t("money.ruleExampleLineItem")}</Label>
                <div className="space-y-1.5">
                  {exampleTransaction.line_items.map((lineItem) => {
                    const isSelected = lineItem.id === exampleLineItemId;
                    return (
                      <button
                        key={lineItem.id}
                        type="button"
                        className={cn(
                          "w-full rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                          isSelected ? "border-foreground/30 bg-muted/40" : "hover:bg-muted/30",
                        )}
                        onClick={() => {
                          setExampleLineItemId(lineItem.id);
                          setPreviewRun(null);
                          autoRunHandledRef.current = false;
                        }}
                      >
                        <span className="truncate font-medium">{lineItem.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : exampleTransactionId && !exampleTransactionLoading && !selectedExampleLineItem ? (
              <p className="text-sm text-muted-foreground">{t("money.ruleExampleNoLineItems")}</p>
            ) : null}

            {!form.id && exampleLineItemId ? (
              <p className="text-xs text-muted-foreground">{t("money.ruleExampleCreateTipBody")}</p>
            ) : null}
            {form.id && hasLocalChanges && exampleLineItemId ? (
              <p className="text-xs text-muted-foreground">{t("money.ruleExampleDirtyTipBody")}</p>
            ) : null}

            <Button
              type="button"
              className="w-full"
              onClick={() => void handleRunExample()}
              disabled={!exampleLineItemId || isBusy}
            >
              {isPreviewing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {previewButtonLabel}
            </Button>

            <div className="space-y-3 border-t pt-3">
              <h3 className="text-sm font-medium">{t("money.rulePreviewResult")}</h3>
              {previewError ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    {translateOrFallback(t, "money.rulePreviewErrorTitle", "Preview unavailable")}
                  </AlertTitle>
                  <AlertDescription>{previewError}</AlertDescription>
                </Alert>
              ) : previewRun ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="rounded-lg border px-2.5 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t("money.ruleBefore")}
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {getCategoryLabelById(startingCategoryId)}
                      </p>
                    </div>
                    <span className="text-muted-foreground">→</span>
                    <div className="rounded-lg border px-2.5 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t("money.ruleAfter")}
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {getCategoryLabelById(finalCategoryId)}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      previewRun.steps.some((s) => s.changed_category) ? "default" : "secondary"
                    }
                  >
                    {previewRun.steps.some((s) => s.changed_category)
                      ? t("money.ruleChangedCategory")
                      : t("money.ruleNoChange")}
                  </Badge>
                  {whyText ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{t("money.ruleWhy")}: </span>
                      {whyText}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("money.rulePreviewEmpty")}</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

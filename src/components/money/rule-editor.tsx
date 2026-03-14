"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Info, Loader2, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  MoneyCategory,
  MoneyCategoryRule,
  MoneyCategoryRuleFilter,
  MoneyCategoryRuleFilterOperator,
  MoneyCategoryRuleKind,
  MoneyCategoryRuleMatchMode,
  MoneyCategoryRuleRun,
  MoneyCategoryRuleScopeFilter,
  MoneyLineItem,
  UpdateMoneyCategoryRuleInput,
} from "@/types";
import {
  MONEY_CATEGORY_RULE_KINDS,
  MONEY_CATEGORY_RULE_MATCH_MODES,
  MONEY_CATEGORY_RULE_SCOPE_FILTERS,
} from "@/types";

interface EditableFilterDraft {
  id: string;
  field: string;
  operator: MoneyCategoryRuleFilterOperator;
  value: string;
  values: string;
  min: string;
  max: string;
}

interface RuleFormState {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  ruleKind: MoneyCategoryRuleKind;
  targetCategoryId: string;
  matchMode: MoneyCategoryRuleMatchMode;
  scopeFilter: MoneyCategoryRuleScopeFilter;
  stopProcessing: boolean;
  prompt: string;
  fallbackSystemKey: string;
  filters: EditableFilterDraft[];
}

interface MoneyRuleEditorProps {
  mode: "create" | "edit";
  rule?: MoneyCategoryRule | null;
  initialExampleTransactionId?: string | null;
  initialExampleLineItemId?: string | null;
  autoRunExample?: boolean;
}

const FILTER_FIELD_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "line_item_title", labelKey: "money.ruleFieldLineItemTitle" },
  { value: "merchant_name", labelKey: "money.ruleFieldMerchantName" },
  { value: "transaction_comment", labelKey: "money.ruleFieldTransactionComment" },
  { value: "source_comment", labelKey: "money.ruleFieldSourceComment" },
  { value: "source", labelKey: "money.ruleFieldSource" },
  { value: "source_category_id", labelKey: "money.ruleFieldSourceCategoryId" },
  { value: "source_category_name", labelKey: "money.ruleFieldSourceCategoryName" },
  { value: "mcc", labelKey: "money.ruleFieldMcc" },
  { value: "transaction_type", labelKey: "money.ruleFieldTransactionType" },
  { value: "account_source", labelKey: "money.ruleFieldAccountSource" },
  { value: "account_kind", labelKey: "money.ruleFieldAccountKind" },
  { value: "payer_person_id", labelKey: "money.ruleFieldPayerPerson" },
  { value: "line_item_amount", labelKey: "money.ruleFieldLineItemAmount" },
  { value: "transaction_amount", labelKey: "money.ruleFieldTransactionAmount" },
  { value: "current_category_id", labelKey: "money.ruleFieldCurrentCategory" },
  { value: "canonical_branch_system_key", labelKey: "money.ruleFieldCanonicalBranch" },
  { value: "is_transfer", labelKey: "money.ruleFieldTransferFlag" },
];

const FILTER_OPERATOR_OPTIONS: { value: MoneyCategoryRuleFilterOperator; labelKey: string }[] = [
  { value: "contains", labelKey: "money.ruleOperatorContains" },
  { value: "not_contains", labelKey: "money.ruleOperatorNotContains" },
  { value: "equals", labelKey: "money.ruleOperatorEquals" },
  { value: "starts_with", labelKey: "money.ruleOperatorStartsWith" },
  { value: "regex", labelKey: "money.ruleOperatorRegex" },
  { value: "contains_any_in_set", labelKey: "money.ruleOperatorContainsAnyOfSet" },
  { value: "equals_any_in_set", labelKey: "money.ruleOperatorEqualsAnyOfSet" },
  { value: "range", labelKey: "money.ruleOperatorRange" },
  { value: "is_empty", labelKey: "money.ruleOperatorIsEmpty" },
  { value: "is_not_empty", labelKey: "money.ruleOperatorIsNotEmpty" },
];

function normalizeDraftOperator(
  operator: MoneyCategoryRuleFilterOperator | undefined,
): MoneyCategoryRuleFilterOperator {
  if (operator === "in_set") return "equals_any_in_set";
  return operator ?? "contains";
}

function buildDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyFilterDraft(seed: Partial<EditableFilterDraft> = {}): EditableFilterDraft {
  return {
    id: seed.id ?? buildDraftId(),
    field: seed.field ?? "merchant_name",
    operator: normalizeDraftOperator(seed.operator),
    value: seed.value ?? "",
    values: seed.values ?? "",
    min: seed.min ?? "",
    max: seed.max ?? "",
  };
}

function filtersToDrafts(filters: MoneyCategoryRuleFilter[]): EditableFilterDraft[] {
  return filters.map((filter) =>
    createEmptyFilterDraft({
      field: filter.field,
      operator: filter.operator,
      value: filter.value == null ? "" : String(filter.value),
      values: Array.isArray(filter.values) ? filter.values.join(", ") : "",
      min: filter.min == null ? "" : String(filter.min),
      max: filter.max == null ? "" : String(filter.max),
    }),
  );
}

function normalizeFilters(filters: EditableFilterDraft[]): MoneyCategoryRuleFilter[] {
  return filters.reduce<MoneyCategoryRuleFilter[]>((accumulator, filter) => {
    const normalizedField = filter.field.trim();
    if (!normalizedField) return accumulator;

    const normalized: MoneyCategoryRuleFilter = {
      field: normalizedField,
      operator: filter.operator,
    };

    if (filter.operator === "contains_any_in_set" || filter.operator === "equals_any_in_set") {
      const values = filter.values
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length > 0) normalized.values = values;
    } else if (filter.operator === "range") {
      normalized.min = filter.min.trim() ? Number(filter.min) : null;
      normalized.max = filter.max.trim() ? Number(filter.max) : null;
    } else if (filter.operator !== "is_empty" && filter.operator !== "is_not_empty") {
      normalized.value = filter.value.trim();
    }

    accumulator.push(normalized);
    return accumulator;
  }, []);
}

function buildInitialFormState(): RuleFormState {
  return {
    id: null,
    name: "",
    description: "",
    enabled: true,
    ruleKind: "direct",
    targetCategoryId: "",
    matchMode: "all",
    scopeFilter: "all_line_items",
    stopProcessing: false,
    prompt: "",
    fallbackSystemKey: "uncategorized",
    filters: [],
  };
}

function toFormState(rule: MoneyCategoryRule): RuleFormState {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    enabled: rule.enabled,
    ruleKind: rule.rule_kind,
    targetCategoryId: rule.target_category_id ?? "",
    matchMode: rule.match_mode,
    scopeFilter: rule.scope_filter,
    stopProcessing: rule.stop_processing,
    prompt: typeof rule.config.prompt === "string" ? rule.config.prompt : "",
    fallbackSystemKey:
      typeof rule.config.target_system_key === "string"
        ? rule.config.target_system_key
        : "uncategorized",
    filters: filtersToDrafts(rule.filters),
  };
}

function buildRulePayload(
  selectedPersonId: string,
  form: RuleFormState,
  rules: MoneyCategoryRule[],
): CreateMoneyCategoryRuleInput | UpdateMoneyCategoryRuleInput {
  const config: Record<string, unknown> = {};

  if (form.ruleKind === "llm_categorization" && form.prompt.trim()) {
    config.prompt = form.prompt.trim();
  }

  if (form.ruleKind === "fallback_uncategorized") {
    config.target_system_key = form.fallbackSystemKey.trim() || "uncategorized";
  }

  const sharedFields = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    enabled: form.enabled,
    rule_kind: form.ruleKind,
    target_category_id: form.ruleKind === "direct" ? form.targetCategoryId || null : null,
    match_mode: form.matchMode,
    scope_filter: form.scopeFilter,
    filters: normalizeFilters(form.filters),
    config,
    stop_processing: form.stopProcessing,
  };

  if (form.id) {
    return sharedFields;
  }

  return {
    person_id: selectedPersonId,
    sort_order: rules.length + 1,
    ...sharedFields,
  };
}

function normalizeNumberInput(value: string): string {
  let normalized = value.replace(/[^\d.-]/g, "");
  normalized = normalized.replace(/(?!^)-/g, "");

  const dotIndex = normalized.indexOf(".");
  if (dotIndex !== -1) {
    normalized =
      normalized.slice(0, dotIndex + 1) + normalized.slice(dotIndex + 1).replace(/[.]/g, "");
  }

  return normalized;
}

function isSmartRuleKind(kind: MoneyCategoryRuleKind) {
  return kind !== "direct" && kind !== "fallback_uncategorized";
}

function buildCategoryLabel(category: MoneyCategory) {
  const systemKey = category.system_key ? ` (${category.system_key})` : "";
  return `${category.name_en} / ${category.name_ru}${systemKey}`;
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

function Tip({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs leading-5 text-muted-foreground">{body}</p>
        </div>
      </div>
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

  const [form, setForm] = useState<RuleFormState>(() =>
    rule ? toFormState(rule) : buildInitialFormState(),
  );
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [previewRun, setPreviewRun] = useState<MoneyCategoryRuleRun | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [transactionPickerOpen, setTransactionPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [fallbackPickerOpen, setFallbackPickerOpen] = useState(false);
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

    setForm(rule ? toFormState(rule) : buildInitialFormState());
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
    if (!exampleTransaction?.line_items?.length) return;

    const existingLineItem = exampleTransaction.line_items.find(
      (item) => item.id === exampleLineItemId,
    );
    if (!existingLineItem) {
      setExampleLineItemId(exampleTransaction.line_items[0]?.id ?? null);
    }
  }, [exampleTransaction, exampleLineItemId]);

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
        const postedAt = new Intl.DateTimeFormat(intlLocale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }).format(new Date(transaction.posted_at));
        const amount = formatMoney(transaction.amount, transaction.currency, intlLocale);
        return {
          id: transaction.id,
          label: `${merchant} - ${amount} - ${postedAt}`,
          description: transaction.comment ?? transaction.source_category_name ?? transaction.id,
        };
      }),
    [intlLocale, t, transactions],
  );

  const selectedPersonName = personId ? personNameById.get(personId) : null;
  const isSaving = createRuleMutation.isPending || updateRuleMutation.isPending;
  const isPreviewing = previewMutation.isPending;
  const isBusy = isSaving || isPreviewing;

  const updateForm = (updater: (current: RuleFormState) => RuleFormState) => {
    setForm((current) => updater(current));
    setHasLocalChanges(true);
  };

  const getCategoryLabelById = (categoryId: string | null | undefined) => {
    if (!categoryId) return t("money.categoryUnassigned");
    const category = categoryById.get(categoryId);
    return category ? buildCategoryLabel(category) : categoryId;
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

  const smartRuleTip = useMemo(() => {
    switch (form.ruleKind) {
      case "mcc_map":
        return t("money.ruleKindTipmcc_map");
      case "source_category_map":
        return t("money.ruleKindTipsource_category_map");
      case "llm_categorization":
        return t("money.ruleKindTipllm_categorization");
      case "fallback_uncategorized":
        return t("money.ruleKindTipfallback_uncategorized");
      default:
        return t("money.ruleKindTipdirect");
    }
  }, [form.ruleKind, t]);

  const scopeTip = useMemo(() => t(`money.ruleScopeTip${form.scopeFilter}`), [form.scopeFilter, t]);

  const validateForm = () => {
    if (!personId) return false;

    if (!form.name.trim()) {
      toast.error(t("money.ruleValidationNameRequired"));
      return false;
    }

    if (form.ruleKind === "direct" && !form.targetCategoryId) {
      toast.error(t("money.ruleValidationTargetRequired"));
      return false;
    }

    for (const filter of form.filters) {
      if (filter.operator === "regex" && filter.value.trim()) {
        try {
          void new RegExp(filter.value);
        } catch {
          toast.error(t("money.ruleValidationRegexInvalid"));
          return false;
        }
      }
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

    const payload = buildRulePayload(personId, form, rules ?? []);

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

  if (!personId) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>{mode === "edit" ? t("money.editRule") : t("money.addRule")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {selectedPersonName
                ? `${t("money.rulePerson")}: ${selectedPersonName}`
                : t("person.selectPrompt")}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("money.ruleName")}>
                <Input
                  aria-label={t("money.ruleName")}
                  value={form.name}
                  onChange={(event) =>
                    updateForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </Field>

              <Field label={t("money.ruleKind")} hint={t("money.ruleKindHint")}>
                <Select
                  value={form.ruleKind}
                  onValueChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      ruleKind: value as MoneyCategoryRuleKind,
                      targetCategoryId: value === "direct" ? current.targetCategoryId : "",
                    }))
                  }
                >
                  <SelectTrigger aria-label={t("money.ruleKind")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONEY_CATEGORY_RULE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`money.ruleKind${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="md:col-span-2">
                <Tip
                  title={
                    isSmartRuleKind(form.ruleKind)
                      ? t("money.ruleSmartTipTitle")
                      : t("money.ruleDirectTipTitle")
                  }
                  body={smartRuleTip}
                />
              </div>

              <div className="md:col-span-2">
                <Field label={t("money.ruleDescription")}>
                  <Textarea
                    value={form.description}
                    onChange={(event) =>
                      updateForm((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </Field>
              </div>

              {form.ruleKind === "direct" ? (
                <Field
                  label={t("money.ruleTargetCategory")}
                  hint={t("money.ruleTargetCategoryHint")}
                >
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
                                <span className="truncate">{buildCategoryLabel(category)}</span>
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
                <Field
                  label={t("money.ruleFallbackTarget")}
                  hint={t("money.ruleFallbackTargetHint")}
                >
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
                                <span className="truncate">{buildCategoryLabel(category)}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </Field>
              ) : null}

              <Field label={t("money.ruleMatchMode")} hint={t("money.ruleMatchModeHint")}>
                <Select
                  value={form.matchMode}
                  onValueChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      matchMode: value as MoneyCategoryRuleMatchMode,
                    }))
                  }
                >
                  <SelectTrigger aria-label={t("money.ruleMatchMode")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONEY_CATEGORY_RULE_MATCH_MODES.map((matchMode) => (
                      <SelectItem key={matchMode} value={matchMode}>
                        {t(`money.ruleMatch${matchMode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label={t("money.ruleScopeFilter")} hint={scopeTip}>
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
            </div>

            {form.ruleKind === "llm_categorization" ? (
              <Field label={t("money.rulePrompt")} hint={t("money.rulePromptHint")}>
                <Textarea
                  aria-label={t("money.rulePrompt")}
                  value={form.prompt}
                  onChange={(event) =>
                    updateForm((current) => ({ ...current, prompt: event.target.value }))
                  }
                />
              </Field>
            ) : null}

            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-sm font-medium">{t("money.ruleFilters")}</h2>
                  <p className="text-xs text-muted-foreground">{t("money.ruleFiltersHint")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateForm((current) => ({
                      ...current,
                      filters: [...current.filters, createEmptyFilterDraft()],
                    }))
                  }
                >
                  {t("money.ruleAddFilter")}
                </Button>
              </div>

              {form.filters.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t("money.ruleNoFiltersHint")}
                </div>
              ) : null}

              <div className="space-y-3">
                {form.filters.map((filter) => (
                  <div key={filter.id} className="rounded-xl border p-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field label={t("money.ruleFilterField")}>
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
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FILTER_FIELD_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {t(option.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field label={t("money.ruleFilterOperator")}>
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
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FILTER_OPERATOR_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {t(option.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>

                      {filter.operator === "contains_any_in_set" ||
                      filter.operator === "equals_any_in_set" ? (
                        <div className="lg:col-span-2">
                          <Field
                            label={t("money.ruleFilterValues")}
                            hint={
                              filter.operator === "contains_any_in_set"
                                ? t("money.ruleOperatorTipcontains_any_in_set")
                                : t("money.ruleOperatorTipequals_any_in_set")
                            }
                          >
                            <Input
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
                          </Field>
                        </div>
                      ) : null}

                      {filter.operator === "range" ? (
                        <>
                          <Field
                            label={t("money.ruleFilterMin")}
                            hint={t("money.ruleOperatorTiprange")}
                          >
                            <Input
                              inputMode="decimal"
                              value={filter.min}
                              onChange={(event) =>
                                updateForm((current) => ({
                                  ...current,
                                  filters: current.filters.map((item) =>
                                    item.id === filter.id
                                      ? { ...item, min: normalizeNumberInput(event.target.value) }
                                      : item,
                                  ),
                                }))
                              }
                            />
                          </Field>
                          <Field
                            label={t("money.ruleFilterMax")}
                            hint={t("money.ruleOperatorTiprange")}
                          >
                            <Input
                              inputMode="decimal"
                              value={filter.max}
                              onChange={(event) =>
                                updateForm((current) => ({
                                  ...current,
                                  filters: current.filters.map((item) =>
                                    item.id === filter.id
                                      ? { ...item, max: normalizeNumberInput(event.target.value) }
                                      : item,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        </>
                      ) : null}

                      {filter.operator !== "contains_any_in_set" &&
                      filter.operator !== "equals_any_in_set" &&
                      filter.operator !== "range" &&
                      filter.operator !== "is_empty" &&
                      filter.operator !== "is_not_empty" ? (
                        <div className="lg:col-span-2">
                          <Field
                            label={t("money.ruleFilterValue")}
                            hint={
                              filter.operator === "regex"
                                ? t("money.ruleOperatorTipregex")
                                : undefined
                            }
                          >
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
                          </Field>
                        </div>
                      ) : null}

                      <div className="lg:col-span-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {t("money.ruleExampleValue")}: {getExampleFieldValue(filter.field)}
                      </div>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="rule-enabled"
                    checked={form.enabled}
                    onCheckedChange={(checked) =>
                      updateForm((current) => ({ ...current, enabled: checked === true }))
                    }
                  />
                  <div className="space-y-1">
                    <Label htmlFor="rule-enabled">{t("money.ruleEnabled")}</Label>
                    <p className="text-xs text-muted-foreground">{t("money.ruleEnabledHint")}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="flex items-start gap-3">
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
                  <div className="space-y-1">
                    <Label htmlFor="rule-stop-processing">{t("money.ruleStopProcessing")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("money.ruleStopProcessingHint")}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" asChild>
                <Link href="/money/rules">{t("common.cancel")}</Link>
              </Button>
              <Button
                type="button"
                onClick={() => void handlePersistRule(false)}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("common.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>{t("money.ruleExampleTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("money.ruleExampleHint")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label={t("money.ruleExampleTransaction")}>
              <Popover open={transactionPickerOpen} onOpenChange={setTransactionPickerOpen}>
                <PopoverAnchor asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
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
            </Field>

            {exampleTransactionLoading ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : null}

            {exampleTransaction?.line_items?.length ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>{t("money.ruleExampleLineItem")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("money.ruleExampleLineItemHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  {exampleTransaction.line_items.map((lineItem) => {
                    const isSelected = lineItem.id === exampleLineItemId;
                    return (
                      <button
                        key={lineItem.id}
                        type="button"
                        className={cn(
                          "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                          isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                        )}
                        onClick={() => {
                          setExampleLineItemId(lineItem.id);
                          setPreviewRun(null);
                          autoRunHandledRef.current = false;
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{lineItem.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {getCategoryLabelById(lineItem.category_id)}
                            </p>
                          </div>
                          <Badge variant={isSelected ? "default" : "outline"}>
                            {formatMoney(lineItem.amount, exampleTransaction.currency, intlLocale)}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : exampleTransactionId && !exampleTransactionLoading ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t("money.ruleExampleNoLineItems")}
              </div>
            ) : null}

            {!form.id && exampleLineItemId ? (
              <Tip
                title={t("money.ruleExampleCreateTipTitle")}
                body={t("money.ruleExampleCreateTipBody")}
              />
            ) : null}

            {form.id && hasLocalChanges && exampleLineItemId ? (
              <Tip
                title={t("money.ruleExampleDirtyTipTitle")}
                body={t("money.ruleExampleDirtyTipBody")}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <CardTitle>{t("money.rulePreviewResult")}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("money.rulePreviewSingleRuleHint")}
                </p>
              </div>
              {exampleLineItemId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleRunExample()}
                  disabled={isBusy}
                >
                  {isPreviewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : form.ruleKind === "llm_categorization" ? (
                    <Play className="mr-2 h-4 w-4" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {form.id && form.ruleKind === "llm_categorization"
                    ? t("money.ruleRunExample")
                    : t("money.ruleSaveAndPreviewExample")}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {previewError ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {translateOrFallback(t, "money.rulePreviewErrorTitle", "Preview unavailable")}
                </AlertTitle>
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            ) : previewRun ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {t("money.ruleTriggerSource")}: {previewRun.trigger_source}
                  </Badge>
                  <Badge variant={previewRun.final_category_id ? "default" : "secondary"}>
                    {getCategoryLabelById(previewRun.final_category_id)}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {previewRun.steps.map((step) => (
                    <div
                      key={`${step.rule_id}-${step.sort_order}`}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {step.rule_name ?? t(`money.ruleKind${step.rule_kind}`)}
                        </span>
                        <Badge variant="outline">{t(`money.ruleKind${step.rule_kind}`)}</Badge>
                        <Badge variant={step.changed_category ? "default" : "secondary"}>
                          {step.changed_category
                            ? t("money.ruleChangedCategory")
                            : t("money.ruleNoChange")}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{step.decision_reason}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("money.rulePreviewEmpty")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

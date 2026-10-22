import {
  MONEY_CATEGORY_RULE_KINDS,
  MONEY_CATEGORY_RULE_MATCH_MODES,
  MONEY_CATEGORY_RULE_SCOPE_FILTERS,
  type MoneyCategory,
  type MoneyCategoryRule,
  type MoneyCategoryRuleFilterOperator,
} from "@orbit-types/money";
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
  type RuleFilterDraft,
  type RuleForm,
} from "@orbit-types/money-rules";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useChangeRules, useMoneyCategories, useMoneyRules, usePerson } from "@/lib/queries";
import { Sheet } from "@/screens/account-forms-screen";
import { categoryOptions } from "@/screens/transaction-form-screen";
import { radius, space, usePalette } from "@/theme";

const PROBLEMS = {
  name: "money.ruleValidationNameRequired",
  target: "money.ruleValidationTargetRequired",
  regex: "money.ruleValidationRegexInvalid",
} as const;

const SET_OPERATORS = new Set(["contains_any_in_set", "equals_any_in_set"]);

/** A category rule, new or being edited by `?id=` — the web rule editor, without its example run. */
export default function MoneyRuleFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const person = usePerson();
  const rules = useMoneyRules(person.data?.id);
  const categories = useMoneyCategories();
  const rule = id ? rules.data?.find((one) => one.id === id) : undefined;
  if (person.data && rules.data && categories.data && (!id || rule)) {
    return (
      <RuleFormSheet
        personId={person.data.id}
        rules={rules.data}
        categories={categories.data}
        initial={rule ? ruleFormOf(rule) : emptyRuleForm()}
      />
    );
  }
  const busy = person.isPending || rules.isPending || categories.isPending;
  return (
    <>
      <Stack.Screen options={{ title: t("money.editRule"), headerLargeTitle: false }} />
      <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
    </>
  );
}

function Toggle({
  label,
  hint,
  value,
  onValue,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValue: (value: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text>{label}</Text>
        <Text size="xs" tone="mutedForeground">
          {hint}
        </Text>
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValue} />
    </View>
  );
}

function RuleFormSheet({
  personId,
  rules,
  categories,
  initial,
}: {
  personId: string;
  rules: MoneyCategoryRule[];
  categories: MoneyCategory[];
  initial: RuleForm;
}) {
  const router = useRouter();
  const change = useChangeRules();
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const set = (changes: Partial<RuleForm>) => setForm((current) => ({ ...current, ...changes }));
  const setFilter = (key: string, changes: Partial<RuleFilterDraft>) =>
    set({
      filters: form.filters.map((one) => (one.id === key ? { ...one, ...changes } : one)),
    });
  const submit = () => {
    const found = ruleFormProblem(form);
    setProblem(found ? t(PROBLEMS[found]) : undefined);
    if (found) return;
    change.mutate(
      { id: form.id, payload: rulePayload(personId, form, rules) },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );
  };
  const fallbacks = categories.filter(
    (one) => one.category_kind === "canonical" && Boolean(one.system_key),
  );

  return (
    <Sheet
      title={t(form.id ? "money.editRule" : "money.addRule")}
      busy={change.isPending}
      onSave={submit}
    >
      {problem ? <Text tone="destructive">{problem}</Text> : null}
      <Section title={t("money.rules")}>
        <Field label={t("money.ruleName")}>
          <Input
            accessibilityLabel={t("money.ruleName")}
            value={form.name}
            onChangeText={(name) => set({ name })}
            autoFocus={!form.id}
          />
        </Field>
        <Field label={t("money.ruleDescription")}>
          <Input
            accessibilityLabel={t("money.ruleDescription")}
            value={form.description}
            onChangeText={(description) => set({ description })}
            multiline
            style={{ minHeight: 64, textAlignVertical: "top" }}
          />
        </Field>
        <Toggle
          label={t("money.ruleEnabled")}
          hint={t("money.ruleEnabledHint")}
          value={form.enabled}
          onValue={(enabled) => set({ enabled })}
        />
        <Field label={t("money.ruleKind")} hint={t(`money.ruleKindTip${form.ruleKind}`)}>
          <Choice
            label={t("money.ruleKind")}
            value={form.ruleKind}
            options={MONEY_CATEGORY_RULE_KINDS.map((kind) => [kind, t(`money.ruleKind${kind}`)])}
            onPick={(ruleKind) => set({ ruleKind })}
          />
        </Field>
        {form.ruleKind === "direct" ? (
          <Field label={t("money.ruleTargetCategory")}>
            <Choice<string | null>
              label={t("money.ruleTargetCategory")}
              value={form.targetCategoryId || null}
              placeholder={t("money.ruleTargetCategoryPlaceholder")}
              options={categoryOptions(categories).slice(1)}
              onPick={(targetCategoryId) => set({ targetCategoryId: targetCategoryId ?? "" })}
            />
          </Field>
        ) : null}
        {form.ruleKind === "llm_categorization" ? (
          <Field label={t("money.rulePrompt")} hint={t("money.rulePromptHint")}>
            <Input
              accessibilityLabel={t("money.rulePrompt")}
              value={form.prompt}
              onChangeText={(prompt) => set({ prompt })}
              multiline
              style={{ minHeight: 96, textAlignVertical: "top" }}
            />
          </Field>
        ) : null}
        {form.ruleKind === "fallback_uncategorized" ? (
          <Field label={t("money.ruleFallbackTarget")}>
            <Choice
              label={t("money.ruleFallbackTarget")}
              value={form.fallbackSystemKey}
              placeholder={t("money.ruleFallbackTargetPlaceholder")}
              options={fallbacks.map((one): [string, string] => [
                one.system_key!,
                ruleCategoryLabel(one),
              ])}
              onPick={(fallbackSystemKey) => set({ fallbackSystemKey })}
            />
          </Field>
        ) : null}
      </Section>

      <Section title={t("money.ruleFilters")}>
        <Field label={t("money.ruleMatchMode")} hint={t("money.ruleMatchModeHint")}>
          <Choice
            label={t("money.ruleMatchMode")}
            value={form.matchMode}
            options={MONEY_CATEGORY_RULE_MATCH_MODES.map((mode) => [
              mode,
              t(`money.ruleMatch${mode}`),
            ])}
            onPick={(matchMode) => set({ matchMode })}
          />
        </Field>
        <Field label={t("money.ruleScopeFilter")} hint={t(`money.ruleScopeTip${form.scopeFilter}`)}>
          <Choice
            label={t("money.ruleScopeFilter")}
            value={form.scopeFilter}
            options={MONEY_CATEGORY_RULE_SCOPE_FILTERS.map((scope) => [
              scope,
              t(`money.ruleScope${scope}`),
            ])}
            onPick={(scopeFilter) => set({ scopeFilter })}
          />
        </Field>
        {form.filters.length ? null : (
          <Text size="sm" tone="mutedForeground">
            {t("money.ruleNoFiltersHint")}
          </Text>
        )}
        {form.filters.map((filter, index) => (
          <FilterRow
            key={filter.id}
            index={index}
            filter={filter}
            onChange={(changes) => setFilter(filter.id, changes)}
            onRemove={() => set({ filters: form.filters.filter((one) => one.id !== filter.id) })}
          />
        ))}
        <Button
          variant="outline"
          icon={Plus}
          label={t("money.ruleAddFilter")}
          onPress={() => set({ filters: [...form.filters, ruleFilterDraft()] })}
        />
        <Toggle
          label={t("money.ruleStopProcessing")}
          hint={t("money.ruleStopProcessingHint")}
          value={form.stopProcessing}
          onValue={(stopProcessing) => set({ stopProcessing })}
        />
      </Section>
    </Sheet>
  );
}

/** One filter: its field, its operator, and the value, values or range the operator takes. */
function FilterRow({
  index,
  filter,
  onChange,
  onRemove,
}: {
  index: number;
  filter: RuleFilterDraft;
  onChange: (changes: Partial<RuleFilterDraft>) => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const number = `${index + 1}`;
  const text = (key: "value" | "values" | "min" | "max", label: string, numeric?: boolean) => (
    <Field label={label} flex>
      <Input
        accessibilityLabel={`${label} ${number}`}
        value={filter[key]}
        autoCapitalize="none"
        keyboardType={numeric ? "numbers-and-punctuation" : "default"}
        onChangeText={(value) => onChange({ [key]: numeric ? ruleNumberInput(value) : value })}
      />
    </Field>
  );
  const tip = `money.ruleOperatorTip${filter.operator}`;
  return (
    <View
      style={{
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: palette.mutedHalf,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text size="sm" weight="medium" style={{ flex: 1 }}>
          {`${t("money.ruleFilters")} ${number}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("money.ruleRemoveFilter")} ${number}`}
          hitSlop={space.sm}
          onPress={onRemove}
        >
          <Icon icon={Trash2} size={16} tone="destructive" />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Field label={t("money.ruleFilterField")} flex>
          <Choice
            label={`${t("money.ruleFilterField")} ${number}`}
            value={filter.field}
            options={RULE_FILTER_FIELDS.map((one) => [one.value, t(one.labelKey)])}
            onPick={(field) => onChange({ field })}
          />
        </Field>
        <Field label={t("money.ruleFilterOperator")} flex>
          <Choice<MoneyCategoryRuleFilterOperator>
            label={`${t("money.ruleFilterOperator")} ${number}`}
            value={filter.operator}
            options={RULE_FILTER_OPERATORS.map((one) => [one.value, t(one.labelKey)])}
            onPick={(operator) => onChange({ operator })}
          />
        </Field>
      </View>
      {filter.operator === "is_empty" ||
      filter.operator === "is_not_empty" ? null : filter.operator === "range" ? (
        <View style={{ flexDirection: "row", gap: space.md }}>
          {text("min", t("money.ruleFilterMin"), true)}
          {text("max", t("money.ruleFilterMax"), true)}
        </View>
      ) : SET_OPERATORS.has(filter.operator) ? (
        text("values", t("money.ruleFilterValues"))
      ) : (
        text("value", t("money.ruleFilterValue"))
      )}
      {t(tip) === tip ? null : (
        <Text size="xs" tone="mutedForeground">
          {t(tip)}
        </Text>
      )}
    </View>
  );
}

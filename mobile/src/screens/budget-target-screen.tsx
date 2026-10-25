import type { MoneyBudgetCategoryNode } from "@orbit-types/money";
import { signedTarget, targetDraftOf, type TargetDraft } from "@orbit-types/money-reports";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { Chip, Field, Input, Section } from "@/components/form";
import { Button, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useBudgetReport, usePerson, useSaveBudgetTarget } from "@/lib/queries";
import { Sheet } from "@/screens/account-forms-screen";
import { space } from "@/theme";

function find(nodes: MoneyBudgetCategoryNode[], id: string): MoneyBudgetCategoryNode | undefined {
  for (const node of nodes) {
    const found = node.id === id ? node : find(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/** A category's target for `?month=` in `?currency=` — the web report's target editor. */
export default function BudgetTargetScreen() {
  const { category, month, currency } = useLocalSearchParams<{
    category: string;
    month: string;
    currency: string;
  }>();
  const person = usePerson();
  const report = useBudgetReport(person.data?.id, `${month}-01`, currency);
  const node = report.data ? find(report.data.categories, category) : undefined;
  if (person.data && node) {
    return (
      <TargetForm
        node={node}
        target={{ personId: person.data.id, categoryId: node.id, monthStart: `${month}-01` }}
        currency={currency}
      />
    );
  }
  const busy = person.isPending || report.isPending;
  return (
    <>
      <Stack.Screen
        options={{ title: t("money.reportTargetEditorTitle"), headerLargeTitle: false }}
      />
      <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
    </>
  );
}

function TargetForm({
  node,
  target,
  currency,
}: {
  node: MoneyBudgetCategoryNode;
  target: { personId: string; categoryId: string; monthStart: string };
  currency: string;
}) {
  const router = useRouter();
  const save = useSaveBudgetTarget();
  const [draft, setDraft] = useState<TargetDraft>(() => targetDraftOf(node));
  const [invalid, setInvalid] = useState(false);
  const run = (amount: number | null) =>
    save.mutate(
      { ...target, amount, currency },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );
  const submit = () => {
    const amount = signedTarget(draft);
    setInvalid(amount === null);
    if (amount !== null) run(amount);
  };
  return (
    <Sheet title={node.name_en || node.name_ru} busy={save.isPending} onSave={submit}>
      <Text size="sm" tone="mutedForeground">
        {t("money.reportTargetEditorDescription")}
      </Text>
      <Section title={t("money.reportTarget")}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {(["expense", "income"] as const).map((direction) => (
            <Chip
              key={direction}
              label={t(
                direction === "expense"
                  ? "money.reportDirectionExpense"
                  : "money.reportDirectionIncome",
              )}
              selected={draft.direction === direction}
              onPress={() => setDraft((current) => ({ ...current, direction }))}
            />
          ))}
        </View>
        <Field
          label={`${t("money.reportTargetAmount")}, ${currency}`}
          error={invalid ? t("money.reportTargetValidation") : undefined}
        >
          <Input
            accessibilityLabel={t("money.reportTargetAmount")}
            keyboardType="decimal-pad"
            value={draft.amount}
            onChangeText={(amount) => setDraft((current) => ({ ...current, amount }))}
            autoFocus
          />
        </Field>
      </Section>
      {node.target ? (
        <Button
          variant="outline"
          label={t("common.delete")}
          busy={save.isPending}
          onPress={() => run(null)}
        />
      ) : null}
    </Sheet>
  );
}

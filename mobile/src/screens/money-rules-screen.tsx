import type { MoneyCategoryRule } from "@orbit-types/money";
import { movedRuleIds, ruleCategoryLabel, ruleSummary } from "@orbit-types/money-rules";
import { Stack } from "expo-router";
import { Ellipsis } from "lucide-react-native";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Badge, Card, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useChangeRules, useMoneyCategories, useMoneyRules, usePerson } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

/**
 * "Правила" — the web rules page: the person's category rules in the order the pipeline runs
 * them, each with its kind, whether it is on, and its filters in a line. A rule's menu moves it up
 * or down the order, or deletes it once asked.
 */
export default function MoneyRulesScreen() {
  const palette = usePalette();
  const person = usePerson();
  const rules = useMoneyRules(person.data?.id);
  const categories = useMoneyCategories();
  const change = useChangeRules();
  const names = new Map((categories.data ?? []).map((one) => [one.id, ruleCategoryLabel(one)]));
  const all = rules.data ?? [];

  const run = (what: { delete: string } | { order: string[] }) =>
    change.mutate(what, { onError: (error) => Alert.alert(t("common.error"), error.message) });
  const actions = (rule: MoneyCategoryRule) => {
    const up = movedRuleIds(all, rule.id, "up");
    const down = movedRuleIds(all, rule.id, "down");
    const choices: [string, () => void][] = [
      ...(up ? [[t("money.ruleMoveUp"), () => run({ order: up })] as [string, () => void]] : []),
      ...(down
        ? [[t("money.ruleMoveDown"), () => run({ order: down })] as [string, () => void]]
        : []),
      [
        t("common.delete"),
        () =>
          setTimeout(
            () =>
              Alert.alert(t("common.delete"), t("money.ruleDeleteConfirm"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () => run({ delete: rule.id }),
                },
              ]),
            SHEET_DISMISS_MS,
          ),
      ],
    ];
    const options = [...choices.map(([label]) => label), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: rule.name,
        options,
        destructiveButtonIndex: choices.length - 1,
        cancelButtonIndex: options.length - 1,
      },
      (index) => choices[index]?.[1](),
    );
  };

  const header = <Stack.Screen options={{ title: t("money.rules") }} />;
  if (!all.length) {
    const busy = person.isPending || rules.isPending;
    return (
      <>
        {header}
        <Placeholder
          busy={busy}
          message={busy ? undefined : (rules.error?.message ?? t("money.noRulesHint"))}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={rules.isRefetching}
            onRefresh={() => void rules.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        {all.map((rule) => (
          <Card key={rule.id} style={{ padding: space.lg, gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text weight="semibold">{rule.name}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  <Badge label={t(`money.ruleKind${rule.rule_kind}`)} />
                  <Badge label={t(rule.enabled ? "money.ruleEnabled" : "money.ruleDisabled")} />
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.actions")}: ${rule.name}`}
                hitSlop={space.sm}
                onPress={() => actions(rule)}
              >
                <Icon icon={Ellipsis} size={20} />
              </Pressable>
            </View>
            {rule.description ? (
              <Text size="sm" tone="mutedForeground">
                {rule.description}
              </Text>
            ) : null}
            <Text size="sm">{ruleSummary(rule, t, names)}</Text>
            <Text size="xs" tone="mutedForeground">
              {[
                t(`money.ruleScope${rule.scope_filter}`),
                t(`money.ruleMatch${rule.match_mode}`),
                rule.target_category_id ? names.get(rule.target_category_id) : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}

import type {
  MoneyAmountSignFilter,
  MoneyTransactionFeedItem,
  MoneyTransactionType,
} from "@orbit-types/money";
import { formatMoney, preferredComment } from "@orbit-types/money-feed";
import { Stack, useRouter, type Href } from "expo-router";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  ReceiptText,
  RotateCcw,
  Scale,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  useMoneyAccounts,
  useMoneyCategories,
  useMoneyFeed,
  useMoneyFeedSummary,
  usePerson,
} from "@/lib/queries";
import { space, usePalette, type Palette } from "@/theme";

/** The web feed's icon and tone for each kind of transaction. */
const TYPE_LOOK: Record<MoneyTransactionType, [LucideIcon, keyof Palette]> = {
  expense: [ArrowUpRight, "destructive"],
  income: [ArrowDownLeft, "success"],
  transfer: [ArrowRightLeft, "falling"],
  refund: [RotateCcw, "warningText"],
  fee: [ReceiptText, "mutedForeground"],
  adjustment: [Scale, "completedText"],
};

const SIGNS: MoneyAmountSignFilter[] = ["all", "expense", "income"];

/** How long typing pauses before the search goes out, as on the web page. */
export const SEARCH_DEBOUNCE_MS = 250;

/** `value`, once it has stayed the same for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const signLabel = (sign: MoneyAmountSignFilter) =>
  t(`money.amountSign${sign.charAt(0).toUpperCase()}${sign.slice(1)}`);

/** "среда, 22 окт.": the web feed's day heading. */
export function dayHeading(postedAt: string): string {
  return new Date(postedAt).toLocaleDateString("ru", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/** The feed in days, newest first, as the web page groups it. */
export function byDay(items: MoneyTransactionFeedItem[]) {
  const days: { title: string; data: MoneyTransactionFeedItem[] }[] = [];
  for (const item of items) {
    const title = dayHeading(item.posted_at);
    if (days.at(-1)?.title === title) days.at(-1)!.data.push(item);
    else days.push({ title, data: [item] });
  }
  return days;
}

/** Category, comment and line titles on one muted line so the row stays short. */
export function rowMeta(item: MoneyTransactionFeedItem, categoryName: Map<string, string>): string {
  const categories =
    item.category_ids
      .slice(0, 2)
      .map((id) => categoryName.get(id) ?? id)
      .join(", ") || t("money.categoryUnassigned");
  const comment = preferredComment(item.comment, item.source_comment);
  const titles = item.line_item_titles.map((title) => title.trim()).filter(Boolean);
  return [categories, comment, titles.length > 0 ? titles.slice(0, 3).join(", ") : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "Деньги" — dense transaction feed first: filters and a one-line sum, then rows by day. Reports
 * and file import stay reachable as compact links above the list, not as tiles.
 */
export default function MoneyScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const personId = person.data?.id;
  const [typed, setQuery] = useState("");
  const query = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  const [amountSign, setAmountSign] = useState<MoneyAmountSignFilter>("all");
  const filters = useMemo(() => ({ query, amountSign }), [query, amountSign]);
  const feed = useMoneyFeed(personId, filters);
  const summary = useMoneyFeedSummary(personId, filters);
  const accounts = useMoneyAccounts(personId);
  const categories = useMoneyCategories();

  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const accountLabel = new Map(accounts.data?.map((one) => [one.id, one.account_label]));
  const categoryName = new Map(categories.data?.map((one) => [one.id, one.name_ru]));
  const currency = items[0]?.currency ?? accounts.data?.[0]?.currency ?? "RUB";
  // Each currency is summed on its own: one line per currency, or a zero in the feed's currency.
  const byCurrency = summary.data?.byCurrency.length
    ? summary.data.byCurrency
    : [{ currency, count: 0, positiveAmount: 0, negativeAmount: 0 }];

  const header = (
    <Stack.Screen
      options={{
        title: t("money.title"),
        headerSearchBarOptions: {
          placeholder: t("money.searchTransactions"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  // A failed person read leaves the feed waiting on nobody; a feed that fails before any page
  // arrives has nothing to show. A later page or a refresh that fails keeps what is loaded.
  const failed = person.error ?? (items.length === 0 ? feed.error : null);
  if (failed) {
    return (
      <>
        {header}
        <Placeholder
          message={`${t("money.feedLoadFailed")}: ${failed.message}`}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : feed.refetch())}
            />
          }
        />
      </>
    );
  }

  const month = new Date().toLocaleDateString("ru", { month: "long" });
  const top = (
    <View style={{ gap: space.xs, marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("money.reports")}
          onPress={() => router.push("/money/reports" as Href)}
          hitSlop={space.sm}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            flexShrink: 1,
          })}
        >
          <Text size="xs" weight="medium" tone="primary">
            {t("money.reports")}
          </Text>
          <Text size="xs" tone="mutedForeground" numberOfLines={1}>
            {month}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("money.import")}
          onPress={() => router.push("/money/import" as Href)}
          hitSlop={space.sm}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginLeft: "auto" })}
        >
          <Text size="xs" weight="medium" tone="primary">
            {t("money.import")}
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
        {SIGNS.map((sign) => (
          <Pressable
            key={sign}
            accessibilityRole="button"
            accessibilityState={{ selected: amountSign === sign }}
            onPress={() => setAmountSign(sign)}
            style={{
              paddingHorizontal: space.sm,
              paddingVertical: 3,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: amountSign === sign ? palette.primary : palette.border,
              backgroundColor: amountSign === sign ? palette.primary : "transparent",
            }}
          >
            <Text
              size="xs"
              weight="medium"
              tone={amountSign === sign ? "primaryForeground" : "foreground"}
            >
              {signLabel(sign)}
            </Text>
          </Pressable>
        ))}
        {summary.error ? (
          <Text size="xs" tone="mutedForeground" style={{ flex: 1 }}>
            {`${t("money.summaryUnavailable")}: ${summary.error.message}`}
          </Text>
        ) : (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 4,
              flex: 1,
              minWidth: 120,
            }}
          >
            <Text size="xs" tone="mutedForeground">
              {t("money.summaryMatches")}
            </Text>
            <Text size="xs" weight="medium">
              {String(summary.data?.totalCount ?? 0)}
            </Text>
            {byCurrency.map((one) => (
              <View
                key={one.currency}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Text size="xs" tone="mutedForeground">
                  ·
                </Text>
                <Text size="xs" tone="success" tabular>
                  {formatMoney(one.positiveAmount, one.currency, "ru-RU")}
                </Text>
                <Text size="xs" tone="mutedForeground">
                  ·
                </Text>
                <Text size="xs" tone="destructive" tabular>
                  {formatMoney(one.negativeAmount, one.currency, "ru-RU")}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );

  return (
    <>
      {header}
      <SectionList
        testID="money-feed"
        sections={byDay(items)}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          paddingHorizontal: space.md,
          paddingTop: space.xs,
          paddingBottom: space.xl * 2,
        }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => void Promise.all([feed.refetch(), summary.refetch()])}
            tintColor={palette.mutedForeground}
          />
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        ListHeaderComponent={top}
        renderSectionHeader={({ section }) => (
          <Text
            size="xs"
            weight="medium"
            tone="mutedForeground"
            style={{ marginTop: space.xs, marginBottom: 0 }}
          >
            {section.title.toUpperCase()}
          </Text>
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
        )}
        ListEmptyComponent={
          feed.isPending ? (
            <Placeholder busy />
          ) : (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              <Text weight="medium">{t("money.noTransactions")}</Text>
              <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                {t("money.noTransactionsHint")}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <Placeholder busy />
          ) : feed.error ? (
            <View style={{ paddingVertical: space.md, gap: space.sm, alignItems: "center" }}>
              <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                {`${t("money.feedLoadFailed")}: ${feed.error.message}`}
              </Text>
              <Button
                compact
                variant="outline"
                label={t("common.retry")}
                onPress={() =>
                  void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())
                }
              />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          const [icon, tone] = TYPE_LOOK[item.transaction_type] ?? TYPE_LOOK.expense;
          const account = [accountLabel.get(item.account_id), item.money_cards?.card_label]
            .filter(Boolean)
            .join(" / ");
          return (
            <Pressable
              accessibilityRole="button"
              // The row's own label would hide everything but the merchant from VoiceOver: say the
              // amount and account too, so repeat merchants tell apart.
              accessibilityLabel={[
                item.merchant_name || t("money.transactionFallback"),
                formatMoney(item.amount, item.currency, "ru-RU"),
                account,
              ]
                .filter(Boolean)
                .join(", ")}
              onPress={() => router.push(`/money/${item.id}` as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingVertical: 4,
                backgroundColor: pressed ? palette.mutedHalf : "transparent",
              })}
            >
              <Icon icon={icon} size={12} tone={tone} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" weight="semibold" numberOfLines={1}>
                  {item.merchant_name || t("money.transactionFallback")}
                </Text>
                <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                  {rowMeta(item, categoryName)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", maxWidth: 128 }}>
                <Text
                  size="sm"
                  weight="semibold"
                  tone={item.amount < 0 ? "destructive" : "success"}
                  tabular
                  numberOfLines={1}
                >
                  {formatMoney(item.amount, item.currency, "ru-RU")}
                </Text>
                <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                  {account || "-"}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </>
  );
}

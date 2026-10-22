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
  Plus,
  ReceiptText,
  RotateCcw,
  Scale,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, View } from "react-native";
import { Chip } from "@/components/form";
import { Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  useMoneyAccounts,
  useMoneyCategories,
  useMoneyFeed,
  useMoneyFeedSummary,
  usePerson,
} from "@/lib/queries";
import { radius, space, usePalette, type Palette } from "@/theme";

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

/** The web money menu's other pages, a row above the feed. */
const SECTIONS: [string, string][] = [
  ["money.accounts", "/money/accounts"],
  ["money.categories", "/money/categories"],
  ["money.rules", "/money/rules"],
];

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

/**
 * "Деньги" — the web transactions page: every transaction of the person, newest first and by day,
 * searched from the bar and narrowed to money in or out, with how many match and their sums. More
 * load as the list nears its end. A row opens its transaction; "+" adds one.
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
  // The sums come back as one number whatever the currency: across currencies it means nothing,
  // so only the count is shown then.
  const mixedCurrencies =
    new Set([
      ...items.map((one) => one.currency),
      ...(accounts.data ?? []).map((one) => one.currency),
    ]).size > 1;

  const header = (
    <Stack.Screen
      options={{
        title: t("money.title"),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.addTransaction")}
            hitSlop={space.sm}
            onPress={() => router.push("/money/form" as Href)}
          >
            <Icon icon={Plus} size={24} tone="foreground" />
          </Pressable>
        ),
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

  const total = (label: string, value: string, tone: keyof Palette) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text size="xs" tone="mutedForeground">
        {label}
      </Text>
      <Text weight="semibold" tone={tone}>
        {value}
      </Text>
    </View>
  );

  const top = (
    <View style={{ gap: space.md, marginBottom: space.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {SECTIONS.map(([label, href]) => (
          <Button
            key={href}
            compact
            variant="secondary"
            label={t(label)}
            onPress={() => router.push(href as Href)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {SIGNS.map((sign) => (
          <Chip
            key={sign}
            label={signLabel(sign)}
            selected={amountSign === sign}
            onPress={() => setAmountSign(sign)}
          />
        ))}
      </View>
      <Card style={{ padding: space.md, flexDirection: "row", gap: space.md }}>
        {summary.error ? (
          <Text size="sm" tone="mutedForeground" style={{ flex: 1 }}>
            {`${t("money.summaryUnavailable")}: ${summary.error.message}`}
          </Text>
        ) : (
          <>
            {total(t("money.summaryMatches"), String(summary.data?.totalCount ?? 0), "foreground")}
            {mixedCurrencies ? (
              <Text size="xs" tone="mutedForeground" style={{ flex: 2 }}>
                {t("money.summaryMixedCurrencies")}
              </Text>
            ) : (
              <>
                {total(
                  t("money.summaryPositive"),
                  formatMoney(summary.data?.totalPositiveAmount ?? 0, currency, "ru-RU"),
                  "success",
                )}
                {total(
                  t("money.summaryNegative"),
                  formatMoney(summary.data?.totalNegativeAmount ?? 0, currency, "ru-RU"),
                  "destructive",
                )}
              </>
            )}
          </>
        )}
      </Card>
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
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
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
            style={{ marginTop: space.md, marginBottom: space.sm, marginLeft: space.xs }}
          >
            {section.title.toUpperCase()}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
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
          ) : null
        }
        renderItem={({ item }) => {
          const [icon, tone] = TYPE_LOOK[item.transaction_type] ?? TYPE_LOOK.expense;
          const comment = preferredComment(item.comment, item.source_comment);
          const titles = item.line_item_titles.map((title) => title.trim()).filter(Boolean);
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
                gap: space.md,
                padding: space.md,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.mutedHalf : palette.card,
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.md,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: palette.muted,
                }}
              >
                <Icon icon={icon} tone={tone} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="semibold" numberOfLines={1}>
                  {item.merchant_name || t("money.transactionFallback")}
                </Text>
                <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                  {item.category_ids
                    .slice(0, 2)
                    .map((id) => categoryName.get(id) ?? id)
                    .join(", ") || t("money.categoryUnassigned")}
                </Text>
                {comment ? (
                  <Text size="xs" numberOfLines={1}>
                    {comment}
                  </Text>
                ) : null}
                {titles.length > 0 ? (
                  <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                    {titles.slice(0, 3).join(", ")}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end", gap: 2, maxWidth: 140 }}>
                <Text weight="semibold" tone={item.amount < 0 ? "destructive" : "success"}>
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

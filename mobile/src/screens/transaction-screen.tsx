import { formatMoney } from "@orbit-types/money-feed";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Ellipsis } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Badge, Card, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  useMoneyAccounts,
  useMoneyCategories,
  usePerson,
  useSaveTransaction,
  useTransaction,
} from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * One transaction — the web transaction page: what kind it is and its state, the amount, account,
 * card and comment, and each line item with its category. Editing and deleting are in the bar's
 * sheet, the delete asked first.
 */
export default function TransactionScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson();
  const transaction = useTransaction(id);
  const accounts = useMoneyAccounts(person.data?.id);
  const categories = useMoneyCategories();
  const save = useSaveTransaction();
  const item = transaction.data;

  const remove = () =>
    Alert.alert(t("money.deleteTransaction"), t("money.deleteTransactionConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("money.deleteTransaction"),
        style: "destructive",
        onPress: () =>
          save.mutate(
            { id, remove: true },
            {
              onSuccess: () => router.back(),
              onError: (error) => Alert.alert(t("common.error"), error.message),
            },
          ),
      },
    ]);

  const actions = () => {
    const labels = [t("common.edit"), t("money.deleteTransaction"), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      { options: labels, destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) router.push(`/money/form?id=${id}` as Href);
        if (index === 1) setTimeout(remove, SHEET_DISMISS_MS);
      },
    );
  };

  const title = item ? item.merchant_name || t("money.transactionFallback") : "";
  const header = (
    <Stack.Screen
      options={{
        title,
        headerLargeTitle: false,
        headerRight: item
          ? () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.actions")}: ${title}`}
                hitSlop={space.sm}
                onPress={actions}
              >
                <Icon icon={Ellipsis} size={22} tone="foreground" />
              </Pressable>
            )
          : undefined,
      }}
    />
  );
  if (!item) {
    return (
      <>
        {header}
        <Placeholder
          busy={transaction.isPending}
          message={
            transaction.isPending
              ? undefined
              : (transaction.error?.message ?? t("common.noResults"))
          }
        />
      </>
    );
  }

  const account = accounts.data?.find((one) => one.id === item.account_id)?.account_label ?? "—";
  const categoryName = (categoryId: string | null) =>
    categoryId
      ? (categories.data?.find((one) => one.id === categoryId)?.name_ru ?? categoryId)
      : t("money.categoryUnassigned");

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={transaction.isRefetching}
            onRefresh={() => void transaction.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <Card style={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Badge label={t(`money.transactionType${capitalized(item.transaction_type)}`)} />
            <Badge
              label={t(`money.transactionStatus${capitalized(item.status)}`)}
              surface={palette.secondary}
            />
            {item.is_transfer ? <Badge label={t("money.transactionTypeTransfer")} /> : null}
          </View>
          <Text size="2xl" weight="semibold" tone={item.amount < 0 ? "destructive" : "success"}>
            {formatMoney(item.amount, item.currency, "ru-RU")}
          </Text>
          <Text size="sm" tone="mutedForeground">
            {new Date(item.posted_at).toLocaleString("ru", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Labelled label={t("money.account")}>{account}</Labelled>
          {item.money_cards ? (
            <Labelled label={t("money.card")}>
              {`*${item.money_cards.last4}${item.money_cards.card_label ? ` (${item.money_cards.card_label})` : ""}`}
            </Labelled>
          ) : null}
          {item.comment ? <Labelled label={t("money.comment")}>{item.comment}</Labelled> : null}
        </Card>

        <Card style={{ padding: space.lg, gap: space.md }}>
          <Text weight="semibold">{t("money.lineItems")}</Text>
          {item.line_items.map((line) => (
            <View key={line.id} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Text size="sm" weight="medium" style={{ flex: 1 }}>
                  {line.title}
                </Text>
                <Text size="sm">{formatMoney(line.amount, item.currency, "ru-RU")}</Text>
              </View>
              <Text size="xs" tone="mutedForeground">
                {categoryName(line.category_id)}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text size="sm" tone="mutedForeground">
        {label}
      </Text>
      <Text weight="medium">{children}</Text>
    </View>
  );
}

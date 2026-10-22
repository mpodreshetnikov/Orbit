import type { MoneyAccount, MoneyCard } from "@orbit-types/money";
import { cardsByAccount } from "@orbit-types/money-accounts";
import { Stack, useRouter, type Href } from "expo-router";
import { CreditCard, Ellipsis, Plus } from "lucide-react-native";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Badge, Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  useMoneyAccounts,
  useMoneyCards,
  usePerson,
  useSaveAccount,
  type AccountSave,
} from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * "Счета" — the web accounts page: each account with its kind, currency, source and cards. "+"
 * adds an account; an account's menu edits or deletes it, a card's row edits or deletes the card,
 * each delete asked first.
 */
export default function AccountsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const personId = person.data?.id;
  const accounts = useMoneyAccounts(personId);
  const cards = useMoneyCards(accounts.data?.map((one) => one.id) ?? []);
  const save = useSaveAccount();
  const cardsOf = cardsByAccount(cards.data ?? []);

  const open = (path: string) => router.push(`/money/accounts/${path}` as Href);
  const confirm = (message: string, change: AccountSave) =>
    setTimeout(
      () =>
        Alert.alert(t("common.delete"), message, [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: () =>
              save.mutate(change, {
                onError: (error) => Alert.alert(t("common.error"), error.message),
              }),
          },
        ]),
      SHEET_DISMISS_MS,
    );
  const sheet = (title: string, edit: string, onEdit: () => void, onDelete: () => void) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [edit, t("common.delete"), t("common.cancel")],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) onEdit();
        if (index === 1) onDelete();
      },
    );
  const accountActions = (account: MoneyAccount) =>
    sheet(
      account.account_label,
      t("common.edit"),
      () => open(`form?id=${account.id}`),
      () =>
        confirm(t("money.deleteAccountConfirm"), {
          kind: "account",
          personId: account.owner_person_id,
          id: account.id,
          columns: null,
        }),
    );
  const cardActions = (card: MoneyCard) =>
    sheet(
      `*${card.last4}`,
      t("money.editCard"),
      () => open(`card?account=${card.account_id}&id=${card.id}`),
      () =>
        confirm(`*${card.last4}`, {
          kind: "card",
          accountId: card.account_id,
          id: card.id,
          columns: null,
        }),
    );

  const header = (
    <Stack.Screen
      options={{
        title: t("money.accounts"),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.addAccount")}
            hitSlop={space.sm}
            onPress={() => open("form")}
          >
            <Icon icon={Plus} size={24} tone="foreground" />
          </Pressable>
        ),
      }}
    />
  );
  if (!accounts.data?.length) {
    const busy = person.isPending || accounts.isPending;
    return (
      <>
        {header}
        <Placeholder
          busy={busy}
          message={busy ? undefined : (accounts.error?.message ?? t("money.noAccountsHint"))}
          action={
            busy ? undefined : <Button label={t("money.addAccount")} onPress={() => open("form")} />
          }
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
            refreshing={accounts.isRefetching}
            onRefresh={() => void Promise.all([accounts.refetch(), cards.refetch()])}
            tintColor={palette.mutedForeground}
          />
        }
      >
        {accounts.data.map((account) => (
          <Card key={account.id} style={{ padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text weight="semibold">{account.account_label}</Text>
                  {account.is_active ? null : <Badge label={t("money.accountInactive")} />}
                </View>
                <Text size="sm" tone="mutedForeground">
                  {`${t(`money.accountKind${capitalized(account.account_kind)}`)} · ${account.currency}`}
                </Text>
                <Text size="xs" tone="mutedForeground">
                  {account.source}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.actions")}: ${account.account_label}`}
                hitSlop={space.sm}
                onPress={() => accountActions(account)}
              >
                <Icon icon={Ellipsis} size={20} />
              </Pressable>
            </View>
            <View style={{ gap: space.xs }}>
              {(cardsOf[account.id] ?? []).map((card) => (
                <Pressable
                  key={card.id}
                  accessibilityRole="button"
                  onPress={() => cardActions(card)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    padding: space.sm,
                    borderRadius: radius.md,
                    backgroundColor: pressed ? palette.mutedHalf : palette.muted,
                  })}
                >
                  <Icon icon={CreditCard} size={14} />
                  <Text size="sm">{`*${card.last4}${card.card_label ? ` — ${card.card_label}` : ""}`}</Text>
                </Pressable>
              ))}
              {cardsOf[account.id]?.length ? null : (
                <Text size="xs" tone="mutedForeground">
                  {t("money.noCards")}
                </Text>
              )}
            </View>
            <Button
              variant="outline"
              icon={Plus}
              label={t("money.addCard")}
              onPress={() => open(`card?account=${account.id}`)}
            />
          </Card>
        ))}
      </ScrollView>
    </>
  );
}

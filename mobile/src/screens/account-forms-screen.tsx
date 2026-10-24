import { MONEY_ACCOUNT_KINDS, MONEY_ACCOUNT_SOURCES, MONEY_CURRENCIES } from "@orbit-types/money";
import type { MoneyAccountKind } from "@orbit-types/money";
import {
  accountColumns,
  cardLast4,
  EMPTY_ACCOUNT_FORM,
  type AccountForm,
} from "@orbit-types/money-accounts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Button, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  useMoneyAccounts,
  useMoneyCards,
  usePerson,
  useSaveAccount,
  type AccountSave,
} from "@/lib/queries";
import { space } from "@/theme";

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A sheet with Cancel and Save in its bar, as the web dialogs have them under. */
export function Sheet({
  title,
  busy,
  onSave,
  children,
}: {
  title: string;
  busy: boolean;
  onSave: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLargeTitle: false,
          headerLeft: () => (
            <Button
              compact
              variant="ghost"
              label={t("common.cancel")}
              onPress={() => router.back()}
            />
          ),
          headerRight: () => (
            <Button compact variant="ghost" label={t("common.save")} busy={busy} onPress={onSave} />
          ),
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        {children}
      </ScrollView>
    </>
  );
}

function useSave() {
  const router = useRouter();
  const save = useSaveAccount();
  const run = (change: AccountSave) =>
    save.mutate(change, {
      onSuccess: () => router.back(),
      onError: (error) => Alert.alert(t("common.error"), error.message),
    });
  return { run, busy: save.isPending };
}

/** An account, new or being edited by `?id=` — the web account dialog. */
export default function AccountFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const person = usePerson();
  const accounts = useMoneyAccounts(person.data?.id);
  const account = id ? accounts.data?.find((one) => one.id === id) : undefined;
  if (person.data && (!id || account)) {
    return (
      <AccountForm
        personId={person.data.id}
        id={id}
        initial={
          account
            ? {
                label: account.account_label,
                accountKind: account.account_kind,
                currency: account.currency,
                source: account.source,
                externalId: account.external_account_id ?? "",
                isActive: account.is_active,
              }
            : EMPTY_ACCOUNT_FORM
        }
      />
    );
  }
  const busy = person.isPending || accounts.isPending;
  return (
    <>
      <Stack.Screen options={{ title: t("money.editAccount"), headerLargeTitle: false }} />
      <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
    </>
  );
}

function AccountForm({
  personId,
  id,
  initial,
}: {
  personId: string;
  id?: string;
  initial: AccountForm;
}) {
  const { run, busy } = useSave();
  const [form, setForm] = useState(initial);
  const [missing, setMissing] = useState(false);
  const set = (changes: Partial<AccountForm>) => setForm((current) => ({ ...current, ...changes }));
  const submit = () => {
    const columns = accountColumns(form);
    setMissing(!columns);
    if (columns) run({ kind: "account", personId, id, columns });
  };
  return (
    <Sheet title={t(id ? "money.editAccount" : "money.addAccount")} busy={busy} onSave={submit}>
      <Section title={t("money.account")}>
        <Field label={t("money.accountLabel")} error={missing ? t("common.required") : undefined}>
          <Input
            accessibilityLabel={t("money.accountLabel")}
            value={form.label}
            onChangeText={(label) => set({ label })}
            autoFocus={!id}
          />
        </Field>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <Field label={t("money.accountKind")} flex>
            <Choice<MoneyAccountKind>
              label={t("money.accountKind")}
              value={form.accountKind}
              options={MONEY_ACCOUNT_KINDS.map((kind) => [
                kind,
                t(`money.accountKind${capitalized(kind)}`),
              ])}
              onPick={(accountKind) => set({ accountKind })}
            />
          </Field>
          <Field label={t("money.accountCurrency")} flex>
            <Choice<string>
              label={t("money.accountCurrency")}
              value={form.currency}
              options={MONEY_CURRENCIES.map((one) => [one, one])}
              onPick={(currency) => set({ currency })}
            />
          </Field>
        </View>
        <Field label={t("money.accountSource")}>
          <Choice<string>
            label={t("money.accountSource")}
            value={
              (MONEY_ACCOUNT_SOURCES as readonly string[]).includes(form.source)
                ? form.source
                : "manual"
            }
            options={MONEY_ACCOUNT_SOURCES.map((one) => [
              one,
              t(`money.accountSource${capitalized(one)}`),
            ])}
            onPick={(source) => set({ source })}
          />
        </Field>
        <Field label={t("money.accountExternalId")}>
          <Input
            accessibilityLabel={t("money.accountExternalId")}
            value={form.externalId}
            autoCapitalize="none"
            onChangeText={(externalId) => set({ externalId })}
          />
        </Field>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Text style={{ flex: 1 }}>{t("money.accountActive")}</Text>
          <Switch
            accessibilityLabel={t("money.accountActive")}
            value={form.isActive}
            onValueChange={(isActive) => set({ isActive })}
          />
        </View>
      </Section>
    </Sheet>
  );
}

/** A card of `?account=`, new or being edited by `?id=` — the web card dialog. */
export function CardFormScreen() {
  const { account, id } = useLocalSearchParams<{ account: string; id?: string }>();
  const cards = useMoneyCards(id ? [account] : []);
  const card = id ? cards.data?.find((one) => one.id === id) : undefined;
  if (!id || card) {
    return (
      <CardForm
        accountId={account}
        id={id}
        last4={card?.last4 ?? ""}
        label={card?.card_label ?? ""}
      />
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: t("money.editCard"), headerLargeTitle: false }} />
      <Placeholder
        busy={cards.isPending}
        message={cards.isPending ? undefined : t("common.noResults")}
      />
    </>
  );
}

function CardForm(props: { accountId: string; id?: string; last4: string; label: string }) {
  const { run, busy } = useSave();
  const [last4, setLast4] = useState(props.last4);
  const [label, setLabel] = useState(props.label);
  const [missing, setMissing] = useState(false);
  const submit = () => {
    const digits = cardLast4(last4);
    setMissing(!digits);
    if (digits) {
      run({
        kind: "card",
        accountId: props.accountId,
        id: props.id,
        columns: { last4: digits, card_label: label.trim() || null },
      });
    }
  };
  return (
    <Sheet title={t(props.id ? "money.editCard" : "money.addCard")} busy={busy} onSave={submit}>
      <Section title={t("money.card")}>
        <Field label={t("money.cardLast4")} error={missing ? t("common.required") : undefined}>
          <Input
            accessibilityLabel={t("money.cardLast4")}
            keyboardType="number-pad"
            maxLength={19}
            value={last4}
            onChangeText={setLast4}
            autoFocus={!props.id}
          />
        </Field>
        <Field label={t("money.cardLabel")}>
          <Input accessibilityLabel={t("money.cardLabel")} value={label} onChangeText={setLabel} />
        </Field>
      </Section>
    </Sheet>
  );
}

import type {
  MoneyAccount,
  MoneyCategory,
  MoneyLineStatus,
  MoneyTransactionStatus,
  MoneyTransactionType,
} from "@orbit-types/money";
import {
  MONEY_CURRENCIES,
  MONEY_LINE_STATUSES,
  MONEY_TRANSACTION_STATUSES,
  MONEY_TRANSACTION_TYPES,
} from "@orbit-types/money";
import { buildMoneyCategoryTree, flattenMoneyCategoryTree } from "@orbit-types/money-categories";
import { formatMoney } from "@orbit-types/money-feed";
import {
  lineItemDraft,
  lineItemDrafts,
  lineItemInputs,
  lineItemsMismatch,
  lineItemsTotal,
  manualCategoryChange,
  parseAmount,
  transactionFormProblem,
  withMerchantCategory,
  type LineItemDraft,
} from "@orbit-types/money-transaction-form";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Plus, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Chip, Choice, Field, Input, Section } from "@/components/form";
import { Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import type { TransactionDetail } from "@/features/money/transactions";
import { t } from "@/lib/i18n";
import {
  useMerchantCategories,
  useMerchantNames,
  useMoneyAccounts,
  useMoneyCategories,
  usePerson,
  usePersons,
  useSaveTransaction,
  useTransaction,
} from "@/lib/queries";
import { space } from "@/theme";

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** How many of the person's merchants are suggested under the field. */
const SHOWN_MERCHANTS = 5;

/** The categories as the web picker lists them, nested ones indented under theirs. */
export function categoryOptions(categories: MoneyCategory[]): [string | null, string][] {
  return [
    [null, t("money.categoryUnassigned")],
    ...flattenMoneyCategoryTree(buildMoneyCategoryTree(categories)).map(
      (category): [string, string] => [
        category.id,
        `${"  ".repeat(category.depth)}${category.name_ru}`,
      ],
    ),
  ];
}

/** A transaction, new or being edited by `?id=` — the web transaction form. */
export default function TransactionFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const person = usePerson();
  const accounts = useMoneyAccounts(person.data?.id);
  const transaction = useTransaction(id ?? "");
  const ready = person.data && accounts.data && (!id || transaction.data);
  if (ready) {
    return (
      <TransactionForm
        personId={person.data!.id}
        accounts={accounts.data!}
        initial={id ? transaction.data! : undefined}
      />
    );
  }
  const failed = person.error ?? accounts.error ?? (id ? transaction.error : null);
  // A query waiting on a person that failed is disabled, not loading.
  const busy =
    !failed &&
    (person.isPending ||
      (accounts.isPending && accounts.isFetching) ||
      (!!id && transaction.isPending && transaction.isFetching));
  const retry = () => {
    if (person.error) void person.refetch();
    else if (accounts.error) void accounts.refetch();
    else void transaction.refetch();
  };
  return (
    <>
      <Stack.Screen options={{ title: t("money.editTransaction"), headerLargeTitle: false }} />
      {failed ? (
        <Placeholder
          message={failed.message}
          action={<Button variant="outline" label={t("common.retry")} onPress={retry} />}
        />
      ) : (
        <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
      )}
    </>
  );
}

function TransactionForm({
  personId,
  accounts,
  initial,
}: {
  personId: string;
  accounts: MoneyAccount[];
  initial?: TransactionDetail;
}) {
  const router = useRouter();
  const save = useSaveTransaction();
  const categories = useMoneyCategories();
  const persons = usePersons();
  const merchantCategories = useMerchantCategories(personId);
  const merchants = useMerchantNames(personId);

  const [accountId, setAccountId] = useState(
    initial?.account_id ?? accounts.find((one) => one.is_active)?.id ?? "",
  );
  const [postedAt, setPostedAt] = useState(() =>
    initial ? new Date(initial.posted_at) : new Date(),
  );
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState<string>(
    initial?.currency ?? accounts.find((one) => one.id === accountId)?.currency ?? "RUB",
  );
  const [type, setType] = useState<MoneyTransactionType>(initial?.transaction_type ?? "expense");
  const [status, setStatus] = useState<MoneyTransactionStatus>(initial?.status ?? "posted");
  const [merchant, setMerchant] = useState(initial?.merchant_name ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(() =>
    initial
      ? lineItemDrafts(initial.line_items)
      : [
          lineItemDraft({
            quantity: "1",
            unit: t("money.unitPcs"),
            beneficiary_person_id: personId,
          }),
        ],
  );
  const [problem, setProblem] = useState<string | null>(null);

  const change = (key: string, changes: Partial<LineItemDraft>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  const pickMerchant = (name: string) => {
    setMerchant(name);
    setItems((current) => withMerchantCategory(current, merchantCategories.data?.[name.trim()]));
  };
  // A merchant left before its usual categories arrived gets them when they do.
  useEffect(() => {
    const category = merchantCategories.data?.[merchant.trim()];
    if (category) setItems((current) => withMerchantCategory(current, category));
    // Only the arrival of the mapping: typing is handled when the field is left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantCategories.data]);
  const typed = merchant.trim().toLowerCase();
  const suggestions = typed
    ? (merchants.data ?? [])
        .filter((name) => name.toLowerCase().includes(typed) && name !== merchant)
        .slice(0, SHOWN_MERCHANTS)
    : [];

  const submit = () => {
    const found = transactionFormProblem({ accountId, postedAt: postedAt.toISOString(), amount });
    setProblem(found);
    if (found) return;
    const values = {
      account_id: accountId,
      posted_at: postedAt.toISOString(),
      amount: parseAmount(amount),
      currency,
      transaction_type: type,
      status,
      merchant_name: merchant.trim() || null,
      comment: comment.trim() || null,
    };
    const lineItems = lineItemInputs(items, merchant);
    save.mutate(
      initial
        ? { id: initial.id, updates: values, lineItems }
        : { transaction: { payer_person_id: personId, ...values }, lineItems },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: t(initial ? "money.editTransaction" : "money.addTransaction"),
          headerLargeTitle: false,
          headerLeft: () => (
            <Button compact variant="ghost" label={t("common.cancel")} onPress={router.back} />
          ),
          headerRight: () => (
            <Button
              compact
              variant="ghost"
              label={t("common.save")}
              busy={save.isPending}
              onPress={submit}
            />
          ),
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        {problem ? <Text tone="destructive">{t(problem)}</Text> : null}
        {accounts.length === 0 ? (
          <Card style={{ padding: space.md, gap: 2 }}>
            <Text weight="medium">{t("money.noAccounts")}</Text>
            <Text size="xs" tone="mutedForeground">
              {t("money.noAccountsHint")}
            </Text>
          </Card>
        ) : null}
        <Section title={t("money.transactions")}>
          <Field label={t("money.amount")} hint={t("money.amountHint")}>
            <Input
              accessibilityLabel={t("money.amount")}
              keyboardType="numbers-and-punctuation"
              value={amount}
              onChangeText={setAmount}
              autoFocus={!initial}
            />
          </Field>
          <Field label={t("money.account")}>
            <Choice<string>
              label={t("money.account")}
              value={accountId}
              placeholder={t("money.selectAccount")}
              options={accounts.map((one) => [
                one.id,
                `${one.account_label} (${one.currency})${one.is_active ? "" : ` — ${t("money.accountInactive")}`}`,
              ])}
              onPick={(next) => {
                // The account picked brings its currency, editing too: a transaction keeps its
                // account's currency unless changed after.
                if (next !== accountId) {
                  setCurrency(accounts.find((one) => one.id === next)?.currency ?? currency);
                }
                setAccountId(next);
              }}
            />
          </Field>
          <Field label={t("money.merchant")}>
            <Input
              accessibilityLabel={t("money.merchant")}
              placeholder={t("money.merchantPlaceholder")}
              value={merchant}
              onChangeText={setMerchant}
              onEndEditing={() => pickMerchant(merchant)}
            />
            {suggestions.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {suggestions.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    selected={false}
                    onPress={() => pickMerchant(name)}
                  />
                ))}
              </View>
            ) : null}
          </Field>
          <Field label={t("money.postedAt")}>
            <DateTimePicker
              testID="posted-at"
              value={postedAt}
              mode="datetime"
              display="compact"
              locale="ru"
              style={{ alignSelf: "flex-start" }}
              onValueChange={(_event, date) => setPostedAt(date)}
            />
          </Field>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Field label={t("money.type")} flex>
              <Choice<MoneyTransactionType>
                label={t("money.type")}
                value={type}
                options={MONEY_TRANSACTION_TYPES.map((one) => [
                  one,
                  t(`money.transactionType${capitalized(one)}`),
                ])}
                onPick={setType}
              />
            </Field>
            <Field label={t("money.currency")} flex>
              <Choice<string>
                label={t("money.currency")}
                value={currency}
                options={MONEY_CURRENCIES.map((one) => [one, one])}
                onPick={setCurrency}
              />
            </Field>
          </View>
          <Field label={t("money.status")}>
            <Choice<MoneyTransactionStatus>
              label={t("money.status")}
              value={status}
              options={MONEY_TRANSACTION_STATUSES.map((one) => [
                one,
                t(`money.transactionStatus${capitalized(one)}`),
              ])}
              onPick={setStatus}
            />
          </Field>
          <Field label={t("money.comment")}>
            <Input
              accessibilityLabel={t("money.comment")}
              placeholder={t("money.commentPlaceholder")}
              value={comment}
              onChangeText={setComment}
              multiline
            />
          </Field>
        </Section>

        <Section title={t("money.lineItems")}>
          {items.map((item, index) => (
            <View key={item.key} style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
                <Input
                  accessibilityLabel={`${t("money.lineItemTitle")} ${index + 1}`}
                  placeholder={t("money.lineItemTitle")}
                  value={item.title}
                  onChangeText={(title) => change(item.key, { title })}
                  style={{ flex: 1 }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("common.remove")} ${index + 1}`}
                  hitSlop={space.sm}
                  onPress={() =>
                    setItems((current) => current.filter((one) => one.key !== item.key))
                  }
                >
                  <Icon icon={Trash2} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Field label={t("money.lineItemAmount")} flex>
                  <Input
                    accessibilityLabel={`${t("money.lineItemAmount")} ${index + 1}`}
                    keyboardType="numbers-and-punctuation"
                    value={item.amount}
                    onChangeText={(next) => change(item.key, { amount: next })}
                  />
                </Field>
                <Field label={t("money.lineItemQuantity")} flex>
                  <Input
                    accessibilityLabel={`${t("money.lineItemQuantity")} ${index + 1}`}
                    keyboardType="decimal-pad"
                    value={item.quantity}
                    onChangeText={(quantity) => change(item.key, { quantity })}
                  />
                </Field>
                <Field label={t("money.lineItemUnit")} flex>
                  <Input
                    accessibilityLabel={`${t("money.lineItemUnit")} ${index + 1}`}
                    value={item.unit}
                    onChangeText={(unit) => change(item.key, { unit })}
                  />
                </Field>
              </View>
              <Field label={t("money.lineItemCategory")}>
                <Choice<string | null>
                  label={t("money.lineItemCategory")}
                  value={item.category_id}
                  options={categoryOptions(categories.data ?? [])}
                  onPick={(categoryId) =>
                    change(item.key, manualCategoryChange(item, categoryId, new Date()))
                  }
                />
              </Field>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Field label={t("money.lineItemStatus")} flex>
                  <Choice<MoneyLineStatus>
                    label={t("money.lineItemStatus")}
                    value={item.line_status}
                    options={MONEY_LINE_STATUSES.map((one) => [
                      one,
                      t(`money.lineStatus${capitalized(one)}`),
                    ])}
                    onPick={(line_status) => change(item.key, { line_status })}
                  />
                </Field>
                <Field label={t("money.lineItemBeneficiary")} flex>
                  <Choice<string | null>
                    label={t("money.lineItemBeneficiary")}
                    value={item.beneficiary_person_id}
                    options={[
                      [null, t("money.beneficiaryUnassigned")],
                      ...(persons.data ?? []).map((one): [string, string] => [one.id, one.name]),
                    ]}
                    onPick={(beneficiary_person_id) => change(item.key, { beneficiary_person_id })}
                  />
                </Field>
              </View>
            </View>
          ))}
          <Button
            variant="outline"
            icon={Plus}
            label={t("money.addLineItem")}
            onPress={() =>
              setItems((current) => [
                ...current,
                lineItemDraft({
                  quantity: "1",
                  unit: t("money.unitPcs"),
                  beneficiary_person_id: personId,
                  category_id: merchantCategories.data?.[merchant.trim()] ?? null,
                }),
              ])
            }
          />
          <Text size="sm" tone="mutedForeground">
            {`${t("money.lineItemsTotal")}: ${formatMoney(lineItemsTotal(items), currency, "ru-RU")}`}
          </Text>
          {lineItemsMismatch(amount, items) ? (
            <Text size="xs" tone="warningText">
              {t("money.lineItemsMismatch")}
            </Text>
          ) : null}
        </Section>
      </ScrollView>
    </>
  );
}

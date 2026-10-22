import type { ImportParseResult, MoneyImportPreviewResult } from "@orbit-types/import";
import { formatMoney } from "@orbit-types/money-feed";
import {
  getAccountHint,
  importAccountHints,
  importBatchRows,
} from "@orbit-types/money-import-rows";
import { TBANK_CSV_SOURCE_ID } from "@orbit-types/money-import-tbank-csv";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { FileSpreadsheet, History } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Choice, Field, Section } from "@/components/form";
import { Button, Card, Text } from "@/components/ui";
import {
  moneyImportAction,
  pickStatement,
  readStatement,
  type StatementFile,
} from "@/features/money/import";
import { t } from "@/lib/i18n";
import { useMoneyAccounts, useMoneyCards, usePerson, useSaveAccount } from "@/lib/queries";
import { space } from "@/theme";

/** How many of the statement's operations the preview lists before the count says the rest. */
const PREVIEW_ROWS = 20;

/**
 * "Импорт" — a T-Bank statement brought in from Files, or opened in Orbit from another app with
 * `?file=`: its operations read on the phone, each card given an account, then sent to
 * `money-import` for the batch report, as the web's file import does.
 */
export default function MoneyImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ file?: string; name?: string }>();
  const person = usePerson();
  const personId = person.data?.id;
  const accounts = useMoneyAccounts(personId);
  const saveAccount = useSaveAccount();
  const tbank = (accounts.data ?? []).filter((one) => one.source === TBANK_CSV_SOURCE_ID);
  const cards = useMoneyCards(tbank.map((one) => one.id));
  const [file, setFile] = useState<StatementFile | null>(null);
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultAccount, setDefaultAccount] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const read = async (statement: StatementFile) => {
    setFile(statement);
    setParsed(null);
    setBusy(true);
    try {
      setParsed(await readStatement(statement.uri));
    } catch {
      setParsed({ transactions: [], errors: [t("money.importParseError")] });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (params.file) void read({ uri: params.file, name: params.name ?? params.file });
  }, [params.file, params.name]);

  const byCard = Object.fromEntries(
    (cards.data ?? []).map((card) => [card.last4, card.account_id]),
  );
  const only = tbank.length === 1 ? tbank[0]!.id : null;
  const accountOf = (hint: string | null) =>
    (hint ? (mapping[hint] ?? byCard[hint]) : undefined) ?? defaultAccount ?? only;
  const rows = parsed?.transactions ?? [];
  const batch = importBatchRows(rows, (row) => accountOf(getAccountHint(row)));
  const options = tbank.map((one): [string | null, string] => [one.id, one.account_label]);

  const confirm = async () => {
    if (!batch || !personId) return;
    setBusy(true);
    try {
      const result = await moneyImportAction<MoneyImportPreviewResult>({
        action: "preview_rows",
        source: TBANK_CSV_SOURCE_ID,
        payer_person_id: personId,
        import_type: "file",
        file_path: file?.name ?? null,
        rows: batch,
      });
      router.replace(`/money/import/${result.batch_id}` as Href);
    } catch (error) {
      Alert.alert(t("common.error"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("money.importTitle") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              icon={FileSpreadsheet}
              label={t("money.importUploadFile")}
              busy={busy && !parsed}
              onPress={() => void pickStatement().then((picked) => picked && read(picked))}
            />
          </View>
          <Button
            variant="outline"
            icon={History}
            label={t("money.importViewHistory")}
            onPress={() => router.push("/money/import/history" as Href)}
          />
        </View>

        {parsed ? (
          <Section title={t("money.importPreview")}>
            <Text weight="medium">{`${file?.name} · ${rows.length}`}</Text>
            {(parsed.errors ?? []).map((error) => (
              <Text key={error} size="sm" tone="destructive">
                {error}
              </Text>
            ))}
            {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
              <View key={index} style={{ flexDirection: "row", gap: space.sm }}>
                <Text size="sm" tone="mutedForeground">
                  {row.posted_at.slice(0, 10)}
                </Text>
                <Text size="sm" style={{ flex: 1 }} numberOfLines={1}>
                  {row.merchant_name ?? "—"}
                </Text>
                <Text size="sm">{formatMoney(row.amount, row.currency, "ru-RU")}</Text>
              </View>
            ))}
            {rows.length > PREVIEW_ROWS ? (
              <Text size="xs" tone="mutedForeground">{`+${rows.length - PREVIEW_ROWS}`}</Text>
            ) : null}
          </Section>
        ) : null}

        {rows.length ? (
          <Section title={t("money.accounts")}>
            {tbank.length ? (
              <>
                <Field label={t("money.importDefaultAccount")}>
                  <Choice
                    label={t("money.importDefaultAccount")}
                    value={defaultAccount ?? only}
                    placeholder={t("money.selectAccount")}
                    options={options}
                    onPick={setDefaultAccount}
                  />
                </Field>
                {importAccountHints(rows).map((hint) => (
                  <Field key={hint} label={`${t("money.importMapAccount")} *${hint}`}>
                    <Choice
                      label={`${t("money.importMapAccount")} *${hint}`}
                      value={accountOf(hint)}
                      placeholder={t("money.selectAccount")}
                      options={options}
                      onPick={(id) => id && setMapping((current) => ({ ...current, [hint]: id }))}
                    />
                  </Field>
                ))}
              </>
            ) : (
              <Card style={{ padding: space.md, gap: space.sm }}>
                <Text size="sm">{t("money.importNoAccounts")}</Text>
                <Button
                  variant="outline"
                  label={t("money.importCreateTbankAccount")}
                  busy={saveAccount.isPending}
                  onPress={() =>
                    saveAccount.mutate(
                      {
                        kind: "account",
                        personId: personId!,
                        columns: {
                          account_label: "T-Bank",
                          account_kind: "debit",
                          currency: "RUB",
                          source: TBANK_CSV_SOURCE_ID,
                          external_account_id: null,
                          is_active: true,
                        },
                      },
                      { onError: (error) => Alert.alert(t("common.error"), error.message) },
                    )
                  }
                />
              </Card>
            )}
            {batch ? null : (
              <Text size="sm" tone="destructive">
                {t("money.importUnresolvedAccountMapping")}
              </Text>
            )}
            <Button
              label={t("money.importConfirm")}
              busy={busy}
              disabled={!batch}
              onPress={() => void confirm()}
            />
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}

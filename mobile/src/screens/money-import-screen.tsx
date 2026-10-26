import type { MoneyImportPreviewResult } from "@orbit-types/import";
import { importBatchRows } from "@orbit-types/money-import-rows";
import {
  importBankOptions,
  type ImportBankId,
  type ImportMethodOption,
} from "@orbit-types/money-import-sources";
import { TBANK_CSV_SOURCE_ID } from "@orbit-types/money-import-tbank-csv";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { FileSpreadsheet, History } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Section } from "@/components/form";
import { Badge, Button, Card, Text } from "@/components/ui";
import {
  moneyImportAction,
  pickStatement,
  readStatement,
  type StatementFile,
} from "@/features/money/import";
import { t } from "@/lib/i18n";
import { usePerson } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** What the web offers, as the phone sees it: the extension runs only in a computer's browser. */
const BANKS = importBankOptions(
  [
    { sourceId: TBANK_CSV_SOURCE_ID, kind: "file" },
    { sourceId: "tbank_web", kind: "extension" },
    { sourceId: "alfa_web", kind: "extension" },
  ],
  { extension: false },
);

const BANK_KEYS: Record<ImportBankId, string> = {
  tbank: "money.importBankTbank",
  alfa: "money.importBankAlfa",
  other: "money.importBankOther",
};

/** A bank or a way to import, greyed and inert where the phone cannot do it. */
function Option({
  title,
  hint,
  selected,
  available,
  chip,
  testID,
  onPress,
}: {
  title: string;
  hint: string;
  selected: boolean;
  available: boolean;
  chip?: string;
  testID: string;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={{
        gap: 2,
        padding: space.md,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? palette.primary : palette.border,
        opacity: available ? 1 : 0.5,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text weight="medium">{title}</Text>
        {chip ? <Badge label={chip} textTone="mutedForeground" /> : null}
      </View>
      <Text size="sm" tone="mutedForeground">
        {hint}
      </Text>
    </Pressable>
  );
}

/**
 * "Импорт" — the bank first, then the way in: on the phone, a statement file brought in from Files
 * or opened in Orbit from another app with `?file=`. It starts as soon as the file is read: the
 * server finds each card's account and applies the batch on its own (T-261026-2ew), so the screen
 * goes straight to the import's page.
 */
export default function MoneyImportScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ file?: string; name?: string }>();
  const person = usePerson();
  const personId = person.data?.id;
  const [bank, setBank] = useState<ImportBankId>("tbank");
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // Rows the parser could not read never reach the server, so the import's page cannot tell of them.
  const [skipped, setSkipped] = useState<{ batchId: string; rows: number } | null>(null);

  const start = async (statement: StatementFile) => {
    if (!personId) return;
    setErrors([]);
    setSkipped(null);
    setStatus(t("money.importFileReading"));
    try {
      const parsed = await readStatement(statement.uri).catch(() => null);
      if (!parsed) throw new Error(t("money.importParseError"));
      if (parsed.transactions.length === 0) {
        // The parser's own reasons are English and technical; the person needs only this.
        setErrors([t("money.importFileEmpty")]);
        setStatus(null);
        return;
      }
      setStatus(t("money.importFileUploading", { count: parsed.transactions.length }));
      const result = await moneyImportAction<MoneyImportPreviewResult>({
        action: "preview_rows",
        source: TBANK_CSV_SOURCE_ID,
        payer_person_id: personId,
        import_type: "file",
        file_path: statement.name,
        rows: importBatchRows(parsed.transactions),
      });
      void client.invalidateQueries({ queryKey: ["money-import-batches"] });
      void client.invalidateQueries({ queryKey: ["money-feed"] });
      void client.invalidateQueries({ queryKey: ["money-feed-summary"] });
      const unread = parsed.errors?.length ?? 0;
      if (unread > 0) {
        setSkipped({ batchId: result.batch_id, rows: unread });
        setStatus(null);
        return;
      }
      router.replace(`/money/import/${result.batch_id}` as Href);
    } catch (error) {
      setErrors([(error as Error).message]);
      setStatus(null);
    }
  };
  useEffect(() => {
    if (params.file && personId) {
      void start({ uri: params.file, name: params.name ?? params.file });
    }
    // Once per file handed over, when the person is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.file, params.name, personId]);

  const selected = BANKS.find((one) => one.id === bank)!;
  const methodHint = (method: ImportMethodOption) =>
    method.kind === "file"
      ? t("money.importMethodFileHint")
      : t("money.importMethodExtensionDesktopOnly");

  return (
    <>
      <Stack.Screen options={{ title: t("money.importTitle") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Button
          variant="outline"
          icon={History}
          label={t("money.importViewHistory")}
          onPress={() => router.push("/money/import/history" as Href)}
        />

        <Section title={t("money.importStepBank")}>
          {BANKS.map((one) => (
            <Option
              key={one.id}
              testID={`import-bank-${one.id}`}
              title={t(BANK_KEYS[one.id])}
              hint={
                one.methods.length === 0
                  ? t("money.importBankSoon")
                  : one.available
                    ? t("money.importMethodFile")
                    : t("money.importBankDesktopOnly")
              }
              selected={one.id === bank}
              available={one.available}
              onPress={() => setBank(one.id)}
            />
          ))}
        </Section>

        <Section title={t("money.importStepMethod")}>
          {selected.methods.map((method) => (
            <Option
              key={method.kind}
              testID={`import-method-${method.kind}`}
              title={t(
                method.kind === "file" ? "money.importMethodFile" : "money.importMethodExtension",
              )}
              hint={methodHint(method)}
              chip={method.recommended ? t("money.importRecommended") : undefined}
              selected={method.available}
              available={method.available}
              onPress={() => undefined}
            />
          ))}
        </Section>

        <Section title={t("money.importStepFile")}>
          <Text size="sm" tone="mutedForeground">
            {t("money.importFileAutoStart")}
          </Text>
          <Button
            icon={FileSpreadsheet}
            label={t("money.importUploadFile")}
            busy={status !== null}
            disabled={!personId}
            onPress={() => void pickStatement().then((picked) => picked && start(picked))}
          />
          {status ? (
            <Text size="sm" tone="mutedForeground">
              {status}
            </Text>
          ) : null}
          {errors.map((error) => (
            <Text key={error} size="sm" tone="destructive">
              {error}
            </Text>
          ))}
          {skipped ? (
            <View testID="import-file-skipped" style={{ gap: space.sm }}>
              <Text size="sm">{t("money.importFileSkipped", { count: skipped.rows })}</Text>
              <Button
                variant="outline"
                label={t("money.importOpenReport")}
                onPress={() => router.replace(`/money/import/${skipped.batchId}` as Href)}
              />
            </View>
          ) : null}
        </Section>

        <Card style={{ padding: space.md, gap: space.xs, opacity: 0.6 }}>
          <Text weight="medium">{t("money.importAutoStatusTitle")}</Text>
          <Text size="sm" tone="mutedForeground">
            {t("money.importAutoDesktopOnly")}
          </Text>
        </Card>
      </ScrollView>
    </>
  );
}

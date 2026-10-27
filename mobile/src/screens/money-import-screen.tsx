import type { MoneyImportPreviewResult } from "@orbit-types/import";
import { importBatchRows } from "@orbit-types/money-import-rows";
import {
  importBankOfSource,
  importBankOptions,
  type ImportBankId,
} from "@orbit-types/money-import-sources";
import { TBANK_CSV_SOURCE_ID } from "@orbit-types/money-import-tbank-csv";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ChevronDown, ChevronRight, FileSpreadsheet, FileUp, History } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Badge, Button, Card, Icon, Text } from "@/components/ui";
import {
  moneyImportAction,
  pickStatement,
  readStatement,
  type StatementFile,
} from "@/features/money/import";
import { t } from "@/lib/i18n";
import { useImportBatches, usePerson } from "@/lib/queries";
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

const BANK_MARKS: Record<ImportBankId, { letter: string; surface: string; ink: string }> = {
  tbank: { letter: "Т", surface: "#ffdd2d", ink: "#171717" },
  alfa: { letter: "А", surface: "#ef3124", ink: "#ffffff" },
  other: { letter: "…", surface: "#f5f5f5", ink: "#737373" },
};

/** A step's name over its choices, as the web page sets it: small, grey, upper case. */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text size="xs" weight="semibold" tone="mutedForeground">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

/** A bank as a pill with its mark, greyed and inert where the phone cannot import from it. */
function BankPill({
  id,
  selected,
  available,
  onPress,
}: {
  id: ImportBankId;
  selected: boolean;
  available: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const mark = BANK_MARKS[id];
  return (
    <Pressable
      testID={`import-bank-${id}`}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        height: 44,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.primary : palette.border,
        backgroundColor: available ? palette.card : palette.muted,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: available ? mark.surface : palette.border,
        }}
      >
        <Text
          size="xs"
          weight="bold"
          style={{ color: available ? mark.ink : palette.mutedForeground }}
        >
          {mark.letter}
        </Text>
      </View>
      <Text size="sm" weight="medium" tone={available ? "foreground" : "mutedForeground"}>
        {t(BANK_KEYS[id])}
      </Text>
    </Pressable>
  );
}

/** A way to import, greyed and inert where the phone cannot do it. */
function Option({
  title,
  hint,
  selected,
  available,
  chip,
  testID,
}: {
  title: string;
  hint: string;
  selected: boolean;
  available: boolean;
  chip?: string;
  testID: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !available }}
      disabled={!available}
      style={{
        gap: space.xs,
        padding: 14,
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.primary : palette.border,
        backgroundColor: available ? palette.card : palette.muted,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        <Text weight="semibold" tone={available ? "foreground" : "mutedForeground"}>
          {title}
        </Text>
        {chip ? (
          <Badge
            label={chip}
            textTone={available ? "infoText" : "mutedForeground"}
            surface={available ? palette.infoSurface : undefined}
            border={available ? palette.infoBorder : undefined}
          />
        ) : null}
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
  const [howTo, setHowTo] = useState(false);
  const palette = usePalette();
  const batches = useImportBatches(personId);
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
  const unavailable = BANKS.filter((one) => !one.available);
  const last = batches.data?.find((one) => one.status === "completed");

  return (
    <>
      <Stack.Screen options={{ title: t("money.importTitle") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        {last ? (
          <Text size="sm" tone="mutedForeground" testID="import-last">
            {t("money.importLastImport", {
              date: new Date(last.created_at).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
              }),
              bank: t(BANK_KEYS[importBankOfSource(last.source)]),
              count: last.inserted_count,
            })}
          </Text>
        ) : null}
        <Button
          variant="outline"
          icon={History}
          label={t("money.importViewHistory")}
          onPress={() => router.push("/money/import/history" as Href)}
        />

        <Step title={t("money.importStepBank")}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {BANKS.map((one) => (
              <BankPill
                key={one.id}
                id={one.id}
                selected={one.id === bank}
                available={one.available}
                onPress={() => setBank(one.id)}
              />
            ))}
          </View>
          {unavailable.map((one) => (
            <Text key={one.id} size="xs" tone="mutedForeground">
              {`${t(BANK_KEYS[one.id])}: ${
                one.methods.length === 0
                  ? t("money.importBankSoon")
                  : t("money.importBankDesktopOnly")
              }`}
            </Text>
          ))}
        </Step>

        <Step title={t("money.importStepMethod")}>
          {selected.methods.map((method) => (
            <Option
              key={method.kind}
              testID={`import-method-${method.kind}`}
              title={t(
                method.kind === "file" ? "money.importMethodFile" : "money.importMethodExtension",
              )}
              hint={
                method.kind === "file"
                  ? t("money.importMethodFileHint")
                  : t("money.importMethodExtensionDesktopOnly")
              }
              chip={method.recommended ? t("money.importRecommended") : undefined}
              selected={method.available}
              available={method.available}
            />
          ))}
        </Step>

        <Card style={{ padding: space.lg, gap: space.md, borderRadius: 12 }}>
          <Pressable
            accessibilityRole="button"
            disabled={!personId || status !== null}
            onPress={() => void pickStatement().then((picked) => picked && start(picked))}
            style={{
              alignItems: "center",
              gap: space.sm,
              paddingVertical: space.xl,
              paddingHorizontal: space.md,
              borderRadius: 10,
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: palette.border,
            }}
          >
            <Icon icon={FileUp} size={28} tone="mutedForeground" />
            <Text weight="semibold">{t("money.importFileChoose")}</Text>
            <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
              {t("money.importFileAutoStart")}
            </Text>
          </Pressable>
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
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: howTo }}
            onPress={() => setHowTo((open) => !open)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              paddingVertical: space.xs,
            }}
          >
            <Icon icon={howTo ? ChevronDown : ChevronRight} size={16} tone="mutedForeground" />
            <Text size="sm" weight="medium">
              {t("money.importFileHowTo")}
            </Text>
          </Pressable>
          {howTo
            ? (["1", "2", "3"] as const).map((step) => (
                <Text key={step} size="sm" tone="mutedForeground">
                  {`${step}. ${t(`money.importFileHowToStep${step}`)}`}
                </Text>
              ))
            : null}
        </Card>

        <Card
          style={{
            padding: space.lg,
            gap: space.xs,
            borderRadius: 12,
            backgroundColor: palette.muted,
          }}
        >
          <Text weight="semibold" tone="mutedForeground">
            {t("money.importAutoStatusTitle")}
          </Text>
          <Text size="sm" tone="mutedForeground">
            {t("money.importAutoDesktopOnly")}
          </Text>
        </Card>
      </ScrollView>
    </>
  );
}

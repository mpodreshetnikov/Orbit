import {
  IMPORT_REVIEW_PERIODS,
  batchesInWindow,
  importReviewWindow,
  summarizeImportBatches,
  type ImportReviewPeriod,
} from "@orbit-types/money-import-review";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Chip, Field } from "@/components/form";
import { BatchStatus, importDateTime } from "@/components/import-status";
import { dayOf } from "@/features/measurements/format";
import { Card, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useImportBatches, usePerson } from "@/lib/queries";
import { space, usePalette } from "@/theme";

const REVIEW_PERIOD_KEYS: Record<ImportReviewPeriod, string> = {
  week: "money.importReviewPeriodWeek",
  month: "money.importReviewPeriodMonth",
  custom: "money.importReviewPeriodCustom",
  all: "money.importReviewPeriodAll",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "История импортов" — the person's import batches, newest first, each opening its report, and
 * the review over a week, a month or chosen days: imports land without confirmation now, so this
 * is where the owner checks them (T-261026-2ew).
 */
export default function ImportHistoryScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const batches = useImportBatches(person.data?.id);
  const [period, setPeriod] = useState<ImportReviewPeriod>("all");
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * DAY_MS));
  const [customTo, setCustomTo] = useState(() => new Date());
  const visible = useMemo(
    () =>
      batchesInWindow(
        batches.data ?? [],
        importReviewWindow(period, new Date(), { from: dayOf(customFrom), to: dayOf(customTo) }),
      ),
    [batches.data, period, customFrom, customTo],
  );
  const summary = summarizeImportBatches(visible);
  const header = (
    <Stack.Screen options={{ title: t("money.importHistoryTitle"), headerLargeTitle: false }} />
  );
  if (!batches.data?.length) {
    const busy = person.isPending || batches.isPending;
    return (
      <>
        {header}
        <Placeholder
          busy={busy}
          message={busy ? undefined : (batches.error?.message ?? t("money.importHistoryEmptyHint"))}
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
            refreshing={batches.isRefetching}
            onRefresh={() => void batches.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <Card style={{ padding: space.lg, gap: space.sm }}>
          <Text weight="semibold">{t("money.importReviewTitle")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
            {IMPORT_REVIEW_PERIODS.map((value) => (
              <Chip
                key={value}
                label={t(REVIEW_PERIOD_KEYS[value])}
                selected={period === value}
                onPress={() => setPeriod(value)}
              />
            ))}
          </View>
          {period === "custom" ? (
            <View style={{ flexDirection: "row", gap: space.md }}>
              <Field label={t("money.importReviewFrom")}>
                <DateTimePicker
                  testID="import-review-from"
                  value={customFrom}
                  mode="date"
                  display="compact"
                  locale="ru"
                  style={{ alignSelf: "flex-start" }}
                  onValueChange={(_event, picked) => setCustomFrom(picked)}
                />
              </Field>
              <Field label={t("money.importReviewTo")}>
                <DateTimePicker
                  testID="import-review-to"
                  value={customTo}
                  mode="date"
                  display="compact"
                  locale="ru"
                  style={{ alignSelf: "flex-start" }}
                  onValueChange={(_event, picked) => setCustomTo(picked)}
                />
              </Field>
            </View>
          ) : null}
          <Text size="sm">
            {summary.imports === 0
              ? t("money.importReviewEmpty")
              : t("money.importReviewSummary", {
                  imports: summary.imports,
                  inserted: summary.inserted,
                  skipped: summary.skipped,
                  errors: summary.errors,
                })}
          </Text>
          {summary.rolledBack > 0 || summary.failed > 0 ? (
            <Text size="sm" tone="mutedForeground">
              {[
                summary.rolledBack > 0
                  ? t("money.importReviewRolledBack", { count: summary.rolledBack })
                  : null,
                summary.failed > 0
                  ? t("money.importReviewFailed", { count: summary.failed })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </Card>

        {visible.map((batch) => (
          <Pressable
            key={batch.id}
            accessibilityRole="button"
            onPress={() => router.push(`/money/import/${batch.id}` as Href)}
          >
            <Card style={{ padding: space.lg, gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text weight="semibold" style={{ flex: 1 }}>
                  {importDateTime(batch.created_at)}
                </Text>
                <BatchStatus status={batch.status} />
              </View>
              <Text size="sm" tone="mutedForeground">
                {[
                  batch.source,
                  batch.meta?.unattended === true
                    ? t("money.importHistoryImportTypeUnattended")
                    : batch.import_type === "file"
                      ? t("money.importHistoryImportTypeFile")
                      : batch.import_type === "web_export"
                        ? t("money.importHistoryImportTypeWebExport")
                        : batch.import_type,
                  `${t("money.importHistoryParsedRows")}: ${batch.parsed_transactions_count}`,
                ].join(" · ")}
              </Text>
              <Text size="xs" tone="mutedForeground">
                {t("money.importResultsSummary", {
                  inserted: batch.inserted_count,
                  skipped: batch.skipped_count,
                })}
              </Text>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

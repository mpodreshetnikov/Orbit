import { readableImportFailure } from "@orbit-types/money-import-failure";
import type { MoneyImportBatch, MoneyImportBatchRow } from "@orbit-types/import";
import { formatMoney } from "@orbit-types/money-feed";
import { importOutcome } from "@orbit-types/money-import-review";
import { Stack, useLocalSearchParams } from "expo-router";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { Section } from "@/components/form";
import { BatchStatus, importDateTime } from "@/components/import-status";
import { Badge, Button, Card, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useImportBatch, useReviewImportBatch, useRollbackImportBatch } from "@/lib/queries";
import { space, usePalette } from "@/theme";

const ROW_STATUS = {
  inserted: "money.importResultRowInserted",
  skipped: "money.importResultRowSkipped",
  error: "money.importResultRowError",
} as const;

/**
 * An import's page — the web's batch report: how the import went, with the way to undo it once
 * it landed (every extension import applies on its own, T-261026-2ew), and what became of each
 * operation. A file preview from before that is still applied or not from here.
 */
export default function ImportBatchScreen() {
  const palette = usePalette();
  const { batch: id } = useLocalSearchParams<{ batch: string }>();
  const report = useImportBatch(id);
  const review = useReviewImportBatch();
  const rollback = useRollbackImportBatch();
  const header = (
    <Stack.Screen options={{ title: t("money.importResultsTitle"), headerLargeTitle: false }} />
  );
  if (!report.data) {
    return (
      <>
        {header}
        <Placeholder
          busy={report.isPending}
          message={report.isPending ? undefined : (report.error?.message ?? t("common.noResults"))}
        />
      </>
    );
  }
  const { batch, rows } = report.data;
  const failureMessage =
    batch.status === "failed" && typeof batch.meta?.failure_message === "string"
      ? readableImportFailure(batch.meta.failure_message)
      : null;
  const operations = rows.filter((row) => row.row_kind === "transaction");
  const run = (apply: boolean) =>
    review.mutate(
      { id: batch.id, apply },
      { onError: (error) => Alert.alert(t("common.error"), error.message) },
    );
  const confirmRollback = () =>
    Alert.alert(
      t("money.importRollbackConfirmTitle"),
      t("money.importRollbackConfirmBody", { count: batch.inserted_count }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("money.importRollback"),
          style: "destructive",
          onPress: () =>
            rollback.mutate(batch.id, {
              onError: (error) => Alert.alert(t("money.importRollbackFailed"), error.message),
            }),
        },
      ],
    );
  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={report.isRefetching}
            onRefresh={() => void report.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <Outcome batch={batch} />
        {batch.status === "completed" ? (
          <Button
            variant="outline"
            label={t("money.importRollback")}
            busy={rollback.isPending}
            onPress={confirmRollback}
          />
        ) : null}

        <Card style={{ padding: space.lg, gap: space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text weight="semibold" style={{ flex: 1 }}>
              {t("money.importReportDetails")}
            </Text>
            <BatchStatus status={batch.status} />
          </View>
          {[
            t("money.importReportSummarySource", { value: batch.source }),
            t("money.importReportSummaryParsedRows", { value: batch.parsed_transactions_count }),
            `${t("money.importHistoryCreatedAt")}: ${importDateTime(batch.created_at)}`,
            batch.completed_at
              ? t("money.importReportSummaryCompleted", {
                  value: importDateTime(batch.completed_at),
                })
              : null,
          ]
            .filter(Boolean)
            .map((line) => (
              <Text key={line} size="sm" tone="mutedForeground">
                {line}
              </Text>
            ))}
          {failureMessage ? (
            <Text size="sm" tone="destructive">
              {t("money.importReportFailureReason", { value: failureMessage })}
            </Text>
          ) : null}
        </Card>

        {batch.status === "pending" ? (
          <Card style={{ padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t("money.importApplyBatch")}
                  busy={review.isPending}
                  onPress={() => run(true)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  variant="outline"
                  label={t("money.importDiscardBatch")}
                  busy={review.isPending}
                  onPress={() => run(false)}
                />
              </View>
            </View>
          </Card>
        ) : null}

        <Section title={t("money.importPreview")}>
          {operations.length ? (
            operations.map((row) => <OperationRow key={row.id} row={row} />)
          ) : (
            <Text size="sm" tone="mutedForeground">
              {t("money.importReportNoRows")}
            </Text>
          )}
        </Section>
      </ScrollView>
    </>
  );
}

/** How the import went, in the words the web's import page leads with. */
function Outcome({ batch }: { batch: MoneyImportBatch }) {
  const outcome = importOutcome(batch.status);
  const lines: { text: string; tone?: "mutedForeground" | "destructive" }[] = [];
  if (outcome === "running") {
    lines.push({ text: t("money.importOutcomeRunningTitle") });
    lines.push({
      text: t("money.importOutcomeRunningHint", { count: batch.parsed_transactions_count }),
      tone: "mutedForeground",
    });
  } else if (outcome === "applied") {
    lines.push({
      text: t("money.importOutcomeAppliedTitle", {
        inserted: batch.inserted_count,
        skipped: batch.skipped_count,
      }),
    });
    lines.push({ text: t("money.importOutcomeAppliedHint"), tone: "mutedForeground" });
    if (batch.error_count > 0) {
      lines.push({
        text: t("money.importOutcomeErrors", { count: batch.error_count }),
        tone: "destructive",
      });
    }
  } else if (outcome === "rolled_back") {
    const removed = Number(batch.meta?.rolled_back_transactions ?? batch.inserted_count) || 0;
    lines.push({ text: t("money.importOutcomeRolledBackTitle") });
    lines.push({
      text: t("money.importOutcomeRolledBackHint", { count: removed }),
      tone: "mutedForeground",
    });
  } else if (outcome === "failed") {
    lines.push({ text: t("money.importOutcomeFailedTitle") });
    lines.push({ text: t("money.importOutcomeFailedHint"), tone: "mutedForeground" });
  } else if (outcome === "awaiting") {
    lines.push({ text: t("money.importOutcomeAwaitingTitle") });
    lines.push({ text: t("money.importPendingReviewBanner"), tone: "mutedForeground" });
  } else {
    lines.push({ text: t("money.importDiscardedBanner"), tone: "mutedForeground" });
  }
  return (
    <Card style={{ padding: space.lg, gap: space.xs }}>
      {lines.map((line, index) => (
        <Text
          key={line.text}
          size={index === 0 ? "base" : "sm"}
          weight={index === 0 && !line.tone ? "semibold" : undefined}
          tone={line.tone}
        >
          {line.text}
        </Text>
      ))}
    </Card>
  );
}

/** One operation of the batch: when, where, how much, and what became of it. */
function OperationRow({ row }: { row: MoneyImportBatchRow }) {
  const payload = row.payload ?? {};
  const amount = Number(payload.amount);
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1}>
          {String(payload.merchant_name ?? payload.title ?? "—")}
        </Text>
        <Text size="sm">
          {Number.isFinite(amount)
            ? formatMoney(amount, String(payload.currency ?? "RUB"), "ru-RU")
            : "—"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text size="xs" tone="mutedForeground" style={{ flex: 1 }}>
          {importDateTime(typeof payload.posted_at === "string" ? payload.posted_at : null)}
        </Text>
        <Badge label={t(ROW_STATUS[row.status])} />
      </View>
      {row.message ? (
        <Text size="xs" tone={row.status === "error" ? "destructive" : "mutedForeground"}>
          {row.message}
        </Text>
      ) : null}
    </View>
  );
}

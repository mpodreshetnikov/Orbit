import { Stack, useRouter, type Href } from "expo-router";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { BatchStatus, importDateTime } from "@/components/import-status";
import { Card, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useImportBatches, usePerson } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** "История импортов" — the person's import batches, newest first, each opening its report. */
export default function ImportHistoryScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const batches = useImportBatches(person.data?.id);
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
        {batches.data.map((batch) => (
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

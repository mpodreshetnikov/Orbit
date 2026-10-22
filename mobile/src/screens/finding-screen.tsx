import { findingKey } from "@orbit-types/finding-summary";
import { Stack, useLocalSearchParams } from "expo-router";
import { Calendar, MapPin } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActionSheetIOS, Alert, RefreshControl, ScrollView, View } from "react-native";
import { lateralityText, ResolvedBadge, SeverityBadge } from "@/components/finding-badges";
import { Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useActiveRecords, useFindings, useMarkFindingResolved, usePerson } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/**
 * One finding's history — the web finding page: its latest size, how often and on which side it was
 * seen, and each time it was, newest first, with the source's own words. While it is still present it
 * can be marked resolved, attached to one of the person's records picked from the system sheet.
 */
export default function FindingScreen() {
  const palette = usePalette();
  const { key } = useLocalSearchParams<{ key: string }>();
  const person = usePerson();
  const findings = useFindings(person.data?.id);
  const records = useActiveRecords(person.data?.id);
  const resolve = useMarkFindingResolved();
  const finding = findings.data?.find((one) => findingKey(one) === key);

  const header = (
    <Stack.Screen
      options={{
        title: finding?.catalog_finding_name_ru || finding?.finding_type_text || "",
        headerLargeTitle: false,
      }}
    />
  );
  if (!finding || !person.data) {
    return (
      <>
        {header}
        {findings.isPending || person.isPending ? (
          <Placeholder busy />
        ) : (
          <Placeholder message={findings.error?.message ?? t("findings.notFound")} />
        )}
      </>
    );
  }

  const personId = person.data.id;
  const site = finding.catalog_site_name_ru || finding.body_site_text;
  const choices = records.data ?? [];
  const markResolved = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("findings.markAsResolved"),
        message: t("findings.markAsResolvedDescription"),
        options: [
          ...choices.map((one) =>
            one.record_date ? `${one.title} · ${formatDay(one.record_date)}` : one.title,
          ),
          t("common.cancel"),
        ],
        cancelButtonIndex: choices.length,
      },
      (index) => {
        const record = choices[index];
        if (!record) return;
        resolve.mutate(
          { personId, recordId: record.id, finding },
          { onError: (error) => Alert.alert(t("common.error"), error.message) },
        );
      },
    );

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={findings.isRefetching}
            onRefresh={() => void findings.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {finding.is_resolved ? (
              <ResolvedBadge />
            ) : (
              <SeverityBadge severity={finding.latest_severity} />
            )}
            {finding.finding_code ? (
              <Text tone="mutedForeground">{finding.finding_code}</Text>
            ) : null}
          </View>
          {site ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Icon icon={MapPin} size={14} />
              <Text tone="mutedForeground">{site}</Text>
            </View>
          ) : null}
          {finding.is_resolved ? null : (
            <Button
              variant="outline"
              label={t("findings.markAsResolved")}
              busy={resolve.isPending}
              onPress={markResolved}
            />
          )}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Stat title={t("findings.latestSize")}>
            <Text size="xl" weight="bold">
              {finding.latest_size_mm !== null
                ? `${finding.latest_size_mm} ${t("findings.mm")}`
                : t("findings.noSize")}
            </Text>
          </Stat>
          <Stat title={t("findings.totalOccurrences")}>
            <Text size="xl" weight="bold">
              {finding.occurrence_count}
            </Text>
          </Stat>
          <Stat title={t("findings.laterality")}>
            <Text size="lg" weight="semibold">
              {lateralityText(finding.latest_laterality) ?? t("findings.lateralityOptions.none")}
            </Text>
          </Stat>
        </View>

        <Card style={{ padding: space.lg, gap: space.lg }}>
          <Text weight="semibold">{t("findings.history")}</Text>
          {finding.history.map((point) => (
            <View key={point.id} style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Icon icon={Calendar} size={14} />
                <Text size="sm" tone="mutedForeground">
                  {formatDay(point.record_date || point.created_at)}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                {point.size_mm !== null ? (
                  <Text weight="medium">
                    {point.size_mm} {t("findings.mm")}
                  </Text>
                ) : null}
                {point.count !== null && point.count > 1 ? (
                  <Text size="sm" tone="mutedForeground">
                    x{point.count}
                  </Text>
                ) : null}
                {point.resolution_status === "resolved" ? (
                  <ResolvedBadge />
                ) : (
                  <SeverityBadge severity={point.severity} />
                )}
                {lateralityText(point.laterality) ? (
                  <Text size="sm" tone="mutedForeground">
                    {lateralityText(point.laterality)}
                  </Text>
                ) : null}
              </View>
              {point.description || point.morphology ? (
                <Text size="sm" tone="mutedForeground">
                  {point.description || point.morphology}
                </Text>
              ) : null}
              {point.source_anchor ? (
                <Text
                  size="xs"
                  tone="mutedForeground"
                  style={{
                    fontStyle: "italic",
                    borderLeftWidth: 2,
                    borderColor: palette.border,
                    paddingLeft: space.sm,
                  }}
                >
                  “{point.source_anchor}”
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      </ScrollView>
    </>
  );
}

/** One of the web page's summary cards. */
function Stat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ flexBasis: "30%", flexGrow: 1, padding: space.md, gap: space.xs }}>
      <Text size="xs" weight="medium" tone="mutedForeground">
        {title}
      </Text>
      {children}
    </Card>
  );
}

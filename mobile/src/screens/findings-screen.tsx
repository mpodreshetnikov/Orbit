import type { FindingSummary } from "@orbit-types/finding";
import { findingKey, searchFindingSummaries } from "@orbit-types/finding-summary";
import { Stack, useRouter, type Href } from "expo-router";
import { AlertTriangle, CheckCircle2, MapPin } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, SectionList, View } from "react-native";
import { lateralityText, ResolvedBadge, SeverityBadge } from "@/components/finding-badges";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useFindings, usePerson } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** Where a finding's page is: its key, which names the finding and its site. */
export function findingHref(finding: FindingSummary): Href {
  return `/health/findings/${encodeURIComponent(findingKey(finding))}` as Href;
}

/**
 * The person's findings — the web findings page: the active ones, then the resolved ones dimmed,
 * each a card, searched from the bar. The web page's table view is left to the web.
 */
export default function FindingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const findings = useFindings(person.data?.id);
  const [query, setQuery] = useState("");

  const shown = searchFindingSummaries(findings.data ?? [], query);
  const active = shown.filter((finding) => !finding.is_resolved);
  const resolved = shown.filter((finding) => finding.is_resolved);
  const sections = [
    { title: `${t("findings.activeSection")} (${active.length})`, data: active },
    { title: `${t("findings.resolvedSection")} (${resolved.length})`, data: resolved },
  ].filter((section) => section.data.length > 0);

  const header = (
    <Stack.Screen
      options={{
        title: t("findings.navTitle"),
        headerSearchBarOptions: {
          placeholder: t("findings.searchPlaceholder"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  if (person.error || findings.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(person.error ?? findings.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : findings.refetch())}
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(item) => findingKey(item)}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
        renderSectionHeader={({ section }) => (
          <Text weight="semibold" style={{ marginTop: space.md, marginBottom: space.sm }}>
            {section.title}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListEmptyComponent={
          findings.isPending || person.isPending ? (
            <Placeholder busy />
          ) : (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              {findings.data?.length ? (
                // A search that matches nothing is not an empty history.
                <Text weight="medium">{t("common.noResults")}</Text>
              ) : (
                <>
                  <Text weight="medium">{t("findings.noFindings")}</Text>
                  <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                    {t("findings.noFindingsDescription")}
                  </Text>
                </>
              )}
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={findings.isRefetching}
            onRefresh={() => void findings.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => (
          <FindingCard finding={item} onPress={() => router.push(findingHref(item))} />
        )}
      />
    </>
  );
}

/** The web `FindingCard`. */
function FindingCard({ finding, onPress }: { finding: FindingSummary; onPress: () => void }) {
  const palette = usePalette();
  const serious = finding.latest_severity === "severe" || finding.latest_severity === "moderate";
  const site = finding.catalog_site_name_ru || finding.body_site_text;
  const side = lateralityText(finding.latest_laterality);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: finding.is_resolved
          ? palette.successBorder
          : serious
            ? palette.warning
            : palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
        opacity: finding.is_resolved ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
              {finding.catalog_finding_name_ru || finding.finding_type_text}
            </Text>
            {finding.is_resolved ? (
              <Icon icon={CheckCircle2} size={14} tone="success" />
            ) : serious ? (
              <Icon icon={AlertTriangle} size={14} tone="rising" />
            ) : null}
          </View>
          {finding.finding_code ? (
            <Text size="xs" tone="mutedForeground">
              {finding.finding_code}
            </Text>
          ) : null}
        </View>
        {finding.is_resolved ? (
          <ResolvedBadge />
        ) : (
          <SeverityBadge severity={finding.latest_severity} />
        )}
      </View>
      {site ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Icon icon={MapPin} size={12} />
          <Text size="sm" tone="mutedForeground" numberOfLines={1}>
            {side ? `${side} ` : ""}
            {site}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text size="sm">
          {finding.latest_size_mm !== null
            ? `${finding.latest_size_mm} ${t("findings.mm")}`
            : t("findings.noSize")}
        </Text>
        <Text size="xs" tone="mutedForeground">
          {finding.latest_date ? `${formatDay(finding.latest_date)} · ` : ""}
          {finding.occurrence_count} {t("findings.occurrences")}
        </Text>
      </View>
    </Pressable>
  );
}

import { isAwaitingClosureReview } from "@orbit-types/condition-closure";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Ellipsis,
  FileText,
  History,
  Quote,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { CONDITION_TONE, ConditionStatusBadge } from "@/components/condition-status";
import { Badge, Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import type { ConditionMention } from "@/features/conditions/query";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useCondition, useSaveCondition } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

const SHEET_DISMISS_MS = 400;

/**
 * One condition — the web condition page: its status and ICD code, its dates and how often it was
 * mentioned, its notes, and every mention newest first with the record it is in and the source's own
 * words. Editing opens the form; a condition no record mentions can be deleted.
 */
export default function ConditionScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const condition = useCondition(id);
  const save = useSaveCondition();
  const data = condition.data;

  const remove = () =>
    Alert.alert(t("conditions.deleteCondition"), t("conditions.deleteConditionConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          save.mutate(
            { id, remove: true },
            {
              onSuccess: () => router.back(),
              onError: (error) => Alert.alert(t("common.error"), error.message),
            },
          ),
      },
    ]);

  const actions = () => {
    // The web page offers deleting only while no record mentions the condition.
    const deletable = data?.mention_count === 0;
    const labels = [
      t("common.edit"),
      ...(deletable ? [t("conditions.deleteCondition")] : []),
      t("common.cancel"),
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: deletable ? 1 : undefined,
        message: deletable ? undefined : t("conditions.cannotDeleteHasHistory"),
      },
      (index) => {
        if (index === 0) router.push(`/health/conditions/edit?id=${id}` as Href);
        // An alert raised while the sheet is still closing is dropped by iOS.
        else if (deletable && index === 1) setTimeout(remove, SHEET_DISMISS_MS);
      },
    );
  };

  const header = (
    <Stack.Screen
      options={{
        title: data?.name ?? "",
        headerLargeTitle: false,
        headerRight: data
          ? () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.actions")}: ${data.name}`}
                hitSlop={space.sm}
                onPress={actions}
              >
                <Icon icon={Ellipsis} size={22} tone="foreground" />
              </Pressable>
            )
          : undefined,
      }}
    />
  );
  if (!data) {
    return (
      <>
        {header}
        {condition.isPending ? (
          <Placeholder busy />
        ) : (
          <Placeholder message={condition.error?.message ?? t("conditions.conditionNotFound")} />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={condition.isRefetching}
            onRefresh={() => void condition.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        {data.code ? (
          <Card style={{ padding: space.lg, gap: space.sm }}>
            <Text size="sm" tone="mutedForeground">
              {t("conditions.icdName")}
            </Text>
            <Text weight="semibold">{data.code}</Text>
            {data.icd_name_en ? (
              <View style={{ gap: 2 }}>
                <Text size="sm" tone="mutedForeground">
                  {t("conditions.icdOfficialName")}
                </Text>
                <Text weight="medium">{data.icd_name_en}</Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card style={{ padding: space.lg, gap: space.md }}>
          <Row label={t("conditions.currentStatus")}>
            <ConditionStatusBadge status={data.current_status} />
          </Row>
          {data.onset_date ? (
            <Row label={t("conditions.onsetDate")}>
              <DateText icon={Calendar} day={data.onset_date} />
            </Row>
          ) : null}
          {data.resolved_date ? (
            <Row label={t("conditions.resolvedDate")}>
              <DateText icon={CheckCircle2} day={data.resolved_date} />
            </Row>
          ) : null}
          <Row label={t("conditions.mentions")}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Icon icon={FileText} size={14} />
              <Text weight="semibold">{data.mention_count}</Text>
            </View>
          </Row>
          {data.first_mentioned_date ? (
            <Row label={t("conditions.firstMentioned")}>
              <Text size="sm">{formatDay(data.first_mentioned_date)}</Text>
            </Row>
          ) : null}
          {data.last_mentioned_date && data.last_mentioned_date !== data.first_mentioned_date ? (
            <Row label={t("conditions.lastMentioned")}>
              <Text size="sm">{formatDay(data.last_mentioned_date)}</Text>
            </Row>
          ) : null}
          {data.notes ? (
            <View style={{ gap: 2 }}>
              <Text size="sm" tone="mutedForeground">
                {t("conditions.notes")}
              </Text>
              <Text size="sm">{data.notes}</Text>
            </View>
          ) : null}
        </Card>

        <Card style={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Icon icon={History} />
            <Text weight="semibold">{t("conditions.mentionHistory")}</Text>
          </View>
          {data.history.length > 0 ? (
            data.history.map((mention) => <Mention key={mention.id} mention={mention} />)
          ) : (
            <Text size="sm" tone="mutedForeground">
              {t("conditions.noHistory")}
            </Text>
          )}
          <Button
            variant="outline"
            icon={History}
            label={t("conditions.addToHistory")}
            onPress={() => router.push(`/health/conditions/history?id=${id}` as Href)}
          />
        </Card>
      </ScrollView>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.sm,
      }}
    >
      <Text size="sm" tone="mutedForeground">
        {label}
      </Text>
      {children}
    </View>
  );
}

function DateText({ icon, day }: { icon: typeof Calendar; day: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Icon icon={icon} size={14} />
      <Text size="sm">{formatDay(day)}</Text>
    </View>
  );
}

/**
 * A mention on the web page's timeline: the record, its date, the status it gave, its words. A
 * closure nobody has confirmed says so, as there: the chart is ignoring it, so it must not read as
 * a settled one.
 */
function Mention({ mention }: { mention: ConditionMention }) {
  const palette = usePalette();
  const awaitingReview = isAwaitingClosureReview(mention);
  return (
    <View
      style={{
        gap: space.xs,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderLeftWidth: 3,
        borderColor: palette.border,
        borderLeftColor: awaitingReview
          ? palette.warning
          : (palette[CONDITION_TONE[mention.status_in_record]] as string),
      }}
    >
      <Text weight="medium">{mention.record_title || t("records.title")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        {mention.record_date ? <DateText icon={Calendar} day={mention.record_date} /> : null}
        {mention.record_type ? <Badge label={t(`records.types.${mention.record_type}`)} /> : null}
        <ConditionStatusBadge status={mention.status_in_record} />
        {awaitingReview ? (
          <Badge
            icon={AlertTriangle}
            label={t("conditions.awaitingReview")}
            textTone="warningText"
          />
        ) : null}
        {mention.review_decision === "dismissed" ? (
          <Badge label={t("conditions.dismissed")} textTone="mutedForeground" />
        ) : null}
      </View>
      {mention.source_anchor ? (
        <View
          style={{
            flexDirection: "row",
            gap: space.xs,
            padding: space.sm,
            borderRadius: radius.sm,
            backgroundColor: palette.mutedHalf,
          }}
        >
          <Icon icon={Quote} size={12} />
          <Text size="xs" tone="mutedForeground" style={{ flex: 1, fontStyle: "italic" }}>
            {mention.source_anchor}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

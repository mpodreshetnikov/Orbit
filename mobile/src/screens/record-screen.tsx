import type { RecordFindingWithCatalog } from "@orbit-types/finding";
import type { RecordAttachment, RecordObservationWithCatalog } from "@orbit-types/medical-record";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ChevronRight, FileImage, FileText } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Section } from "@/components/form";
import { Badge, Button, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay } from "@/features/measurements/format";
import { rangeText, shownValue, statusTone } from "@/features/observations/format";
import { t } from "@/lib/i18n";
import { useAttachmentLink, useRecord } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";
import { recordTypeLabel } from "./records-screen";

/**
 * A document — the web record page, to read: its type and date, its pages to open, its notes, the
 * summary and keywords read from it, and the results and findings it holds. "Изменить" in the bar
 * edits its details; each result leads to its history.
 */
export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const palette = usePalette();
  const { record, attachments, observations, findings } = useRecord(id);

  if (!record.data) {
    return (
      <>
        <Stack.Screen options={{ title: t("records.detail.title"), headerLargeTitle: false }} />
        <Placeholder
          busy={record.isPending}
          message={record.isPending ? undefined : (record.error?.message ?? t("common.noResults"))}
          action={
            record.error ? (
              <Button
                variant="outline"
                label={t("common.retry")}
                onPress={() => void record.refetch()}
              />
            ) : undefined
          }
        />
      </>
    );
  }

  const doc = record.data;
  const refresh = () =>
    void Promise.all([
      record.refetch(),
      attachments.refetch(),
      observations.refetch(),
      findings.refetch(),
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: doc.title,
          headerLargeTitle: false,
          headerRight: () => (
            <Button
              compact
              variant="ghost"
              label={t("common.edit")}
              onPress={() => router.push(`/health/records/edit?id=${doc.id}` as Href)}
            />
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={record.isRefetching}
            onRefresh={refresh}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View style={{ gap: space.xs }}>
          <Text size="xl" weight="semibold">
            {doc.title}
          </Text>
          <Text size="sm" tone="mutedForeground">
            {recordTypeLabel(doc.record_type)} ·{" "}
            {doc.record_date ? formatDay(doc.record_date) : t("records.noDate")}
          </Text>
        </View>

        <Part title={t("records.detail.attachments")} query={attachments}>
          {(attachments.data ?? []).length === 0 ? (
            <Text size="sm" tone="mutedForeground">
              {t("records.detail.noAttachments")}
            </Text>
          ) : (
            attachments.data?.map((one) => <AttachmentRow key={one.id} attachment={one} />)
          )}
        </Part>

        <Section title={t("records.detail.notes")}>
          <Text size="sm" tone={doc.notes ? "foreground" : "mutedForeground"}>
            {doc.notes || t("records.detail.noNotes")}
          </Text>
        </Section>

        {doc.llm_summary ? (
          <Section title={t("records.detail.summary")}>
            <Text size="sm">{doc.llm_summary}</Text>
          </Section>
        ) : null}

        {doc.llm_keywords?.length ? (
          <Section title={t("records.detail.keywords")}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {doc.llm_keywords.map((word) => (
                <Badge key={word} label={word} />
              ))}
            </View>
          </Section>
        ) : null}

        {(observations.data ?? []).length > 0 || observations.error ? (
          <Part title={t("records.detail.observations")} query={observations}>
            {observations.data?.map((one) => (
              <ObservationRow key={one.id} observation={one} />
            ))}
          </Part>
        ) : null}

        {(findings.data ?? []).length > 0 || findings.error ? (
          <Part title={t("records.detail.findings")} query={findings}>
            {findings.data?.map((one) => (
              <FindingRow key={one.id} finding={one} />
            ))}
          </Part>
        ) : null}
      </ScrollView>
    </>
  );
}

/** A section fed by its own read, which shows its error and a retry in place of what it holds. */
function Part({
  title,
  query,
  children,
}: {
  title: string;
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
}) {
  return (
    <Section title={title}>
      {query.error ? (
        <View style={{ gap: space.sm }}>
          <Text size="sm" tone="destructive">
            {query.error.message}
          </Text>
          <Button
            variant="outline"
            compact
            label={t("common.retry")}
            onPress={() => void query.refetch()}
          />
        </View>
      ) : query.isPending ? (
        <ActivityIndicator />
      ) : (
        children
      )}
    </Section>
  );
}

/** A page of the document: opened in the system's browser sheet, which shows images and PDFs. */
function AttachmentRow({ attachment }: { attachment: RecordAttachment }) {
  const palette = usePalette();
  const link = useAttachmentLink();
  const open = () =>
    link.mutate(attachment.storage_path, {
      onSuccess: (url) => void WebBrowser.openBrowserAsync(url),
      onError: (error) => Alert.alert(t("common.error"), error.message),
    });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("records.detail.openAttachment")}: ${attachment.original_filename}`}
      onPress={open}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.sm,
        borderRadius: radius.sm,
        backgroundColor: pressed ? palette.muted : palette.mutedHalf,
      })}
    >
      <Icon icon={attachment.mime_type.startsWith("image/") ? FileImage : FileText} />
      <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
        {attachment.original_filename}
      </Text>
      {link.isPending ? <ActivityIndicator /> : <Icon icon={ChevronRight} size={16} />}
    </Pressable>
  );
}

/** "3.5–5.5", "≥ 3.5" or "≤ 5.5": whatever bounds the document gave, or nothing. */
function oneSidedRange({
  ref_range_low: low,
  ref_range_high: high,
}: RecordObservationWithCatalog): string | null {
  if (low !== null && high !== null) return rangeText(low, high);
  if (low !== null) return `≥ ${low}`;
  if (high !== null) return `≤ ${high}`;
  return null;
}

/** A result read from the document: its value against its range, coloured by its status. */
function ObservationRow({ observation }: { observation: RecordObservationWithCatalog }) {
  const palette = usePalette();
  const router = useRouter();
  const name = observation.catalog_name_ru ?? observation.obs_name;
  // As extracted, at its own precision: a 0.04 is not a 0.0.
  const value =
    observation.value_numeric !== null
      ? String(observation.value_numeric)
      : shownValue(null, observation.value_text);
  const range = observation.ref_range_text ?? oneSidedRange(observation);
  const status = observation.status && observation.status !== "unknown" ? observation.status : null;
  const code = observation.obs_code;
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text size="sm" weight="medium" numberOfLines={2}>
          {name}
        </Text>
        {range ? (
          <Text size="xs" tone="mutedForeground">
            {range}
          </Text>
        ) : null}
      </View>
      <Text size="sm" weight="semibold" tone={status ? statusTone(status) : "foreground"}>
        {observation.unit ? `${value} ${observation.unit}` : value}
      </Text>
      {code ? <Icon icon={ChevronRight} size={16} /> : null}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: palette.border,
  };
  return code ? (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/health/observations/${encodeURIComponent(code)}` as Href)}
      style={style}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

/** A finding the document describes: what, where, and how large. */
function FindingRow({ finding }: { finding: RecordFindingWithCatalog }) {
  const palette = usePalette();
  const site = finding.catalog_site_name_ru ?? finding.body_site_text;
  const details = [
    site,
    finding.size_mm != null ? `${finding.size_mm} ${t("findings.mm")}` : null,
    finding.description,
  ].filter(Boolean);
  return (
    <View style={{ gap: 2, paddingVertical: 6, borderBottomWidth: 1, borderColor: palette.border }}>
      <Text size="sm" weight="medium">
        {finding.catalog_finding_name_ru ?? finding.finding_type_text}
      </Text>
      {details.length ? (
        <Text size="xs" tone="mutedForeground">
          {details.join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}
